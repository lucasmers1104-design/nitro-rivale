# Motor-Loops v2: lange, nahtlose Loops per WSOLA-Textursynthese.
# Statt ein paar Zehntelsekunden Material hart zu wiederholen, werden kurze Körner
# (je ein Motor-Arbeitsspiel) aus ALLEN passenden Gas-Zügen phasengenau und in
# zufälliger Reihenfolge aneinandergesetzt. Ergebnis: ~1,6 s Loops ohne Schnarren/Knacken.
import numpy as np, scipy.io.wavfile as wf, json, subprocess, os, sys
from scipy.signal import fftconvolve, butter, sosfiltfilt

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
sweeps = json.load(open(os.path.join(HERE, 'sweeps.json')))
bank = json.load(open(os.path.join(HERE, 'bank.json')))
IDS = {
    '01_V8_Sauger_Leise': ('v8_leise', 'V8 Sauger · Leise'), '02_V8_Sauger_Normal': ('v8_normal', 'V8 Sauger · Normal'),
    '03_V8_Sauger_Sport': ('v8_sport', 'V8 Sauger · Sport'), '04_V8_Sauger_Track': ('v8_track', 'V8 Sauger · Track'),
    '05_V8_Turbo_Sport_BlowOff': ('v8_turbo', 'V8 Turbo · Blow-Off'), '06_V8_Biturbo_Sport_BlowOff': ('v8_biturbo', 'V8 Biturbo · Blow-Off'),
    '07_V8_Biturbo_Sport_ohne_Ventil_Flattern': ('v8_flattern', 'V8 Biturbo · Flattern'), '08_V8_Biturbo_Sport_Umluft': ('v8_umluft', 'V8 Biturbo · Umluft'),
}
# Unter Last ab 0,36 (Material darunter wird aus den untersten Zügen herabgezogen)
ON_T = [0.36, 0.42, 0.49, 0.56, 0.63, 0.70, 0.77, 0.84, 0.91, 0.97]
OFF_T = [0.17, 0.22, 0.28, 0.35, 0.43, 0.52, 0.61, 0.70, 0.80, 0.88]
BAND = 0.09          # Material aus ±9 % um die Zieldrehzahl (wird auf exakt konstant verzerrt)
LOOP_ON, LOOP_OFF = 1.6, 1.4
rng = np.random.default_rng(7)
JOINS = []


def warp_run(x, t, f, f_target, a, b):
    """Schneidet [a,b] aus und verzerrt die Zeit so, dass die Tonhöhe konstant f_target ist."""
    ts = np.arange(int(a * SR), int(b * SR)) / SR
    fs = np.interp(ts, t, f)
    phase = np.cumsum(fs / f_target) / SR
    n_out = int(phase[-1] * SR)
    tau = np.arange(n_out) / SR
    src_t = np.interp(tau, phase, ts)
    return np.interp(src_t * SR, np.arange(len(x)), x)


def collect(x, sw, kind, ft, flim):
    """Alle Abschnitte der Züge, deren Tonhöhe nahe ft liegt, auf ft verzerrt."""
    segs = []
    for band in (BAND, BAND * 1.6, BAND * 2.6):
        for s in sw['sweeps']:
            if s['kind'] != kind: continue
            t = np.array(s['t']); f = np.array(s['f'])
            m = (f > ft * (1 - band)) & (f < ft * (1 + band))
            if m.sum() < 3: continue
            idx = np.where(m)[0]
            groups = np.split(idx, np.where(np.diff(idx) > 2)[0] + 1)
            for g in groups:
                a, bb = t[g[0]], t[g[-1]]
                if bb - a < 0.03: continue
                segs.append(warp_run(x, t, f, ft, a, bb))
        if sum(len(s) for s in segs) > 0.5 * SR: break
    # Unterhalb des Materials: unterste Züge herunterziehen (Resampling)
    if not segs:
        lo = min((min(s['f']) for s in sw['sweeps'] if s['kind'] == kind), default=None)
        if lo is None: return []
        src_f = lo * 1.08
        for s in sw['sweeps']:
            if s['kind'] != kind: continue
            t = np.array(s['t']); f = np.array(s['f'])
            m = (f < src_f * 1.1)
            idx = np.where(m)[0]
            if len(idx) < 3: continue
            g = np.split(idx, np.where(np.diff(idx) > 2)[0] + 1)[0]
            a, bb = t[g[0]], t[g[-1]]
            if bb - a < 0.03: continue
            seg = warp_run(x, t, f, src_f, a, bb)          # konstant src_f
            r = ft / src_f                                  # dann auf ft herunterziehen
            n = int(len(seg) / r)
            segs.append(np.interp(np.arange(n) * r, np.arange(len(seg)), seg))
    return segs


