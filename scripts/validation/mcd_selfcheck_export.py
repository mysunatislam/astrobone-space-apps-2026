"""Cut MCD-rPPG traces (from mcd_scale_worker.py) the way the self-check measures: a 45 s recording with the first
3 s dropped, so 42 s per clip, starting 3 s and 18 s into each recording. The reference is the frame-synchronised
finger PPG over the same 42 s, and over its last 30 s (the span the earlier read used). People from the first
validation are left out, so every clip is a new person.
Usage: python -I mcd_selfcheck_export.py <npz dir> <repo> <out dir>"""
import sys, glob, os, json, csv
import numpy as np

src, repo, dst = sys.argv[1:4]; os.makedirs(dst, exist_ok=True)
sys.path.insert(0, f"{repo}/scripts/validation")
from rppg_lib import hr_and_quality

old = {r["person"] for r in csv.DictReader(open(f"{repo}/data/validation/mcd-pulse-rest-vs-squats.csv"))}
SETTLE, READ = 3.0, 42.0
f = lambda x: None if not np.isfinite(x) else round(float(x), 5)
for fp in sorted(glob.glob(f"{src}/*.npz")):
    vid = os.path.basename(fp)[:-4]; pid, cam, st = vid.split("_")
    if pid in old: continue
    d = np.load(fp); fps = float(d["fps"]); gt = d["gt"]; n = min(int(d["n_frames"]), len(gt), len(d["rgb"]))
    clips = []
    for t0 in (SETTLE, SETTLE + 15):
        a, b = int(round(t0 * fps)), int(round((t0 + READ) * fps))
        if b > n or np.std(gt[a:b]) == 0: continue
        hr, q = hr_and_quality(gt[a:b], fps, 0.75, 3.0)
        hr30, q30 = hr_and_quality(gt[b - int(round(30 * fps)):b], fps, 0.75, 3.0)
        clips.append(dict(t0=t0, t1=t0 + READ, gt=round(hr, 2), gtQ=round(q, 3), gt30=round(hr30, 2), gtQ30=round(q30, 3)))
    if not clips: continue
    json.dump(dict(id=vid, person=pid, camera=cam, state=st, fps=fps, clips=clips,
                   rgb=[[f(v) for v in row] for row in d["rgb"][:n]], motion=[f(m) for m in d["motion"][:n]], me=[f(x) for x in d["me_mesh"][:n]]),
              open(f"{dst}/{vid}.json", "w"))
    print(vid, len(clips), flush=True)
