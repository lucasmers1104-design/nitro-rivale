import numpy as np, scipy.io.wavfile as wf, json, subprocess, os
bank = json.load(open('bank.json'))
IDS = {
 '01_V8_Sauger_Leise': ('v8_leise', 'V8 Sauger · Leise'),
 '02_V8_Sauger_Normal': ('v8_normal', 'V8 Sauger · Normal'),
 '03_V8_Sauger_Sport': ('v8_sport', 'V8 Sauger · Sport'),
 '04_V8_Sauger_Track': ('v8_track', 'V8 Sauger · Track'),
 '05_V8_Turbo_Sport_BlowOff': ('v8_turbo', 'V8 Turbo · Blow-Off'),
 '06_V8_Biturbo_Sport_BlowOff': ('v8_biturbo', 'V8 Biturbo · Blow-Off'),
 '07_V8_Biturbo_Sport_ohne_Ventil_Flattern': ('v8_flattern', 'V8 Biturbo · Flattern'),
 '08_V8_Biturbo_Sport_Umluft': ('v8_umluft', 'V8 Biturbo · Umluft'),
}
os.makedirs('out', exist_ok=True)
peak = 0
data = {}
for name in bank:
    sr, x = wf.read(f'wav/{name}.wav'); x = x.astype(np.float32) / 32768
    data[name] = x; peak = max(peak, np.abs(x).max())
gain = 0.89 / peak
GAP = 0.2
manifest = {}
for name, b in bank.items():
    sr = 44100; x = data[name] * gain
    on, on2, off = b['on'], b['on2'], b['off']
    coast = [p for p in off if p[0] > (b['lift'][0])][:]
    regions = {
        'start': b['start'], 'idle': b['idle'], 'rev': b['rev'], 'lift': b['lift'],
        'on': [on[0][0] - 0.05, on[-1][0] + 0.05], 'on2': [on2[0][0] - 0.05, on2[-1][0] + 0.05],
        'off': [min(p[0] for p in off) - 0.05, max(p[0] for p in off) + 0.05] if False else None,
    }
    # off besteht aus zwei Teilen (Ausrollen + Abfall): getrennt speichern
    tsorted = sorted(off)
    # Lücke finden
    gaps = [i for i in range(1, len(tsorted)) if tsorted[i][0] - tsorted[i - 1][0] > 0.5]
    parts = [tsorted[:gaps[0]], tsorted[gaps[0]:]] if gaps else [tsorted]
    for k, prt in enumerate(parts): regions[f'off{k}'] = [prt[0][0] - 0.05, prt[-1][0] + 0.05]
    del regions['off']
    out = []; pos = 0.0; newstart = {}
    for key, (a, c) in regions.items():
        seg = x[int(a * sr):int(c * sr)]
        # weiche Kanten
        fade = int(0.008 * sr); w = np.ones(len(seg)); w[:fade] = np.linspace(0, 1, fade); w[-fade:] = np.linspace(1, 0, fade)
        out.append(seg * w); out.append(np.zeros(int(GAP * sr)))
        newstart[key] = (pos, a, c - a)
        pos += (c - a) + GAP
    y = np.concatenate(out).astype(np.float32)
    vid, label = IDS[name]
    wf.write(f'out/{vid}.wav', sr, (y * 32767).astype(np.int16))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'out/{vid}.wav', '-ac', '1', '-ar', '44100', '-b:a', '128k', f'out/{vid}.mp3'], check=True)
    def remap(points, key):
        s0, a, dur = newstart[key]
        pts = [[round(s0 + (t - a), 4), round(xx, 4)] for t, xx in points if a <= t <= a + dur]
        return pts[::3] + ([pts[-1]] if pts and pts[-1] not in pts[::3] else [])
    reg = {k: [round(v[0], 4), round(v[2], 4)] for k, v in newstart.items()}
    s0, a, _ = newstart['rev']
    reg['limiter'] = [round(s0 + b['limiter'][0] - a, 4), round(b['limiter'][1] - b['limiter'][0], 4)]
    offmaps = []
    for k in range(len(parts)): offmaps += remap(parts[k], f'off{k}')
    manifest[vid] = {
        'label': label, 'file': f'{vid}.mp3', 'turbo': b['turbo'], 'rpmLim': round(b['rpmLim']),
        'regions': reg, 'on': remap(on, 'on'), 'on2': remap(on2, 'on2'),
        'off': sorted(offmaps, key=lambda p: p[1]),
    }
    print(vid, f'{len(y)/sr:.1f}s', os.path.getsize(f'out/{vid}.mp3') // 1024, 'KB', 'on', len(manifest[vid]['on']), 'off', len(manifest[vid]['off']))
json.dump(manifest, open('out/manifest.json', 'w'), separators=(',', ':'))
print('manifest', os.path.getsize('out/manifest.json') // 1024, 'KB')
