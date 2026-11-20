import numpy as np, scipy.io.wavfile as wf, json, subprocess, os
SR = 44100
sweeps = json.load(open('sweeps.json')); bank = json.load(open('bank.json'))
IDS = {
 '01_V8_Sauger_Leise': ('v8_leise', 'V8 Sauger · Leise'), '02_V8_Sauger_Normal': ('v8_normal', 'V8 Sauger · Normal'),
 '03_V8_Sauger_Sport': ('v8_sport', 'V8 Sauger · Sport'), '04_V8_Sauger_Track': ('v8_track', 'V8 Sauger · Track'),
 '05_V8_Turbo_Sport_BlowOff': ('v8_turbo', 'V8 Turbo · Blow-Off'), '06_V8_Biturbo_Sport_BlowOff': ('v8_biturbo', 'V8 Biturbo · Blow-Off'),
 '07_V8_Biturbo_Sport_ohne_Ventil_Flattern': ('v8_flattern', 'V8 Biturbo · Flattern'), '08_V8_Biturbo_Sport_Umluft': ('v8_umluft', 'V8 Biturbo · Umluft'),
}
ON_T = [0.42, 0.49, 0.56, 0.63, 0.70, 0.77, 0.84, 0.91, 0.97]
OFF_T = [0.17, 0.22, 0.28, 0.35, 0.43, 0.52, 0.61, 0.70, 0.80, 0.88]

def warp_run(x, t, f, f_target, a, b):
    """Schneidet [a,b] aus und verzerrt die Zeit so, dass die Tonhöhe konstant f_target ist."""
    ts = np.arange(int(a * SR), int(b * SR)) / SR
    fs = np.interp(ts, t, f)
    phase = np.cumsum(fs / f_target) / SR           # Ausgabezeit als Funktion der Quellzeit
    n_out = int(phase[-1] * SR)
    tau = np.arange(n_out) / SR
    src_t = np.interp(tau, phase, ts)
    return np.interp(src_t * SR, np.arange(len(x)), x)
def transient_score(seg):
    w = int(0.01 * SR); n = len(seg) // w
    if n < 3: return 9
    r = np.sqrt((seg[:n * w].reshape(n, w) ** 2).mean(1)) + 1e-9
    return float(r.max() / np.median(r))
def xfade_concat(parts, X):
    out = parts[0]
    fi = np.sin(np.linspace(0, np.pi / 2, X)) ** 2; fo = 1 - fi
    for p in parts[1:]:
        if len(out) < X or len(p) < X: out = np.concatenate([out, p]); continue
        out = np.concatenate([out[:-X], out[-X:] * fo + p[:X] * fi, p[X:]])
    return out
