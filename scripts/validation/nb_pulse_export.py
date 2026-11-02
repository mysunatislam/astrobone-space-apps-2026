"""Turn nb_pulse_worker.py outputs into JSON for nb-pulse-compare.mjs, with the finger-PPG heart rate of
every scoring window (12 s and 30 s windows ending at 30, 40, 50 and 60 s), computed with the same
spectral estimator as eval_rppg.py.
Usage: python nb_pulse_export.py <npz dir> <out.json>"""
import sys, glob, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from rppg_lib import hr_and_quality

LO, HI = 0.7, 3.5
src, dst = sys.argv[1], sys.argv[2]
r2 = lambda v, d=5: None if v is None or not np.isfinite(v) else round(float(v), d)
import csv
resp = {}
db = os.environ.get("MCD_DB", "/home/user/data/mcd/db.csv")
if os.path.exists(db):
    for row in csv.DictReader(open(db)):
        if row["camera"] == "FullHDwebcam": resp[f"mcd_{row['patient_id']}_{row['step']}"] = float(row["respiratory"]) if row["respiratory"] else None
videos = []
for f in sorted(glob.glob(f"{src}/*.npz")):
    d = np.load(f); n = int(d["n_frames"]); fps = float(d["fps"]); gt = d["gt"]; gfs = float(d["gt_fs"])
    wins = []
    for T in (30, 40, 50, 60):
        if T * fps > n + 1 or T * gfs > len(gt) + 1: continue
        w = {"T": T}
        for L in (12, 30):
            g = gt[int((T - L) * gfs):int(T * gfs)]
            w[f"gt{L}"] = round(hr_and_quality(g, gfs, LO, HI)[0], 2) if len(g) > 5 * gfs and np.std(g) > 0 else None
        wins.append(w)
    videos.append({"id": os.path.basename(f)[:-4], "fps": fps, "n": n, "windows": wins, "respiratory": resp.get(os.path.basename(f)[:-4]),
                   "ab_rgb": [[r2(x, 4) for x in row] for row in d["ab_rgb"]], "ab_motion": [r2(x) for x in d["ab_motion"]],
                   "me": [r2(x, 6) for x in d["me_mesh"]], "nb_rgb": [[r2(x, 6) for x in row] for row in d["nb_rgb"]],
                   "nb_headY": [r2(x, 6) for x in d["nb_headY"]], "nb_motion": [r2(x, 6) for x in d["nb_motion"]], "nb_roi": [int(x) for x in d["nb_roi"]]})
json.dump({"videos": videos}, open(dst, "w"))
print(len(videos), "videos")
