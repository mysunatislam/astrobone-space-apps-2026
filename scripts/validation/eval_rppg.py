"""Score every pulse method against the contact PPG reference.

Usage: python eval_rppg.py <out.json> <npz dir>...
Per video: 30 s windows every 10 s, plus the whole clip. Every method's pulse signal goes through the
same detrend, band-pass and spectral peak, so differences come from the signal, not the HR estimator.
'POS (app)' reproduces src/rppg.js exactly: its own gates (light, motion, 60 % spectral peak share),
no band-pass, 45-180 bpm band.
"""
import sys, glob, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from rppg_lib import CLASSICAL, hr_and_quality, spectrum, pos, windows
from eval_rppg_helpers import interp_nan

out_path = sys.argv[1]
files = sorted(f for d in sys.argv[2:] for f in glob.glob(f"{d}/*.npz"))
LO, HI = 0.7, 3.5  # 42-210 bpm for the evaluation band (post-exercise rates exceed 180)


def app_pos(rgb, motion, fps):
    """src/rppg.js estimatePulse on one window: returns (bpm or None, quality, refusal reason)."""
    if not np.isfinite(rgb).all():
        return None, 0, "face lost"
    if ((rgb < 20) | (rgb > 240)).any():
        return None, 0, "lighting"
    if (motion > 0.035).sum() > 0.1 * len(motion):
        return None, 0, "movement"
    sig = pos(rgb, fps)
    f, p = spectrum(sig, fps, 0.75, 3.0)
    k = int(np.argmax(p)); dur = len(sig) / fps
    q = p[np.abs(f - f[k]) <= 1.5 / dur].sum() / p.sum()
    if q < 0.6:
        return None, q, "ambiguous spectrum"
    return 60 * f[k], q, None


results = {"videos": [], "methods": {}}
per_method_rows = {}
for fpath in files:
    d = np.load(fpath)
    vid = os.path.basename(fpath)[:-4]
    fps = float(d["fps"]); n = int(d["n_frames"])
    gt = d["gt"]; gt_fs = float(d["gt_fs"])
    rgb = d["rgb"][:n]; motion = np.nan_to_num(d["motion"][:n], nan=1.0)
    sigs = {}
    rgbi = interp_nan(rgb)
    missing = (~np.isfinite(rgb).all(1)).mean()
    if rgbi is not None and missing < 0.1:
        for name, fn in CLASSICAL.items():
            try:
                sigs[name] = (fn(rgbi, fps), fps)
            except Exception as e:
                print("fail", vid, name, e)
    if "me_mesh" in d.files:
        mm = interp_nan(d["me_mesh"][:n])
        if mm is not None:
            sigs["ME-rPPG mesh box (app)"] = (mm, fps)
    if "me_web" in d.files:
        me = interp_nan(d["me_web"][:n])
        if me is not None:
            sigs["ME-rPPG web (ONNX)"] = (me, fps)
    for k in d.files:
        if k.startswith("deep::"):
            name = k[6:]; b = d[k]; ts = d[f"deepts::{name}"]
            if len(b) > 60:
                sigs[name] = (np.asarray(b, float), 30.0)
    vrow = {"id": vid, "fps": fps, "frames": n, "face_missing_pct": round(missing * 100, 1), "windows": []}
    gt_len_s = len(gt) / gt_fs
    clip_s = min(n / fps, gt_len_s)
    spans = [(a / fps, b / fps) for a, b in windows(int(clip_s * fps), fps, 30, 10)] + [(0, clip_s)]
    for (t0, t1) in spans:
        g = gt[int(t0 * gt_fs):int(t1 * gt_fs)]
        if len(g) < 10 * gt_fs or np.std(g) == 0:
            continue
        gt_hr, gt_q = hr_and_quality(g, gt_fs, LO, HI)
        w = {"t0": round(t0, 1), "t1": round(t1, 1), "whole": t1 - t0 > 31, "gt": round(gt_hr, 2), "gt_q": round(gt_q, 3), "est": {}}
        for name, (s, sfs) in sigs.items():
            seg = s[int(t0 * sfs):int(t1 * sfs)]
            if len(seg) < 10 * sfs or not np.isfinite(seg).all() or np.std(seg) == 0:
                continue
            hr, q = hr_and_quality(seg, sfs, LO, HI)
            w["est"][name] = [round(hr, 2), round(q, 3)]
        a0, a1 = int(t0 * fps), int(t1 * fps)
        bpm, q, why = app_pos(rgb[a0:a1], motion[a0:a1], fps)
        w["app"] = [None if bpm is None else round(bpm, 2), round(float(q), 3), why]
        vrow["windows"].append(w)
    results["videos"].append(vrow)


