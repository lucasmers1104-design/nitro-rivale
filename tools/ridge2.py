import numpy as np, scipy.io.wavfile as wf
from scipy.signal import stft
from scipy.ndimage import uniform_filter1d
HOP = 256
BPO = 240  # Bins pro Oktave (5 Cent)
def logspec(path, fmin=70, fmax=3500):
    sr, x = wf.read(path); x = x.astype(np.float32) / 32768
    f, t, Z = stft(x, sr, nperseg=4096, noverlap=4096 - HOP)
    M = np.log(np.abs(Z) + 1e-6)
    nb = int(np.log2(fmax / fmin) * BPO)
    lf = fmin * 2 ** (np.arange(nb) / BPO)
    L = np.empty((nb, M.shape[1]), np.float32)
    for j in range(M.shape[1]): L[:, j] = np.interp(lf, f, M[:, j])
    L -= uniform_filter1d(L, 60, axis=0)  # spektral aufhellen -> Obertonlinien betonen
    L = np.maximum(L, 0)
    return sr, x, t, lf, L
def rel_track(t, L, t0, t1, step=3, maxs=10):
    """Relative Tonhöhe (log2) über Kreuzkorrelation benachbarter Spektren."""
    j0, j1 = np.searchsorted(t, t0), np.searchsorted(t, t1)
    js = list(range(j0, j1, step))
    cum = [0.0]
    for a, b in zip(js[:-1], js[1:]):
        A, B = L[:, a], L[:, b]
        sc = []
        for s in range(-maxs, maxs + 1):
            if s >= 0: sc.append(np.dot(A[:len(A) - s], B[s:]))
            else: sc.append(np.dot(A[-s:], B[:len(B) + s]))
        sc = np.array(sc); k = int(np.argmax(sc))
        d = 0.0
        if 0 < k < len(sc) - 1:
            y0, y1, y2 = sc[k - 1], sc[k], sc[k + 1]
            d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-9)
        cum.append(cum[-1] + (k - maxs + d) / BPO)
    return np.array([t[j] for j in js]), np.array(cum)
if __name__ == '__main__':
    import sys
    name = sys.argv[1]
    sr, x, t, lf, L = logspec(f'wav/{name}.wav')
    for seg in sys.argv[2:]:
        t0, t1 = map(float, seg.split(':'))
        tt, c = rel_track(t, L, t0, t1)
        r = 2 ** (c - c[-1])
        print(f'--- {t0}-{t1}: Verhältnis Start/Ende {r[0]:.3f}')
        for i in range(0, len(tt), max(1, len(tt) // 10)): print(f'   {tt[i]:6.2f}s  rel {r[i]:.3f}')
