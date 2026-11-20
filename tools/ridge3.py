import numpy as np
from ridge2 import logspec, BPO
def dp_track(t, lf, L, t0, t1, fmin, fmax, smin, smax, step=2):
    """Viterbi-Pfad der hellsten Obertonlinie mit gerichteten Sprüngen (smin..smax Bins pro Schritt)."""
    j0, j1 = np.searchsorted(t, t0), np.searchsorted(t, t1)
    js = np.arange(j0, j1, step)
    b0, b1 = np.searchsorted(lf, fmin), np.searchsorted(lf, fmax)
    S = L[b0:b1][:, js]
    S = S / (S.max(axis=0, keepdims=True) + 1e-9)
    n, T = S.shape
    D = S[:, 0].copy(); back = np.zeros((n, T), np.int32)
    ii = np.arange(n)
    for j in range(1, T):
        best = np.full(n, -np.inf); arg = np.zeros(n, np.int32)
        for d in range(smin, smax + 1):
            src = ii - d
            ok = (src >= 0) & (src < n)
            v = np.full(n, -np.inf); v[ok] = D[src[ok]] - 0.02 * abs(d)
            m = v > best; best[m] = v[m]; arg[m] = np.where(ok, src, 0)[m]
        D = best + S[:, j]; back[:, j] = arg
    p = np.zeros(T, np.int32); p[-1] = int(np.argmax(D))
    for j in range(T - 1, 0, -1): p[j - 1] = back[p[j], j]
    return t[js], lf[b0 + p]
if __name__ == '__main__':
    import sys
    name = sys.argv[1]
    sr, x, t, lf, L = logspec(f'wav/{name}.wav')
    for seg in sys.argv[2:]:
        t0, t1, fmin, fmax, smin, smax = seg.split(':')
        tt, ff = dp_track(t, lf, L, float(t0), float(t1), float(fmin), float(fmax), int(smin), int(smax))
        print(f'--- {t0}-{t1}')
        print('   ' + '  '.join(f'{tt[i]:.2f}:{ff[i]:.0f}' for i in range(0, len(tt), max(1, len(tt) // 12))))
