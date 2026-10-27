"""Score every pose model against REHAB24-6 motion capture.

Writes /home/user/data/pose_eval.json with per-model, per-exercise, per-view metrics and a per-rep table,
plus per-frame traces for the report's animated charts.
"""
import csv, glob, json, os, collections
import numpy as np

R = "/home/user/data/rehab24"; P = "/home/user/data/pose_out"
# GT joint rows for [Ls, Rs, Lh, Rh, Lk, Rk, La, Ra]
GT8 = [7, 12, 16, 21, 17, 22, 18, 23]
MODELS = ["mp-lite", "mp-full", "mp-heavy", "yolo11m", "rtmo-m", "movenet-thunder", "vitpose-b", "synthpose-b", "synthpose-b-anat"]
APP_VIS = 0.62
seg = list(csv.DictReader(open(f"{R}/Segmentation.csv"), delimiter=";"))


def ang(a, b, c):
    u, v = a - b, c - b
    cos = (u * v).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1) + 1e-12)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def camera_center(X, x):
    """DLT projection matrix from 3D-2D correspondences; returns the camera centre in mocap space."""
    A = []
    for (X_, Y_, Z_), (u, v) in zip(X, x):
        A.append([X_, Y_, Z_, 1, 0, 0, 0, 0, -u * X_, -u * Y_, -u * Z_, -u])
        A.append([0, 0, 0, 0, X_, Y_, Z_, 1, -v * X_, -v * Y_, -v * Z_, -v])
    Pm = np.linalg.svd(np.array(A))[2][-1].reshape(3, 4)
    C = np.linalg.svd(Pm)[2][-1]
    return C[:3] / C[3]


def view_of(cam, orient17):
    if cam == "c17":
        return {"front": "front", "half-profile": "half", "profile": "side"}[orient17]
    return {"front": "side", "half-profile": "half", "profile": "front"}[orient17]


def body_yaw(w):
    """The app's bodyYaw on MediaPipe world landmarks [Ls, Rs, Lh, Rh, ...]."""
    dx = (abs(w[1, 0] - w[0, 0]) + abs(w[3, 0] - w[2, 0])) / 2; dz = (abs(w[1, 2] - w[0, 2]) + abs(w[3, 2] - w[2, 2])) / 2
    return np.degrees(np.arctan2(dz, dx)), ("left" if w[2, 2] <= w[3, 2] else "right")


def stats(err):
    err = np.asarray(err, float); err = err[np.isfinite(err)]
    if not len(err):
        return None
    b, s = err.mean(), err.std(ddof=1) if len(err) > 1 else 0
    return {"n": int(len(err)), "mae": round(float(np.abs(err).mean()), 2), "median_ae": round(float(np.median(np.abs(err))), 2),
            "bias": round(float(b), 2), "sd": round(float(s), 2), "loa": [round(float(b - 1.96 * s), 2), round(float(b + 1.96 * s), 2)],
            "rmse": round(float(np.sqrt((err ** 2).mean())), 2), "within5": round(float((np.abs(err) <= 5).mean() * 100), 1)}


def icc31(a, b):
    """ICC(3,1) consistency, two-way mixed, single measure (Shrout & Fleiss)."""
    Y = np.column_stack([a, b]); Y = Y[np.isfinite(Y).all(1)]; n, k = Y.shape
    if n < 3:
        return None
    gm = Y.mean(); ssr = k * ((Y.mean(1) - gm) ** 2).sum(); ssc = n * ((Y.mean(0) - gm) ** 2).sum()
    sse = ((Y - gm) ** 2).sum() - ssr - ssc
    msr, mse = ssr / (n - 1), sse / ((n - 1) * (k - 1))
    return round(float((msr - mse) / (msr + (k - 1) * mse)), 3)


