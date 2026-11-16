"""Second knee dataset: 21 people, OptiTrack markers (truth) vs smartphone video keypoints (YOLOv8n-pose,
2D, published with the dataset). Scores the app's side-on 2D knee-angle rule and rep definitions.
Writes per-rep and per-trial tables. Usage: python -I sync21_knee.py <dataset dir> <out dir>"""
import sys, os, glob, json
import numpy as np, pandas as pd
from scipy.signal import butter, filtfilt, find_peaks

root, outd = sys.argv[1], sys.argv[2]; os.makedirs(outd, exist_ok=True)

def read_trc(path):
    with open(path) as f:
        head = [next(f) for _ in range(5)]
    names = [n for n in head[3].rstrip("\n").split("\t")[2:] if n.strip()]
    rate = float(head[2].split("\t")[0])
    d = pd.read_csv(path, sep="\t", skiprows=5, header=None).values
    d = d[:, 2:2 + 3 * len(names)].astype(float)
    return rate, {n: d[:, 3 * i:3 * i + 3] for i, n in enumerate(names)}

def unit(v): return v / np.linalg.norm(v, axis=-1, keepdims=True)

def mocap_knee(m):
    """Interior knee angle (180 = straight) from Harrington hip centres and lateral knee/ankle markers."""
    asis_mid = (m["LASI"] + m["RASI"]) / 2; psis_mid = (m["LPSI"] + m["RPSI"]) / 2
    y = unit(m["LASI"] - m["RASI"])            # to the left
    x0 = unit(asis_mid - psis_mid)             # forward
    z = unit(np.cross(x0, y)); x = np.cross(y, z)
    pw = np.linalg.norm(m["LASI"] - m["RASI"], axis=-1)[:, None]; pd_ = np.linalg.norm(asis_mid - psis_mid, axis=-1)[:, None]
    out = {}
    for side, s in (("L", 1), ("R", -1)):
        hjc = asis_mid + x * (-0.24 * pd_ - 0.0099) + y * s * (0.33 * pw + 0.0073) + z * (-0.30 * pw - 0.0109)
        k, a = m[f"{side}KNE"], m[f"{side}ANK"]
        u, v = unit(hjc - k), unit(a - k)
        out[side] = np.degrees(np.arccos(np.clip((u * v).sum(-1), -1, 1)))
    return out

def kp_knee(df):
    """2D image-plane knee angle per frame and side, from COCO keypoints (person with best knee confidence)."""
    df = df.sort_values(["frame", "person"])
    best = df[df.keypoint.isin([13, 14])].groupby(["frame", "person"]).confidence.sum().reset_index()
    best = best.loc[best.groupby("frame").confidence.idxmax()][["frame", "person"]]
    df = df.merge(best, on=["frame", "person"])
    piv = {k: g.set_index("frame")[["x", "y", "confidence"]] for k, g in df.groupby("keypoint")}
    frames = np.arange(int(df.frame.max()) + 1); out = {}
    for side, (h, kn, an) in (("L", (11, 13, 15)), ("R", (12, 14, 16))):
        P = [piv[i].reindex(frames) for i in (h, kn, an)]
        u = P[0][["x", "y"]].values - P[1][["x", "y"]].values; v = P[2][["x", "y"]].values - P[1][["x", "y"]].values
        ang = np.degrees(np.arccos(np.clip((u * v).sum(1) / (np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1)), -1, 1)))
        conf = np.minimum.reduce([p.confidence.values for p in P])
        ang[~(conf >= 0.5)] = np.nan
        out[side] = ang
    return out

def lp(x, fs, hz=6):
    b, a = butter(2, hz / (fs / 2)); return filtfilt(b, a, x)

def fill(x):
    x = x.copy(); i = np.arange(len(x)); ok = np.isfinite(x)
    if ok.sum() < 10: return None
    x[~ok] = np.interp(i[~ok], i[ok], x[ok]); return x

def align(truth, truth_fs, est, est_fs_guess):
    """Find video fps and offset that best match the mocap angle (correlation over a grid)."""
    best = (-2, None, None)
    tt = np.arange(len(truth)) / truth_fs
    for fs in (est_fs_guess * f for f in np.linspace(0.97, 1.03, 25)):
        te = np.arange(len(est)) / fs
        for lag in np.arange(-20, 20, 0.05):
            ti = te + lag; ok = (ti >= 0) & (ti <= tt[-1])
            if ok.sum() < 0.5 * len(est): continue
            tr = np.interp(ti[ok], tt, truth)
            c = np.corrcoef(tr, est[ok])[0, 1]
            if c > best[0]: best = (c, fs, lag)
    return best

