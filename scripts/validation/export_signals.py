"""Export each processed video's pulse signals for the JS scorer (scripts/validation/score-wave-pulse.mjs)."""
import sys, glob, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from rppg_lib import CLASSICAL
from eval_rppg_helpers import interp_nan

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(glob.glob(f"{src}/*.npz")):
    vid = os.path.basename(f)[:-4]; out = f"{dst}/{vid}.json"
    if os.path.exists(out) and os.path.getmtime(out) > os.path.getmtime(f):
        continue
    d = np.load(f); n = int(d["n_frames"]); fps = float(d["fps"])
    rgb = d["rgb"][:n]; sig = {}
    rgbi = interp_nan(rgb)
    if rgbi is not None and (~np.isfinite(rgb).all(1)).mean() < 0.1:
        for name in ("POS", "CHROM", "GREEN", "LGI", "OMIT"):
            sig[name] = [None if not np.isfinite(x) else round(float(x), 6) for x in CLASSICAL[name](rgbi, fps)]
    if "me_mesh" in d.files:
        sig["ME-rPPG mesh box (app)"] = [None if not np.isfinite(x) else round(float(x), 6) for x in d["me_mesh"][:n]]
    if "me_web" in d.files:
        sig["ME-rPPG web (ONNX)"] = [None if not np.isfinite(x) else round(float(x), 6) for x in d["me_web"][:n]]
    for k in d.files:
        if k.startswith("deep::"):
            sig[k[6:]] = [None if not np.isfinite(x) else round(float(x), 6) for x in d[k]]
    json.dump({"id": vid, "fps": fps, "n": n,
               "rgb": [[None if not np.isfinite(v) else round(float(v), 4) for v in row] for row in rgb],
               "motion": [None if not np.isfinite(m) else round(float(m), 5) for m in d["motion"][:n]],
               "signals": sig}, open(out, "w"))
print("ok")