rows = []  # per frame, per side
reps_out = []
traces = {}
yaw_rows = []
for job in open(f"{P}/jobs.txt"):
    ex, vid, cam, path, _ = job.split()
    frames = np.load(f"{P}/frames_{ex}_{vid}.npy")
    # The slower models ran on every second scored frame; the model comparison uses only those, for every model.
    common = np.isin(frames, np.load(f"{P}/fsub_{ex}_{vid}.npy"))
    g3 = np.load(f"{R}/{ex}/{vid}-30fps.npy")[:, :, :3]
    g2 = np.load(f"{R}/{ex}/{vid}-{cam}-30fps.npy")
    # Camera centre for near/far knee in this view.
    idx = np.linspace(0, len(g3) - 1, 400).astype(int)
    C = camera_center(g3[idx][:, GT8].reshape(-1, 3), g2[idx][:, GT8].reshape(-1, 2))
    rep_of = {}
    for s in seg:
        if s["video_id"] == vid and s["exercise_id"] == ex[2:] and s["mocap_erroneous"] == "0":
            for f in range(int(s["first_frame"]), int(s["last_frame"]) + 1):
                rep_of[f] = s
    G3 = g3[frames][:, GT8]; G2 = g2[frames][:, GT8]
    gt3 = {"left": ang(G3[:, 2], G3[:, 4], G3[:, 6]), "right": ang(G3[:, 3], G3[:, 5], G3[:, 7])}
    gt2 = {"left": ang(G2[:, 2], G2[:, 4], G2[:, 6]), "right": ang(G2[:, 3], G2[:, 5], G2[:, 7])}
    thigh = {"left": np.linalg.norm(G2[:, 2] - G2[:, 4], axis=1), "right": np.linalg.norm(G2[:, 3] - G2[:, 5], axis=1)}
    dist = {"left": np.linalg.norm(G3[:, 4] - C, axis=1), "right": np.linalg.norm(G3[:, 5] - C, axis=1)}
    for m in MODELS:
        f_ = f"{P}/{m.replace('-anat', '')}__{ex}_{vid}_{cam}.npz"
        if not os.path.exists(f_):
            continue
        d = np.load(f_)
        kp = d["anat"] if m.endswith("-anat") else d["kp"]
        sc = d["score"]; world = d["world"]
        computed = np.ones(len(frames), bool)
        if "frames" in d.files and not np.array_equal(d["frames"], frames):
            # Spread a model's frames onto the scored-frame grid; frames it did not process are skipped below.
            pos = {int(f): k for k, f in enumerate(d["frames"])}
            take = np.array([pos.get(int(f), -1) for f in frames]); computed = take >= 0
            spread = lambda a: np.where(computed.reshape((-1,) + (1,) * (a.ndim - 1)), a[np.maximum(take, 0)], np.nan)
            kp, sc, world = spread(kp), spread(sc), spread(world)
        est2 = {"left": ang(kp[:, 2], kp[:, 4], kp[:, 6]), "right": ang(kp[:, 3], kp[:, 5], kp[:, 7])}
        est3 = {"left": ang(world[:, 2], world[:, 4], world[:, 6]), "right": ang(world[:, 3], world[:, 5], world[:, 7])}
        for i, f in enumerate(frames):
            s = rep_of.get(int(f))
            if s is None or not computed[i]:
                continue
            view = view_of(cam, s["cam17_orientation"])
            near = "left" if dist["left"][i] < dist["right"][i] else "right"
            if m.startswith("mp-") and np.isfinite(world[i, 0, 0]):
                yaw, ns = body_yaw(world[i])
                yaw_rows.append((m, view, yaw, ns == near))
            for j, side in enumerate(("left", "right")):
                kj = 4 + j
                detected = np.isfinite(kp[i, kj, 0]) and np.isfinite(kp[i, 2 + j, 0]) and np.isfinite(kp[i, 6 + j, 0])
                vis = float(min(sc[i, 2 + j], sc[i, kj], sc[i, 6 + j]))
                err_px = float(np.linalg.norm(kp[i, kj] - G2[i, 4 + j])) if detected else np.nan
                rows.append(dict(model=m, ex=ex, vid=vid, cam=cam, view=view, side=side, near=(side == near), frame=int(f), common=bool(common[i]), rep=f"{vid}-{s['repetition_number']}", person=s["person_id"],
                                 yaw=float(body_yaw(world[i])[0]) if m.startswith("mp-") and np.isfinite(world[i, 0, 0]) else np.nan,
                                 thigh2d=float(np.linalg.norm(kp[i, 2 + j] - kp[i, kj])) if detected else np.nan, shank2d=float(np.linalg.norm(kp[i, 6 + j] - kp[i, kj])) if detected else np.nan,
                                 lights=s["lights_on"], detected=bool(detected), vis=vis,
                                 knee_err_rel=err_px / max(thigh[side][i], 1) if detected else np.nan,
                                 gt3=float(gt3[side][i]), gt2=float(gt2[side][i]), est2=float(est2[side][i]) if detected else np.nan,
                                 est3=float(est3[side][i]) if np.isfinite(world[i, kj, 0]) else np.nan))
        # Trace for the report: first rep-dense stretch of this video, near knee.
        key = f"{ex}_{vid}_{cam}"
        tr = traces.setdefault(key, {"frames": frames.tolist(), "view": view_of(cam, rep_of[int(frames[0])]["cam17_orientation"]) if int(frames[0]) in rep_of else None,
                                     "gt3": {k: np.round(v, 1).tolist() for k, v in gt3.items()}, "gt2": {k: np.round(v, 1).tolist() for k, v in gt2.items()},
                                     "near": ["left" if a < b else "right" for a, b in zip(dist["left"], dist["right"])], "models": {}})
        tr["models"][m] = {"est2": {k: [None if not np.isfinite(x) else round(float(x), 1) for x in v] for k, v in est2.items()},
                           "est3": {k: [None if not np.isfinite(x) else round(float(x), 1) for x in v] for k, v in est3.items()} if m.startswith("mp-") else None,
                           "ms": round(float(np.median(d["ms"])), 1) if len(d["ms"]) else None}