rows, trials = [], []
for vid_csv in sorted(glob.glob(f"{root}/03_markerless_data/*/*/*.csv")):
    pid, view, act = vid_csv.split("/")[-3], vid_csv.split("/")[-2], os.path.basename(vid_csv)[:-4]
    if act not in ("Squat", "Lunges"): continue
    trc = f"{root}/02_markerbased_data/{pid}/{act}.trc"
    if not os.path.exists(trc): continue
    rate, m = read_trc(trc)
    if not all(k in m for k in ("LASI", "RASI", "LPSI", "RPSI", "LKNE", "RKNE", "LANK", "RANK")): continue
    mk = mocap_knee(m); kp = kp_knee(pd.read_csv(vid_csv))
    dur = len(next(iter(mk.values()))) / rate
    n_est = len(kp["L"]); guess = n_est / dur
    guess = min((30, 60, 120, 240), key=lambda f: abs(f - guess))
    for side in ("L", "R"):
        tr = fill(mk[side]); es = fill(kp[side])
        if tr is None or es is None: continue
        tr = lp(tr, rate); es_f = lp(es, guess)
        # coarse alignment on the 10 Hz-smoothed signals
        c, fs, lag = align(tr[::4], rate / 4, es_f, guess)
        if fs is None: continue
        te = np.arange(len(es_f)) / fs + lag; tt = np.arange(len(tr)) / rate; ok = (te >= 0) & (te <= tt[-1])
        truth_on_video = np.where(ok, np.interp(te, tt, tr), np.nan)
        raw_ok = ok & np.isfinite(kp[side])
        err = es_f[raw_ok] - truth_on_video[raw_ok]
        trials.append(dict(pid=pid, view=view, act=act, side=side, fs=round(fs, 2), corr=round(c, 3), frames=int(raw_ok.sum()),
                           frame_mae=float(np.mean(np.abs(err))), frame_bias=float(np.mean(err))))
        # reps: troughs of the mocap angle (deepest bend), boundaries at the peaks between them
        x = truth_on_video.copy(); x[~ok] = np.nan; xf = fill(x)
        tro, _ = find_peaks(-xf, prominence=25, distance=int(fs * 1.0))
        for i in range(len(tro) - 1):
            a, b = tro[i], tro[i + 1]
            seg_t, seg_e = truth_on_video[a:b], np.where(np.isfinite(kp[side][a:b]), es_f[a:b], np.nan)
            okk = np.isfinite(seg_t) & np.isfinite(seg_e)
            if okk.mean() < 0.8: continue
            ext_t, ext_e = np.percentile(seg_t[okk], 95), np.percentile(seg_e[okk], 95)
            # each rep's ROM: from the deepest bend before it to its extension
            lo_t = np.nanmin(truth_on_video[max(0, a - 3):a + 4]); lo_e = np.nanmin(es_f[max(0, a - 3):a + 4])
            rows.append(dict(pid=pid, view=view, act=act, side=side, rep=i, ext_true=ext_t, ext_cam=ext_e,
                             rom_true=ext_t - lo_t, rom_cam=ext_e - lo_e))
R = pd.DataFrame(rows); T = pd.DataFrame(trials)
R.to_csv(f"{outd}/sync21-knee-reps.csv", index=False); T.to_csv(f"{outd}/sync21-knee-trials.csv", index=False)
print(T.groupby(["act", "view"]).agg(n=("pid", "size"), people=("pid", "nunique"), corr=("corr", "median"), mae=("frame_mae", "median"), bias=("frame_bias", "median")))

# Summary: the knee the app would score (side-on: the near knee; here the one the keypoint model saw in more
# frames), per movement and camera position. Repeat noise = mean moving range of consecutive reps' errors / 1.128.
near = T.loc[T.groupby(["pid", "view", "act"]).frames.idxmax()][["pid", "view", "act", "side"]]
N = R.merge(near, on=["pid", "view", "act", "side"]); out = []
for (act, view), g in N.groupby(["act", "view"]):
    e_rom, e_ext = g.rom_cam - g.rom_true, g.ext_cam - g.ext_true; mr_rom, mr_ext = [], []
    for _, h in g.groupby("pid"):
        h = h.sort_values("rep"); cont = np.diff(h.rep.values) == 1
        mr_rom += list(np.abs(np.diff((h.rom_cam - h.rom_true).values))[cont]); mr_ext += list(np.abs(np.diff((h.ext_cam - h.ext_true).values))[cont])
    sr, se = np.mean(mr_rom) / 1.128, np.mean(mr_ext) / 1.128
    out.append(dict(movement=act, camera=("side-on" if view == "side" else "facing"), people=g.pid.nunique(), reps=len(g),
        true_rom_deg=round(g.rom_true.mean(), 1), rom_mae_deg=round(np.abs(e_rom).mean(), 1), rom_bias_deg=round(e_rom.mean(), 1), rom_sd_deg=round(e_rom.std(), 1),
        rom_repeat_sd_deg=round(sr, 1), rom_mdc95_deg=round(1.96 * np.sqrt(2) * sr, 1),
        ext_mae_deg=round(np.abs(e_ext).mean(), 1), ext_bias_deg=round(e_ext.mean(), 1), ext_repeat_sd_deg=round(se, 1), ext_mdc95_deg=round(1.96 * np.sqrt(2) * se, 1),
        median_trace_corr=round(T[(T.act == act) & (T.view == view)]["corr"].median(), 3)))
S = pd.DataFrame(out); S.to_csv(f"{outd}/sync21-knee-summary.csv", index=False); print(S.to_string())