def metrics(pairs):
    pairs = np.array([p for p in pairs if p[1] is not None], float)
    if len(pairs) < 2:
        return None
    gt, est = pairs[:, 0], pairs[:, 1]; e = est - gt
    return {"n": int(len(e)), "mae": round(float(np.abs(e).mean()), 2), "rmse": round(float(np.sqrt((e ** 2).mean())), 2),
            "mape": round(float((np.abs(e) / gt).mean() * 100), 2), "r": round(float(np.corrcoef(gt, est)[0, 1]), 3),
            "within5": round(float((np.abs(e) <= 5).mean() * 100), 1), "bias": round(float(e.mean()), 2),
            "loa": [round(float(e.mean() - 1.96 * e.std(ddof=1)), 2), round(float(e.mean() + 1.96 * e.std(ddof=1)), 2)]}


names = sorted({k for v in results["videos"] for w in v["windows"] for k in w["est"]})
for dataset in sorted({v["id"].split("_")[0] for v in results["videos"]}):
    vids = [v for v in results["videos"] if v["id"].startswith(dataset)]
    block = {}
    for scope in ("window30", "whole"):
        ws = [w for v in vids for w in v["windows"] if w["whole"] == (scope == "whole")]
        m = {}
        for name in names:
            m[name] = metrics([(w["gt"], w["est"][name][0]) for w in ws if name in w["est"]])
            if m[name]:
                m[name]["coverage"] = round(100 * sum(name in w["est"] for w in ws) / len(ws), 1)
        app_pairs = [(w["gt"], w["app"][0]) for w in ws]
        m["POS (app, gated)"] = metrics(app_pairs)
        if m["POS (app, gated)"]:
            m["POS (app, gated)"]["coverage"] = round(100 * sum(p[1] is not None for p in app_pairs) / len(app_pairs), 1)
            reasons = {}
            for w in ws:
                if w["app"][2]:
                    reasons[w["app"][2]] = reasons.get(w["app"][2], 0) + 1
            m["POS (app, gated)"]["refusals"] = reasons
        block[scope] = m
    # Personal baseline (MCD): rest vs after 15 squats for the same person.
    if dataset == "mcd":
        subj = {}
        for v in vids:
            _, sid, step = v["id"].split("_")
            whole = [w for w in v["windows"] if w["whole"]]
            first = [w for w in v["windows"] if not w["whole"] and w["t0"] == 0]
            subj.setdefault(sid, {})[step] = (whole[0] if whole else None, first[0] if first else None)
        delta = {}
        for name in names + ["POS (app, gated)"]:
            rows = []
            for sid, s in subj.items():
                if "before" not in s or "after" not in s or not s["before"][1] or not s["after"][1]:
                    continue
                b, a = s["before"][1], s["after"][1]  # first 30 s of each recording
                if name == "POS (app, gated)":
                    eb, ea = b["app"][0], a["app"][0]
                else:
                    eb = b["est"].get(name, [None])[0]; ea = a["est"].get(name, [None])[0]
                rows.append({"id": sid, "gt_before": b["gt"], "gt_after": a["gt"], "est_before": eb, "est_after": ea})
            ok = [r for r in rows if r["est_before"] is not None and r["est_after"] is not None]
            if len(ok) < 3:
                continue
            gd = np.array([r["gt_after"] - r["gt_before"] for r in ok]); ed = np.array([r["est_after"] - r["est_before"] for r in ok])
            floor = 8  # the app's resting-HR review floor
            delta[name] = {"n": len(ok), "of": len(rows), "delta_mae": round(float(np.abs(ed - gd).mean()), 2),
                           "delta_r": round(float(np.corrcoef(gd, ed)[0, 1]), 3), "direction_agree_pct": round(float((np.sign(gd) == np.sign(ed)).mean() * 100), 1),
                           "flag_agree_pct": round(float(((gd >= floor) == (ed >= floor)).mean() * 100), 1),
                           "rows": ok}
        block["baseline_delta"] = delta
    results["methods"][dataset] = block
json.dump(results, open(out_path, "w"), indent=1)
for ds, b in results["methods"].items():
    print("==", ds)
    for scope in ("window30", "whole"):
        print(" ", scope)
        for name, m in sorted(b[scope].items(), key=lambda kv: kv[1]["mae"] if kv[1] else 1e9):
            if m:
                print(f"   {name:24s} MAE {m['mae']:6.2f} RMSE {m['rmse']:6.2f} r {m['r']:6.3f} <=5 {m['within5']:5.1f}% cov {m.get('coverage')} n {m['n']}")
    if "baseline_delta" in b:
        print("  delta (after squats - rest, first 30 s)")
        for name, m in sorted(b["baseline_delta"].items(), key=lambda kv: kv[1]["delta_mae"]):
            print(f"   {name:24s} dMAE {m['delta_mae']:6.2f} r {m['delta_r']:6.3f} dir {m['direction_agree_pct']}% flag {m['flag_agree_pct']}% n {m['n']}/{m['of']}")
