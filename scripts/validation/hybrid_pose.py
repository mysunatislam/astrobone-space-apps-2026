"""Hybrid knee-angle models on top of a pretrained pose model, validated leave-one-person-out.

The pretrained model (MediaPipe Pose) gives two knee angles per frame: the 3D world-landmark angle the app
uses today (est3) and the 2D image-plane angle (est2). Each is wrong in a different camera view, so the
hybrids combine them with the body yaw the app already measures:

  rule     side-on (yaw >= 60) -> 2D angle, otherwise the 3D angle (a fixed rule, nothing fitted)
  blend    ridge regression on [est2, est3, yaw terms, thigh/shank foreshortening, visibility] -> mocap angle
  gbm      gradient-boosted trees on the same features (research comparison; not shipped)

Every fitted hybrid is scored on people it never saw (leave-one-person-out over the 9 REHAB24-6 people), at the
frame level and at the rep level (extension = 95th percentile, ROM = 95th - 5th percentile, the app's definitions).
Usage: python hybrid_pose.py <model> [<model> ...]   writes /home/user/data/pose_hybrid.json
"""
import json, os, sys
os.environ.setdefault("OMP_NUM_THREADS", "1")  # OpenMP threads stall badly on a loaded machine
import numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.ensemble import HistGradientBoostingRegressor

APP_VIS = 0.62
SIDE_YAW = 60.0
GBM = dict(max_iter=100, learning_rate=0.1, max_leaf_nodes=15, min_samples_leaf=40, random_state=0)  # the shipped size (see the size sweep in the report)


def features(h):
    s = np.sin(np.radians(np.clip(h["yaw"].values, 0, 90))) ** 2  # 0 facing the camera, 1 side-on
    e2, e3 = h["est2"].values, h["est3"].values
    ratio = np.log(np.clip(h["thigh2d"].values, 1, None) / np.clip(h["shank2d"].values, 1, None))
    return np.column_stack([e2, e3, e2 * s, e3 * s, s, ratio, ratio * s, ratio * (1 - s), h["vis"].values])


FEATURES = ["est2", "est3", "est2*s", "est3*s", "s", "log(thigh/shank)", "log(thigh/shank)*s", "log(thigh/shank)*(1-s)", "visibility"]


def stats(err):
    err = np.asarray(err, float); err = err[np.isfinite(err)]
    if len(err) < 2:
        return None
    b, sd = err.mean(), err.std(ddof=1)
    return {"n": int(len(err)), "mae": round(float(np.abs(err).mean()), 2), "bias": round(float(b), 2),
            "loa": [round(float(b - 1.96 * sd), 2), round(float(b + 1.96 * sd), 2)], "within5": round(float((np.abs(err) <= 5).mean() * 100), 1),
            "within10": round(float((np.abs(err) <= 10).mean() * 100), 1)}


def icc31(a, b):
    Y = np.column_stack([a, b]); Y = Y[np.isfinite(Y).all(1)]; n, k = Y.shape
    if n < 3:
        return None
    gm = Y.mean(); ssr = k * ((Y.mean(1) - gm) ** 2).sum(); ssc = n * ((Y.mean(0) - gm) ** 2).sum()
    sse = ((Y - gm) ** 2).sum() - ssr - ssc
    msr, mse = ssr / (n - 1), sse / ((n - 1) * (k - 1))
    return round(float((msr - mse) / (msr + (k - 1) * mse)), 3)


def icc21(a, b):
    """ICC(2,1) absolute agreement: penalizes a constant offset, unlike ICC(3,1)."""
    Y = np.column_stack([a, b]); Y = Y[np.isfinite(Y).all(1)]; n, k = Y.shape
    if n < 3:
        return None
    gm = Y.mean(); ssr = k * ((Y.mean(1) - gm) ** 2).sum(); ssc = n * ((Y.mean(0) - gm) ** 2).sum()
    sse = ((Y - gm) ** 2).sum() - ssr - ssc
    msr, msc, mse = ssr / (n - 1), ssc / (k - 1), sse / ((n - 1) * (k - 1))
    return round(float((msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n)), 3)


