# Verfolgt alle nutzbaren Drehzahl-Verläufe (Vollgas-Züge 1.-4. Gang + Abfall) pro Aufnahme
import numpy as np, json, glob, os
from ridge2 import logspec
from ridge3 import dp_track
def mono(ff, inc):
    return np.maximum.accumulate(ff) if inc else np.minimum.accumulate(ff)
out = {}
for p in sorted(glob.glob('wav/*.wav')):
    name = os.path.basename(p)[:-4]
    turbo = 'turbo' in name.lower()
    sr, x, t, lf, L = logspec(p)
    if not turbo:
        pulls = [(14.6, 16.6), (16.65, 18.45), (18.65, 21.7), (21.95, 26.15)]
        decl = (35.3, 39.3)
    else:
        pulls = [(14.6, 16.5), (16.6, 18.15), (18.25, 19.2), (19.3, 20.15)]
        decl = (27.3, 31.8)
    sw = []
    for (a, b) in pulls:
        tt, ff = dp_track(t, lf, L, a, b, 120, 530, -1, 4)
        sw.append({'kind': 'on', 't': tt.tolist(), 'f': mono(ff, True).tolist()})
    tt, ff = dp_track(t, lf, L, *decl, 35, 520 if not turbo else 340, -5, -1)
    sw.append({'kind': 'off', 't': tt.tolist(), 'f': mono(ff, False).tolist()})
    flim = float(np.median([s['f'][-1] for s in sw[:2]]))
    out[name] = {'flim': flim, 'sweeps': sw}
    print(name, 'flim', round(flim), ' '.join(f"{s['kind']}:{s['f'][0]/flim:.2f}-{s['f'][-1]/flim:.2f}" for s in sw))
json.dump(out, open('sweeps.json', 'w'))