json.dump(traces, open("/home/user/data/pose_traces.json", "w"))
import pandas as pd
df = pd.DataFrame(rows)
df.to_parquet("/home/user/data/pose_frames.parquet")
out = {"models": {}, "yaw": {}, "frames": "model comparison on the frames every model processed (every 12th frame of squats, every 20th of lunges)"}
for m, g in df[df["common"]].groupby("model"):
    mo = out["models"].setdefault(m, {})
    for (ex, view), h in list(g.groupby(["ex", "view"])) + [(("all", "all"), g)]:
        det = h["detected"].mean() * 100
        usable = h[h["detected"] & (h["vis"] >= (APP_VIS if m.startswith("mp-") else 0.3))]
        nearh = usable[usable["near"] | (usable["view"] == "front")]
        r = {"frames": int(len(h)), "detected_pct": round(det, 1), "usable_pct": round(len(usable) / max(len(h), 1) * 100, 1),
             "knee_err_pct_thigh_median": round(float(np.nanmedian(usable["knee_err_rel"]) * 100), 1) if len(usable) else None,
             "pck10_thigh": round(float((usable["knee_err_rel"] < 0.10).mean() * 100), 1) if len(usable) else None,
             "angle2d_vs_gt2d": stats(nearh["est2"] - nearh["gt2"]),
             "angle2d_vs_gt3d": stats(nearh["est2"] - nearh["gt3"]),
             "angle3d_vs_gt3d": stats(nearh["est3"] - nearh["gt3"]) if m.startswith("mp-") else None}
        mo[f"{ex}|{view}"] = r
    # Rep-level: extension (95th pct of the interior angle) and ROM (95th - 5th) per rep and knee.
    g2 = g[g["detected"] & (g["vis"] >= (APP_VIS if m.startswith("mp-") else 0.3)) & (g["near"] | (g["view"] == "front"))]
    for (rep, cam, side), h in g2.groupby(["rep", "cam", "side"]):
        if len(h) < 4:
            continue
        for est in ("est2", "est3"):
            e = h[est].dropna()
            if len(e) < 4:
                continue
            reps_out.append(dict(model=m, ex=h["ex"].iloc[0], view=h["view"].iloc[0], rep=rep, cam=cam, side=side, est=est,
                                 gt_ext=float(np.percentile(h["gt3"], 95)), gt_rom=float(np.percentile(h["gt3"], 95) - np.percentile(h["gt3"], 5)),
                                 gt2_rom=float(np.percentile(h["gt2"], 95) - np.percentile(h["gt2"], 5)),
                                 ext=float(np.percentile(e, 95)), rom=float(np.percentile(e, 95) - np.percentile(e, 5))))
rp = pd.DataFrame(reps_out); rp.to_parquet("/home/user/data/pose_reps.parquet")
out["reps"] = {}
for (m, est, ex, view), h in rp.groupby(["model", "est", "ex", "view"]):
    out["reps"][f"{m}|{est}|{ex}|{view}"] = {"n": int(len(h)), "rom_err": stats(h["rom"] - h["gt_rom"]), "ext_err": stats(h["ext"] - h["gt_ext"]),
                                             "rom_icc": icc31(h["rom"].values, h["gt_rom"].values), "rom_r": round(float(np.corrcoef(h["rom"], h["gt_rom"])[0, 1]), 3) if len(h) > 2 else None}
yw = pd.DataFrame(yaw_rows, columns=["model", "view", "yaw", "near_ok"])
for (m, view), h in yw.groupby(["model", "view"]):
    cls = np.where(h["yaw"] < 35, "front", np.where(h["yaw"] < 60, "oblique", "side"))
    out["yaw"][f"{m}|{view}"] = {"n": int(len(h)), "median_yaw": round(float(h["yaw"].median()), 1),
                                 "class_pct": {c: round(float((cls == c).mean() * 100), 1) for c in ("front", "oblique", "side")},
                                 "near_side_correct_pct": round(float(h["near_ok"].mean() * 100), 1)}
json.dump(out, open("/home/user/data/pose_eval.json", "w"), indent=1)
print("frames", len(df), "reps", len(rp))
