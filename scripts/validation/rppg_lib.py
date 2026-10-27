"""Shared rPPG evaluation code: face-mesh skin traces, classical methods, HR estimation.

The skin regions, their 15 % inward shrink, the skin-luminance filter and the POS projection
mirror src/rppg.js in the AstroBone app, so 'POS (app)' here is the app's own algorithm.
"""
import numpy as np
import cv2
from scipy.signal import butter, filtfilt
from scipy import sparse
from scipy.sparse.linalg import spsolve

SKIN_REGIONS = {
    "forehead": [103, 332, 10, 151],
    "leftCheek": [117, 118, 101, 36, 205, 187, 123, 50],
    "rightCheek": [346, 347, 330, 266, 425, 411, 352, 280],
}


def skin_boxes(lm, shrink=0.15):
    boxes = {}
    for name, idx in SKIN_REGIONS.items():
        xs = np.array([lm[i][0] for i in idx]); ys = np.array([lm[i][1] for i in idx])
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        dx, dy = (x1 - x0) * shrink, (y1 - y0) * shrink
        boxes[name] = (x0 + dx, y0 + dy, x1 - x0 - 2 * dx, y1 - y0 - 2 * dy)
    return boxes


class Steady:
    """The app's 0.4 s exponential hold on the skin boxes (PulseCapture.steadyRegions)."""
    def __init__(self):
        self.prev = None

    def __call__(self, boxes, t, motion):
        p = self.prev
        if p is None or motion > 0.05 or t - p[0] > 500:
            self.prev = (t, boxes); return boxes
        k = 1 - np.exp(-(t - p[0]) / 400)
        out = {n: tuple(o + k * (b - o) for o, b in zip(p[1][n], boxes[n])) for n in boxes}
        self.prev = (t, out)
        return out


def app_rgb(frame_rgb, boxes):
    """Area-average each region to a 32x32 tile, then average skin-luminance pixels (as the app does)."""
    h, w = frame_rgb.shape[:2]
    tiles = []
    for (x, y, bw, bh) in boxes.values():
        x0, y0 = max(0, x), max(0, y); x1, y1 = min(1, x + bw), min(1, y + bh)
        if x1 <= x0 or y1 <= y0:
            continue
        crop = frame_rgb[int(y0 * h):max(int(y1 * h), int(y0 * h) + 1), int(x0 * w):max(int(x1 * w), int(x0 * w) + 1)]
        tiles.append(cv2.resize(crop, (32, 32), interpolation=cv2.INTER_AREA))
    if not tiles:
        return None
    px = np.concatenate(tiles).reshape(-1, 3).astype(np.float64)
    lum = 0.299 * px[:, 0] + 0.587 * px[:, 1] + 0.114 * px[:, 2]
    px = px[(lum >= 25) & (lum <= 240)]
    return px.mean(0) if len(px) >= 192 else None


# ---------------------------------------------------------------- classical methods
def _bp(x, fs, lo=0.7, hi=3.0, order=3):
    b, a = butter(order, [lo, hi], fs=fs, btype="band")
    return filtfilt(b, a, x, axis=0)


def detrend(x, lam=100):
    n = len(x)
    D = sparse.diags([np.ones(n - 2), -2 * np.ones(n - 2), np.ones(n - 2)], [0, 1, 2], shape=(n - 2, n))
    return x - spsolve(sparse.eye(n, format="csc") + lam ** 2 * (D.T @ D), x)


def green(rgb, fs):
    return rgb[:, 1].copy()


def pos(rgb, fs, win=1.6):
    """POS, Wang et al. IEEE TBME 2017 (the app's implementation: overlap-add of 1.6 s windows)."""
    n = len(rgb); l = int(np.ceil(win * fs)); H = np.zeros(n); cnt = np.zeros(n)
    for e in range(l, n + 1):
        c = rgb[e - l:e]; cn = c / c.mean(0)
        x = cn[:, 1] - cn[:, 2]; y = -2 * cn[:, 0] + cn[:, 1] + cn[:, 2]
        sy = y.std()
        if sy < 1e-8:
            continue
        h = x + x.std() / sy * y
        H[e - l:e] += h - h.mean(); cnt[e - l:e] += 1
    return H / np.maximum(cnt, 1)