def make_loop(seq, X):
    X = min(X, len(seq) // 4)
    fi = np.sin(np.linspace(0, np.pi / 2, X)) ** 2
    loop = seq[X:].copy()
    loop[-X:] = loop[-X:] * (1 - fi) + seq[:X] * fi
    return loop
def measure_f0(loop, f_exp):
    n = 1 << int(np.ceil(np.log2(len(loop) * 4)))
    S = np.abs(np.fft.rfft(loop * np.hanning(len(loop)), n)); fr = np.fft.rfftfreq(n, 1 / SR)
    best, bf = -1, f_exp
    for k, wgt in [(1, 1.0), (2, 0.6)]:
        sel = (fr > k * f_exp * 0.88) & (fr < k * f_exp * 1.12)
        i = np.where(sel)[0][np.argmax(S[sel])]
        if 0 < i < len(S) - 1:
            a, b, c = np.log(S[i - 1] + 1e-12), np.log(S[i] + 1e-12), np.log(S[i + 1] + 1e-12)
            d = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
        else: d = 0
        f = (fr[i] + d * (fr[1] - fr[0])) / k
        if k == 1: bf = f; best = S[i]
    return bf

peak = max(np.abs(wf.read(f'wav/{n}.wav')[1].astype(np.float32) / 32768).max() for n in IDS)
G = 0.89 / peak
manifest = {}
for name, (vid, label) in IDS.items():
    sr, x = wf.read(f'wav/{name}.wav'); x = x.astype(np.float32) / 32768 * G
    sw = sweeps[name]; flim = sw['flim']; b = bank[name]
    loops = {'on': [], 'off': []}
    report = []
    for kind, targets in (('on', ON_T), ('off', OFF_T)):
        for r in targets:
            ft = r * flim
            runs = []
            for s in sw['sweeps']:
                if s['kind'] != kind: continue
                t = np.array(s['t']); f = np.array(s['f'])
                m = (f > ft * 0.94) & (f < ft * 1.06)
                if m.sum() < 3: continue
                idx = np.where(m)[0]
                # längster zusammenhängender Lauf
                splits = np.where(np.diff(idx) > 2)[0]
                groups = np.split(idx, splits + 1)
                g = max(groups, key=len)
                a, bb = t[g[0]], t[g[-1]]
                if bb - a < 0.05: continue
                seg = warp_run(x, t, f, ft, a, bb)
                runs.append((transient_score(seg), seg))
            if not runs: continue
            clean = [s for sc, s in runs if sc < 2.6] or [min(runs, key=lambda q: q[0])[1]]
            clean.sort(key=len, reverse=True)
            seq = xfade_concat(clean, int(0.025 * SR))
            if len(seq) < int(0.14 * SR): continue
            loop = make_loop(seq, int(0.03 * SR))
            fm = measure_f0(loop, ft)
            loops[kind].append({'x': fm / flim, 'data': loop})
            report.append(f'{kind}{r:.2f}:{len(loop)/SR:.2f}s/{(fm/ft-1)*100:+.0f}%')
    # Leerlauf und Begrenzer am Stück als lange Loops
    idle = make_loop(x[int(1.75 * SR):int(4.65 * SR)], int(0.08 * SR))
    lim = make_loop(x[int(b['limiter'][0] * SR):int(b['limiter'][1] * SR)], int(0.04 * SR))
    # Packen: jeder Loop mit periodischer Verlängerung (robust gegen MP3-Versatz)
    PAD = int(0.08 * SR)
    buf = []; pos = 0
    def put(arr):
        global pos
        buf.append(arr); pos += len(arr)
    def put_loop(loop):
        start = pos + PAD
        put(np.concatenate([loop[-PAD:], loop, loop[:PAD], np.zeros(int(0.05 * SR))]))
        return [round(start / SR, 5), round(len(loop) / SR, 5)]
    def put_shot(a, c):
        s = x[int(a * SR):int(c * SR)].copy(); fd = int(0.006 * SR)
        s[:fd] *= np.linspace(0, 1, fd); s[-fd:] *= np.linspace(1, 0, fd)
        st = pos; put(np.concatenate([s, np.zeros(int(0.1 * SR))]))
        return [round(st / SR, 5), round((c - a), 5)]
    pos = 0
    man = {'label': label, 'file': f'{vid}.mp3', 'turbo': 'turbo' in name.lower(), 'flim': round(flim, 2), 'on': [], 'off': []}
    for kind in ('on', 'off'):
        for L in sorted(loops[kind], key=lambda q: q['x']):
            s_, d_ = put_loop(L['data']); man[kind].append({'x': round(L['x'], 4), 's': s_, 'd': d_})
    man['idle'] = dict(zip(('s', 'd'), put_loop(idle)))
    man['limiter'] = dict(zip(('s', 'd'), put_loop(lim)))
    man['regions'] = {'start': put_shot(*b['start']), 'lift': put_shot(*b['lift']), 'rev': put_shot(*b['rev'])}
    y = np.concatenate(buf).astype(np.float32)
    os.makedirs('out2', exist_ok=True)
    wf.write(f'out2/{vid}.wav', SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'out2/{vid}.wav', '-ac', '1', '-b:a', '160k', f'out2/{vid}.mp3'], check=True)
    manifest[vid] = man
    print(f'{vid:12s} {len(y)/SR:5.1f}s {os.path.getsize(f"out2/{vid}.mp3")//1024}KB  on {len(man["on"])} off {len(man["off"])} | ' + ' '.join(report))
json.dump(manifest, open('out2/manifest.json', 'w'), separators=(',', ':'))