def ncc_best(tail, cand, maxlag):
    """Verschiebung 0..2*maxlag in cand, bei der der Anfang am besten an tail passt."""
    L = len(tail)
    seg = cand[:L + 2 * maxlag]
    if len(seg) < L + 1: return 0
    num = fftconvolve(seg, tail[::-1], mode='valid')
    e = np.sqrt(fftconvolve(seg ** 2, np.ones(L), mode='valid') + 1e-9)
    sc = num / e
    return int(np.argmax(sc))


def wsola_texture(segs, ft, n_out, cyc):
    """Zufällige, phasengenaue Aneinanderreihung von Körnern (Länge = 1 Arbeitsspiel)."""
    T = SR / ft                       # Periode der Zündfrequenz in Samples
    Lg = int(max(cyc * T, 0.022 * SR))  # Korn: ein Arbeitsspiel, mind. 22 ms
    Lg += Lg % 2
    hop = Lg // 2
    win = np.hanning(Lg + 1)[:-1]     # 50 % Überlappung summiert sich zu 1
    maxlag = int(np.ceil(cyc * T / 2)) + 2   # bis zu einem halben Arbeitsspiel verschieben
    # Körner nach Pegel filtern (keine einzelnen Knaller/Aussetzer)
    cands = []
    for s in segs:
        for p in range(0, len(s) - Lg - 1, max(1, hop // 2)):
            cands.append((s, p))
    if not cands: return None
    rms = np.array([np.sqrt(np.mean(s[p:p + Lg] ** 2)) for s, p in cands])
    med = np.median(rms)
    ok = [c for c, r in zip(cands, rms) if 0.55 * med < r < 1.7 * med] or cands
    out = np.zeros(n_out + Lg * 3)
    s, p = ok[rng.integers(len(ok))]
    out[:Lg] += s[p:p + Lg] * win
    pos = hop
    last = (s, p)
    while pos + Lg < len(out):
        tail = out[pos:pos + hop]     # bereits liegender, noch nicht voll gedeckter Teil
        # Natürliche Fortsetzung des letzten Korns als Bewertungsmaßstab einbeziehen
        s, p = ok[rng.integers(len(ok))]
        if rng.random() < 0.35:   # gelegentlich am Stück weiterlaufen: mehr Natürlichkeit
            ls, lp = last
            if lp + hop + Lg < len(ls): s, p = ls, lp + hop
        room = len(s) - p - Lg
        lag = ncc_best(tail, s[p:p + hop + min(2 * maxlag, room)], (min(2 * maxlag, room)) // 2) if room > 0 else 0
        g0 = s[p + lag:p + lag + hop]
        if len(g0) == hop: JOINS.append(np.dot(g0, tail) / (np.sqrt(np.dot(g0, g0) * np.dot(tail, tail)) + 1e-9))
        g = s[p + lag:p + lag + Lg]
        if len(g) < Lg: continue
        out[pos:pos + Lg] += g * win
        last = (s, p + lag)
        pos += hop
    return out[hop:hop + n_out + Lg]   # Einschwingen abschneiden


def close_loop(y, ft, n_target, cyc=8):
    """Loop-Ende phasengenau an den Anfang blenden: über ein ganzes Arbeitsspiel die beste Stelle suchen."""
    T = SR / ft
    X = int(max(4 * T, 0.03 * SR))
    best, bi, bh = -9, None, 0
    for h0 in range(0, int(cyc * T) + 1, max(1, int(T / 2))):   # auch der Kopf darf etwas später beginnen
        head = y[h0:h0 + X]
        hh = np.dot(head, head)
        lo, hi = n_target - int(cyc * T), n_target + int(cyc * T)
        for i in range(max(h0 + X, lo), min(len(y) - X, hi)):
            seg = y[i:i + X]
            c = np.dot(seg, head) / (np.sqrt(np.dot(seg, seg) * hh) + 1e-9)
            if c > best: best, bi, bh = c, i, h0
    head = y[bh:bh + X]
    fi = np.sin(np.linspace(0, np.pi / 2, X)) ** 2
    loop = y[bh:bi + X].copy()
    loop[bi - bh:bi - bh + X] = y[bi:bi + X] * (1 - fi) + head * fi
    return loop[X:], best   # beginnt nach dem Kopf → Ende geht nahtlos in Anfang über


def make_loop(seq, X):
    X = min(X, len(seq) // 4)
    fi = np.sin(np.linspace(0, np.pi / 2, X)) ** 2
    loop = seq[X:].copy()
    loop[-X:] = loop[-X:] * (1 - fi) + seq[:X] * fi
    return loop


def measure_f0(loop, f_exp):
    n = 1 << int(np.ceil(np.log2(len(loop) * 4)))
    S = np.abs(np.fft.rfft(loop * np.hanning(len(loop)), n)); fr = np.fft.rfftfreq(n, 1 / SR)
    sel = (fr > f_exp * 0.88) & (fr < f_exp * 1.12)
    i = np.where(sel)[0][np.argmax(S[sel])]
    if 0 < i < len(S) - 1:
        a, b, c = np.log(S[i - 1] + 1e-12), np.log(S[i] + 1e-12), np.log(S[i + 1] + 1e-12)
        d = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
    else: d = 0
    return fr[i] + d * (fr[1] - fr[0])


def tame(y):
    """Grelle Spitzen abmildern: sanfter Tiefpass oben, 2,5–5 kHz leicht zurück."""
    sos = butter(2, 9000, 'low', fs=SR, output='sos')
    y = sosfiltfilt(sos, y)
    return y


def build(only=None):
    out_dir = os.path.join(HERE, 'out3'); os.makedirs(out_dir, exist_ok=True)
    peak = max(np.abs(wf.read(os.path.join(HERE, f'wav/{n}.wav'))[1].astype(np.float32) / 32768).max() for n in IDS)
    G = 0.89 / peak
    manifest = {}
    for name, (vid, label) in IDS.items():
        if only and vid not in only: continue
        sr, x = wf.read(os.path.join(HERE, f'wav/{name}.wav')); x = x.astype(np.float32) / 32768 * G
        if x.ndim > 1: x = x.mean(1)
        sw = sweeps[name]; flim = sw['flim']; b = bank[name]
        loops = {'on': [], 'off': []}; report = []
        for kind, targets, dur in (('on', ON_T, LOOP_ON), ('off', OFF_T, LOOP_OFF)):
            for r in targets:
                ft = r * flim
                segs = collect(x, sw, kind, ft, flim)
                if not segs: continue
                n_t = int(dur * SR)
                # Firing-Frequenz der Spur = Zündfrequenz → Arbeitsspiel (V8) = 4 Perioden der Spur
                tex = wsola_texture(segs, ft, n_t + int(0.2 * SR), cyc=8)
                if tex is None: continue
                loop, q = close_loop(tex, ft, n_t)
                loop = tame(loop)
                fm = measure_f0(loop, ft)
                loops[kind].append({'x': fm / flim, 'data': loop.astype(np.float32)})
                mat = sum(len(s) for s in segs) / SR
                report.append(f'{kind}{r:.2f}:{len(loop)/SR:.2f}s q{q:.2f} j{np.median(JOINS):.2f}'); JOINS.clear()
        idle = make_loop(tame(x[int(1.75 * SR):int(4.65 * SR)]), int(0.08 * SR))
        lim = make_loop(tame(x[int(b['limiter'][0] * SR):int(b['limiter'][1] * SR)]), int(0.04 * SR))
        PAD = int(0.08 * SR)
        buf = []; pos = [0]
        def put(arr): buf.append(arr); pos[0] += len(arr)
        def put_loop(loop):
            start = pos[0] + PAD
            put(np.concatenate([loop[-PAD:], loop, loop[:PAD], np.zeros(int(0.05 * SR))]))
            return [round(start / SR, 5), round(len(loop) / SR, 5)]
        def put_shot(a, c):
            s = tame(x[int(a * SR):int(c * SR)].copy()); fd = int(0.006 * SR)
            s[:fd] *= np.linspace(0, 1, fd); s[-fd:] *= np.linspace(1, 0, fd)
            st = pos[0]; put(np.concatenate([s, np.zeros(int(0.1 * SR))]))
            return [round(st / SR, 5), round((c - a), 5)]
        man = {'label': label, 'file': f'{vid}.mp3', 'turbo': 'turbo' in name.lower(), 'flim': round(flim, 2), 'v': 2, 'on': [], 'off': []}
        for kind in ('on', 'off'):
            for L in sorted(loops[kind], key=lambda q: q['x']):
                s_, d_ = put_loop(L['data']); man[kind].append({'x': round(float(L['x']), 4), 's': s_, 'd': d_})
        man['idle'] = dict(zip(('s', 'd'), put_loop(idle)))
        man['limiter'] = dict(zip(('s', 'd'), put_loop(lim)))
        man['regions'] = {'start': put_shot(*b['start']), 'lift': put_shot(*b['lift']), 'rev': put_shot(*b['rev'])}
        y = np.concatenate(buf).astype(np.float32)
        wf.write(os.path.join(out_dir, f'{vid}.wav'), SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(out_dir, f'{vid}.wav'), '-ac', '1', '-b:a', '128k', os.path.join(out_dir, f'{vid}.mp3')], check=True)
        manifest[vid] = man
        print(f'{vid:12s} {len(y)/SR:5.1f}s {os.path.getsize(os.path.join(out_dir, vid + ".mp3"))//1024}KB on {len(man["on"])} off {len(man["off"])} | ' + ' '.join(report), flush=True)
    json.dump(manifest, open(os.path.join(out_dir, 'manifest.json'), 'w'), separators=(',', ':'))


if __name__ == '__main__':
    build(sys.argv[1:] or None)
