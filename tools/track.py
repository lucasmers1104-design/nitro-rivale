import numpy as np, scipy.io.wavfile as wf, sys, json
from scipy.signal import stft
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
def analyze(path, png):
    sr, x = wf.read(path); x = x.astype(np.float32) / 32768.0
    f, t, Z = stft(x, sr, nperseg=8192, noverlap=8192-512)
    M = np.abs(Z)
    band = (f > 20) & (f < 1500)
    L = np.log1p(M[band] * 200)
    fb = f[band]
    # Harmonische Summe: Kandidaten 15..400 Hz
    cands = np.arange(15, 400, 0.5)
    S = np.zeros((len(cands), M.shape[1]))
    for k, w in [(1, 1.0), (2, 0.9), (3, 0.7), (4, 0.6), (5, 0.4), (6, 0.35), (8, 0.25)]:
        idx = np.clip(np.searchsorted(fb, cands * k), 0, len(fb) - 1)
        S += w * L[idx]
    # Viterbi mit Sprungstrafe
    n, T = S.shape
    cost = -S
    jump = 0.06
    D = cost[:, 0].copy(); back = np.zeros((n, T), dtype=np.int32)
    ii = np.arange(n)
    for j in range(1, T):
        # Übergänge nur +-12 Kandidaten
        best = np.full(n, np.inf); arg = np.zeros(n, dtype=np.int32)
        for d in range(-12, 13):
            src = np.clip(ii - d, 0, n - 1)
            v = D[src] + jump * abs(d)
            m = v < best; best[m] = v[m]; arg[m] = src[m]
        D = best + cost[:, j]; back[:, j] = arg
    path_i = np.zeros(T, dtype=np.int32); path_i[-1] = np.argmin(D)
    for j in range(T - 1, 0, -1): path_i[j - 1] = back[path_i[j], j]
    f0 = cands[path_i]
    energy = 20 * np.log10(np.sqrt((M[band] ** 2).sum(0)) + 1e-9)
    fig, ax = plt.subplots(2, 1, figsize=(16, 8), sharex=True)
    ax[0].pcolormesh(t, fb[fb < 700], 20 * np.log10(M[band][fb < 700] + 1e-6), shading='auto', vmin=-90, vmax=-20)
    ax[0].plot(t, f0, 'r', lw=1); ax[0].set_ylim(0, 700); ax[0].set_title(path)
    ax[1].plot(t, energy); ax[1].set_ylabel('dB')
    for a in ax: a.grid(True, alpha=.3)
    ax[1].set_xticks(np.arange(0, t[-1], 1))
    plt.tight_layout(); plt.savefig(png, dpi=60)
    return t, f0, energy
if __name__ == '__main__':
    import glob, os
    out = {}
    for p in sorted(glob.glob('wav/*.wav')):
        name = os.path.basename(p)[:-4]
        t, f0, en = analyze(p, f'plots/{name}.png')
        out[name] = {'t': t.tolist(), 'f0': f0.tolist(), 'en': en.tolist()}
        print(name, 'f0 range', np.percentile(f0, 5), np.percentile(f0, 95))
    json.dump(out, open('tracks.json', 'w'))
