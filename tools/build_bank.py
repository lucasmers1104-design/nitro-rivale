import numpy as np, scipy.io.wavfile as wf, json, os, glob
from ridge2 import logspec
from ridge3 import dp_track
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

def energy(x, sr, hop=512):
    n = len(x) // hop
    e = np.array([np.sqrt(np.mean(x[i*hop:(i+1)*hop]**2)) + 1e-9 for i in range(n)])
    return np.arange(n) * hop / sr, 20*np.log10(e)
def mono(tt, ff, increasing=True):
    # erzwinge Monotonie (laufendes Max/Min)
    ff = np.maximum.accumulate(ff) if increasing else np.minimum.accumulate(ff)
    return tt, ff
bank = {}
fig, axs = plt.subplots(8, 1, figsize=(18, 24))
for ax, p in zip(axs, sorted(glob.glob('wav/*.wav'))):
    name = os.path.basename(p)[:-4]
    turbo = 'turbo' in name.lower()
    sr, x, t, lf, L = logspec(p)
    et, e = energy(x, sr)
    P1 = (14.6, 16.6)
    P2 = (16.6, 18.4) if not turbo else (16.6, 18.15)
    tt1, f1 = dp_track(t, lf, L, *P1, 120, 530, -1, 4)
    tt2, f2 = dp_track(t, lf, L, *P2, 200, 530, -1, 4)
    flim = np.median(f1[-6:])
    # Gas weg nach dem letzten Zug: erster starker Energieabfall
    tl0 = 25.0 if not turbo else 19.8
    m = (et > tl0) & (et < tl0 + (3 if not turbo else 1.2))
    idx = np.where(m)[0]
    eref = np.median(e[idx[:20]])
    drop = np.where(e[idx] < eref - (9 if not turbo else 6))[0]
    lift = et[idx[drop[0]]] if len(drop) else (26.2 if not turbo else 20.3)
    if not turbo:
        C = (lift + 0.25, 30.5); Dc = (35.3, 39.3)
    else:
        C = (21.1, 24.3); Dc = (27.3, 31.8)
    ttc, fc = dp_track(t, lf, L, *C, 150, 520, -2, 1)
    ttd, fd = dp_track(t, lf, L, *Dc, 35, 520 if not turbo else 340, -5, -1)
    tt1, f1 = mono(tt1, f1); tt2, f2 = mono(tt2, f2)
    ttc, fc = mono(ttc, fc, False); ttd, fd = mono(ttd, fd, False)
    on = [[float(a), float(b / flim)] for a, b in zip(tt1, f1)]
    on2 = [[float(a), float(b / flim)] for a, b in zip(tt2, f2)]
    off = [[float(a), float(b / flim)] for a, b in zip(ttd, fd)] + [[float(a), float(b / flim)] for a, b in zip(ttc, fc)]
    bank[name] = {
        'turbo': turbo, 'flim': float(flim), 'rpmLim': float(flim * 15),
        'start': [0.0, 1.6], 'idle': [1.7, 4.6], 'limiter': [9.35, 10.35], 'rev': [4.75, 12.2],
        'lift': [float(lift - 0.06), float(lift + 1.5)],
        'on': on, 'on2': on2, 'off': off,
    }
    print(f'{name:45s} flim {flim:5.0f} Hz  on {on[0][1]:.2f}-{on[-1][1]:.2f}  on2 {on2[0][1]:.2f}-{on2[-1][1]:.2f}  coast {fc[0]/flim:.2f}-{fc[-1]/flim:.2f}  decl {fd[0]/flim:.2f}-{fd[-1]/flim:.2f}  lift {lift:.2f}s')
    # Kontrollplot
    from scipy.signal import stft
    f, ts, Z = stft(x, sr, nperseg=4096, noverlap=4096-512)
    sel = f < 800
    ax.pcolormesh(ts, f[sel], 20*np.log10(np.abs(Z[sel])+1e-7), shading='auto', vmin=-95, vmax=-25)
    for a, b, c in [(tt1, f1, 'r'), (tt2, f2, 'm'), (ttc, fc, 'orange'), (ttd, fd, 'w')]: ax.plot(a, b, color=c, lw=2)
    ax.axvline(lift, color='orange'); ax.set_title(name, fontsize=9); ax.set_xticks(np.arange(0, ts[-1], 1))
plt.tight_layout(); plt.savefig('plots/tracks.png', dpi=50)
json.dump(bank, open('bank.json', 'w'))
