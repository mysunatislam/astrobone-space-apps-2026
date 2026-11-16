"""Export scale-up MCD-rPPG traces for the JS scorer, with the reference pulse per 30 s window,
reference RMSSD from the frame-synchronised finger PPG (first 60 s) and the ECG (whole record),
and the face's skin colour as an Individual Typology Angle (ITA).
Usage: python -I mcd_scale_export.py <npz dir> <ecg cache dir> <out dir>"""
import sys, os, glob, json, subprocess
sys.path.insert(0, "/home/user/astrobone-space-apps-2026/scripts/validation")
import numpy as np
from scipy.signal import butter, filtfilt, find_peaks
from rppg_lib import hr_and_quality, windows

src, ecg_dir, dst = sys.argv[1:4]; os.makedirs(dst, exist_ok=True); os.makedirs(ecg_dir, exist_ok=True)
B = "https://huggingface.co/datasets/kyegorov/mcd_rppg/resolve/main"

def bp(x, fs, lo, hi, order=2):
    b, a = butter(order, [lo / (fs / 2), hi / (fs / 2)], btype="band"); return filtfilt(b, a, x)

def clean_rr(t_peaks):
    iv = np.diff(t_peaks)
    if len(iv) < 5: return None
    med = np.median(iv); keep = (iv >= 0.33) & (iv <= 1.5) & (np.abs(iv - med) <= 0.2 * med)
    return iv, keep

def rmssd(iv, keep):
    # successive differences only between two kept, adjacent intervals
    d = [(iv[i + 1] - iv[i]) * 1000 for i in range(len(iv) - 1) if keep[i] and keep[i + 1]]
    return float(np.sqrt(np.mean(np.square(d)))) if len(d) >= 10 else None

def ppg_rmssd(g, fs, seconds=60):
    g = np.asarray(g[:int(seconds * fs)], float)
    if len(g) < 30 * fs or np.std(g) == 0: return None, None
    s = bp(g - g.mean(), fs, 0.6, 3.3)
    pk, _ = find_peaks(s, distance=int(0.33 * fs))
    t = []
    for i in pk:
        if 0 < i < len(s) - 1:
            a, b, c = s[i - 1], s[i], s[i + 1]; den = a - 2 * b + c
            t.append((i + (0.5 * (a - c) / den if den else 0)) / fs)
    r = clean_rr(np.array(t))
    if r is None: return None, None
    iv, keep = r; return rmssd(iv, keep), float(keep.mean())

def ecg_rmssd(pid, step):
    path = f"{ecg_dir}/{pid}_{step}.json"
    if not os.path.exists(path):
        subprocess.run(["curl", "-sSL", "--fail", "-o", path, f"{B}/ecg/{pid}_{step}.json"], timeout=300)
    try:
        d = json.load(open(path)); fs = float(d["frequency"]); y = d.get("data") or []
        lead = next((l for l in y if isinstance(l, dict) and l.get("title") == "II"), y[1] if len(y) > 1 else None)
        y = np.asarray(lead["values"] if isinstance(lead, dict) else lead, float)
    except Exception:
        return None, None
    if len(y) < 25 * fs: return None, None
    f = bp(y - np.median(y), fs, 5, 20)
    for sign in (1, -1):
        pk, _ = find_peaks(sign * f, distance=int(0.33 * fs), height=np.percentile(sign * f, 98) * 0.4)
        if len(pk) > 0.6 * len(y) / fs: break
    r = clean_rr(pk / fs)
    if r is None: return None, None
    iv, keep = r; return rmssd(iv, keep), float(keep.mean())

def ita(rgb):
    c = np.nanmean(rgb, 0) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    X, Y, Z = M @ lin; Xn, Yn, Zn = 0.95047, 1.0, 1.08883
    f = lambda t: np.cbrt(t) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29
    L = 116 * f(Y / Yn) - 16; b = 200 * (f(Y / Yn) - f(Z / Zn))
    return float(np.degrees(np.arctan2(L - 50, b))), float(L), float(b)

for fp in sorted(glob.glob(f"{src}/*.npz")):
    vid = os.path.basename(fp)[:-4]; out = f"{dst}/{vid}.json"
    if os.path.exists(out): continue
    pid, cam, step = vid.split("_")
    d = np.load(fp); n = int(d["n_frames"]); fps = float(d["fps"]); gt = d["gt"]; n = min(n, int(60.5 * fps))
    ws = []
    for a, b in windows(min(n, len(gt)), fps, 30, 10):
        g = gt[a:b]
        if np.std(g) == 0: continue
        hr, q = hr_and_quality(g, fps, 0.75, 3.0); ws.append({"t0": round(a / fps, 2), "t1": round(b / fps, 2), "gt": round(hr, 2), "gt_q": round(q, 3)})
    r_ppg, k_ppg = ppg_rmssd(gt, fps)
    r_ecg, k_ecg = ecg_rmssd(pid, step)
    rgb = d["rgb"][:n]; it = ita(rgb) if np.isfinite(rgb).any() else (None, None, None)
    json.dump({"id": vid, "person": pid, "camera": cam, "state": step, "fps": fps, "n": n,
               "ita": it[0], "skinL": it[1],
               "ref": {"rmssdPpg": r_ppg, "ppgKept": k_ppg, "rmssdEcg": r_ecg, "ecgKept": k_ecg},
               "windows": ws,
               "rgb": [[None if not np.isfinite(v) else round(float(v), 4) for v in row] for row in rgb],
               "motion": [None if not np.isfinite(m) else round(float(m), 5) for m in d["motion"][:n]],
               "me": [None if not np.isfinite(x) else round(float(x), 6) for x in d["me_mesh"][:n]]}, open(out, "w"))
    print(vid, len(ws), r_ppg and round(r_ppg), r_ecg and round(r_ecg), it[0] and round(it[0]), flush=True)