def chrom(rgb, fs, win=1.6):
    """CHROM, de Haan & Jeanne, IEEE TBME 2013 (overlap-add with Hann windows)."""
    n = len(rgb); l = int(np.ceil(win * fs)); l += l % 2; step = l // 2
    out = np.zeros(n)
    for s in range(0, n - l + 1, step):
        c = rgb[s:s + l]; cn = c / c.mean(0)
        xs = 3 * cn[:, 0] - 2 * cn[:, 1]; ys = 1.5 * cn[:, 0] + cn[:, 1] - 1.5 * cn[:, 2]
        xf, yf = _bp(xs, fs), _bp(ys, fs)
        a = xf.std() / max(yf.std(), 1e-9)
        s_ = (xf - a * yf) * np.hanning(l)
        out[s:s + l] += s_
    return out


def lgi(rgb, fs):
    """LGI, Pilz et al. CVPRW 2018: project out the dominant (illumination) direction."""
    X = rgb.T  # 3 x n
    U, _, _ = np.linalg.svd(X, full_matrices=False)
    S = U[:, :1]
    P = np.eye(3) - S @ S.T
    Y = P @ X
    return Y[1]


def omit(rgb, fs):
    """OMIT, Casado & Lopez, Expert Syst Appl 2023: QR-based orthogonal projection."""
    X = rgb.T
    Q, _ = np.linalg.qr(X)
    S = Q[:, :1]
    P = np.eye(3) - S @ S.T
    return (P @ X)[1]


def pbv(rgb, fs):
    """PBV, de Haan & van Leest, Physiol Meas 2014."""
    cn = rgb / rgb.mean(0)
    pbv_sig = cn.std(0) / np.sqrt((cn.var(0)).sum())
    C = cn - cn.mean(0)
    Q = C.T @ C
    W = np.linalg.solve(Q + 1e-9 * np.eye(3), pbv_sig)
    return C @ W / (pbv_sig @ W)


def ica(rgb, fs):
    """ICA, Poh et al. Opt Express 2010: FastICA on normalized RGB, pick the most periodic component."""
    from sklearn.decomposition import FastICA
    x = (rgb - rgb.mean(0)) / rgb.std(0)
    S = FastICA(n_components=3, random_state=0, max_iter=1000).fit_transform(x)
    best, bp = None, -1
    for k in range(3):
        f, p = spectrum(S[:, k], fs)
        share = p.max() / p.sum()
        if share > bp:
            best, bp = S[:, k], share
    return best


CLASSICAL = {"GREEN": green, "ICA": ica, "CHROM": chrom, "LGI": lgi, "PBV": pbv, "OMIT": omit, "POS": pos}


# ---------------------------------------------------------------- heart rate
def spectrum(sig, fs, lo=0.75, hi=3.0, step=None):
    """Hann-windowed DFT on a fine grid between lo and hi Hz (the app's estimator)."""
    sig = np.asarray(sig, float); sig = sig - sig.mean(); n = len(sig)
    dur = n / fs
    step = step or 1 / (4 * dur)
    f = np.arange(lo, hi + 1e-9, step)
    w = np.hanning(n)
    t = np.arange(n) / fs
    E = np.exp(-2j * np.pi * np.outer(f, t))
    p = np.abs(E @ (sig * w)) ** 2
    return f, p


def hr_and_quality(sig, fs, lo=0.75, hi=3.0, prefilter=True):
    sig = np.asarray(sig, float)
    if prefilter:
        sig = _bp(detrend(sig, lam=int(10 * fs / 3)), fs, 0.6, 3.3)
    f, p = spectrum(sig, fs, lo, hi)
    k = int(np.argmax(p)); dur = len(sig) / fs
    q = p[np.abs(f - f[k]) <= 1.5 / dur].sum() / p.sum()
    return 60 * f[k], float(q)


def windows(n, fs, win_s=30, step_s=10):
    w, s = int(round(win_s * fs)), int(round(step_s * fs))
    return [(a, a + w) for a in range(0, n - w + 1, s)]
