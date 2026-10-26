import numpy as np


def interp_nan(x):
    x = np.array(x, float)
    bad = ~np.isfinite(x) if x.ndim == 1 else ~np.isfinite(x).all(1)
    if bad.all():
        return None
    idx = np.arange(len(x))
    if x.ndim == 1:
        x[bad] = np.interp(idx[bad], idx[~bad], x[~bad])
    else:
        for c in range(x.shape[1]):
            x[bad, c] = np.interp(idx[bad], idx[~bad], x[~bad, c])
    return x