def run(model, df):
    d = df[(df["model"] == model) & df["detected"] & (df["vis"] >= APP_VIS) & (df["near"] | (df["view"] == "front"))].copy()
    d = d[np.isfinite(d[["est2", "est3", "yaw", "thigh2d", "shank2d"]]).all(1)].reset_index(drop=True)
    X, y = features(d), d["gt3"].values
    d["rule"] = np.where(d["yaw"] >= SIDE_YAW, d["est2"], d["est3"])
    d["blend"] = np.nan; d["gbm"] = np.nan; d["shipped"] = np.nan; d["in_range"] = False
    people = sorted(d["person"].unique())
    for p in people:
        tr, te = (d["person"] != p).values, (d["person"] == p).values
        d.loc[te, "blend"] = Ridge(alpha=10.0).fit(X[tr], y[tr]).predict(X[te])
        g = HistGradientBoostingRegressor(**GBM).fit(X[tr], y[tr]).predict(X[te])
        d.loc[te, "gbm"] = g
        # Shipped: the trees only inside the feature ranges they were trained on, else the fixed rule.
        lo, hi = np.percentile(X[tr], [0.5, 99.5], axis=0)
        inside = ((X[te] >= lo) & (X[te] <= hi)).all(1)
        d.loc[te, "in_range"] = inside
        d.loc[te, "shipped"] = np.where(inside, g, d.loc[te, "rule"].values)
    final = Ridge(alpha=10.0).fit(X, y)
    ests = ["est3", "est2", "rule", "blend", "gbm", "shipped"]
    out = {"model": model, "people": len(people), "frames": int(len(d)), "in_range_pct": round(float(d["in_range"].mean() * 100), 1), "coef": dict(zip(FEATURES, np.round(final.coef_, 5).tolist())), "intercept": round(float(final.intercept_), 4), "frame": {}, "rep": {}}
    groups = [(f"{ex}|{view}", h) for (ex, view), h in d.groupby(["ex", "view"])] + [("all|all", d)]
    for key, h in groups:
        out["frame"][key] = {e: stats(h[e] - h["gt3"]) for e in ests}
    reps = []
    for (rep, cam, side), h in d.groupby(["rep", "cam", "side"]):
        if len(h) < 4:
            continue
        r = dict(ex=h["ex"].iloc[0], view=h["view"].iloc[0], person=h["person"].iloc[0], rep=rep, cam=cam, side=side,
                 gt_ext=np.percentile(h["gt3"], 95), gt_rom=np.percentile(h["gt3"], 95) - np.percentile(h["gt3"], 5))
        for e in ests:
            r[f"{e}_ext"] = np.percentile(h[e], 95); r[f"{e}_rom"] = np.percentile(h[e], 95) - np.percentile(h[e], 5)
        reps.append(r)
    rp = pd.DataFrame(reps)
    for key, h in [(f"{ex}|{view}", h) for (ex, view), h in rp.groupby(["ex", "view"])] + [("all|all", rp)]:
        out["rep"][key] = {e: {"n": int(len(h)), "rom": stats(h[f"{e}_rom"] - h["gt_rom"]), "ext": stats(h[f"{e}_ext"] - h["gt_ext"]),
                               "rom_icc31": icc31(h[f"{e}_rom"].values, h["gt_rom"].values), "rom_icc21": icc21(h[f"{e}_rom"].values, h["gt_rom"].values),
                               "ext_icc21": icc21(h[f"{e}_ext"].values, h["gt_ext"].values)} for e in ests}
    # Per-person rep ROM MAE, to show the gain holds for each held-out person, not just on average.
    out["per_person_rom_mae"] = {str(p): {e: round(float(np.abs(h[f"{e}_rom"] - h["gt_rom"]).mean()), 2) for e in ests} for p, h in rp.groupby("person")}
    rp.to_parquet(f"/home/user/data/pose_hybrid_reps_{model}.parquet")
    d[["ex", "vid", "cam", "view", "side", "frame", "rep", "person", "yaw", "gt3", "est2", "est3", "rule", "blend", "gbm", "shipped", "in_range"]].to_parquet(f"/home/user/data/pose_hybrid_frames_{model}.parquet")
    return out


if __name__ == "__main__":
    df = pd.read_parquet("/home/user/data/pose_frames.parquet")
    models = sys.argv[1:] or ["mp-lite"]
    res = {m: run(m, df) for m in models}
    json.dump(res, open("/home/user/data/pose_hybrid.json", "w"), indent=1)
    for m, r in res.items():
        print(f"== {m}: {r['frames']} frames, {r['people']} people (leave-one-person-out)")
        for key in r["rep"]:
            row = "  ".join(f"{e} {r['rep'][key][e]['rom']['mae'] if r['rep'][key][e]['rom'] else '-':>5}" for e in r["rep"][key])
            print(f"  rep ROM MAE {key:12s} n={r['rep'][key]['est3']['n']:4d}  {row}")
        for key in r["frame"]:
            row = "  ".join(f"{e} {r['frame'][key][e]['mae'] if r['frame'][key][e] else '-':>5}" for e in r["frame"][key])
            print(f"  frame MAE   {key:12s}  {row}")
        print("  ICC21 ROM all:", {e: r["rep"]["all|all"][e]["rom_icc21"] for e in r["rep"]["all|all"]})
        print("  per person ROM MAE:", r["per_person_rom_mae"])
