# Lautheit und Helligkeit der Motorklänge angleichen → Werte ins Manifest
import numpy as np, json, subprocess, sys
SR = 44100
def load(path):
    return np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], capture_output=True).stdout, np.float32)
d = sys.argv[1] if len(sys.argv) > 1 else 'out3'
m = json.load(open(f'{d}/manifest.json'))
def seg(y, L): a = int(L['s'] * SR); return y[a:a + int(L['d'] * SR)]
def harsh(s):
    F = np.abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2; fr = np.fft.rfftfreq(len(s), 1 / SR)
    return F[(fr > 2500) & (fr < 8000)].sum() / F.sum()
TARGET_RMS, TARGET_HARSH = 0.11, 0.07
for vid, M in m.items():
    y = load(f'{d}/{vid}.mp3')
    ons = [seg(y, L) for L in M['on'] if L['x'] > 0.6]
    rms = np.mean([np.sqrt(np.mean(s ** 2)) for s in ons])
    h = np.mean([harsh(s) for s in ons])
    gain = TARGET_RMS / rms
    # Hochton-Absenkung so, dass die "Schärfe" in etwa beim Ziel landet (Shelf ab 2,8 kHz)
    shelf = float(np.clip(10 * np.log10(TARGET_HARSH / max(h, 1e-4)), -9, 1.5))
    s, dd = M['regions']['lift']; lift = y[int(s * SR):int((s + dd) * SR)]
    lpk = np.sqrt(np.max(np.convolve(lift ** 2, np.ones(2205) / 2205, 'valid')))
    lift_gain = (rms * 10 ** (-8 / 20)) / lpk      # Gas-weg-Effekt 8 dB unter dem Motor
    M['gain'] = round(float(gain), 3); M['shelf'] = round(shelf, 1); M['liftGain'] = round(float(lift_gain), 3); M['harsh'] = round(float(h), 3)
    print(f'{vid:12s} rms {rms:.3f} → gain {gain:.2f} | scharf {h*100:4.1f}% → shelf {shelf:+.1f} dB | liftGain {lift_gain:.2f}')
json.dump(m, open(f'{d}/manifest.json', 'w'), separators=(',', ':'))
