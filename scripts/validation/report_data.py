"""Collect every validation result into one compact JSON for the interactive report and the video assets.

Usage: python report_data.py <pulse eval.json> <pulse js.json> <out.json>
Reads the pose results under /home/user/data (eval_pose.py, hybrid_pose.py) and the pulse results given.
Nothing is recomputed here except resampling signals for display.
"""
import json, os, sys
os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np, pandas as pd

eval_path, js_path, out_path = sys.argv[1:4]
D = "/home/user/data"
r1 = lambda v, d=1: None if v is None or not np.isfinite(v) else round(float(v), d)

MODEL_INFO = {
    "mp-lite": dict(label="MediaPipe Pose lite", note="What the app ran before; runs in the browser", browser=True, family="MediaPipe"),
    "mp-full": dict(label="MediaPipe Pose full", note="Same family, 2x larger", browser=True, family="MediaPipe"),
    "mp-heavy": dict(label="MediaPipe Pose heavy", note="Same family, largest", browser=True, family="MediaPipe"),
    "yolo11m": dict(label="YOLO11m-pose", note="Ultralytics 2024, one-stage", browser=False, family="YOLO"),
    "movenet-thunder": dict(label="MoveNet Thunder", note="Google 2021, single person", browser=True, family="MoveNet"),
    "rtmo-m": dict(label="RTMO-m", note="OpenMMLab 2024, one-stage", browser=False, family="RTM"),
    "vitpose-b": dict(label="ViTPose-B", note="Vision transformer, top-down (2022)", browser=False, family="ViTPose"),
    "synthpose-b": dict(label="SynthPose-B", note="ViTPose fine-tuned on biomechanics markers (OpenCapBench 2024)", browser=False, family="ViTPose"),
}

# ---- Pose: every pretrained model --------------------------------------------------------------
pe = json.load(open(f"{D}/pose_eval.json"))
traces = json.load(open(f"{D}/pose_traces.json"))
models = []
for m, info in MODEL_INFO.items():
    # Only models that finished every video go in the comparison.
    if m not in pe["models"] or sum(m in t["models"] for t in traces.values()) < len(traces):
        continue
    a = pe["models"][m]["all|all"]
    ms = [t["models"][m]["ms"] for t in traces.values() if m in t["models"] and t["models"][m]["ms"]]
    rep = lambda ex, view, est="est2": pe["reps"].get(f"{m}|{est}|{ex}|{view}")
    side_sq, side_lu = rep("Ex6", "side"), rep("Ex5", "side")
    models.append(dict(id=m, **info, detected=a["detected_pct"], pck10=a["pck10_thigh"], kneeErr=a["knee_err_pct_thigh_median"],
                       msPerFrame=r1(np.median(ms)) if ms else None,
                       sideRomMaeSquat=side_sq["rom_err"]["mae"] if side_sq else None, sideRomIccSquat=side_sq["rom_icc"] if side_sq else None,
                       sideRomMaeLunge=side_lu["rom_err"]["mae"] if side_lu else None,
                       frontRom3dMaeSquat=(rep("Ex6", "front", "est3") or {}).get("rom_err", {}).get("mae") if m.startswith("mp-") else None))

# ---- Pose: hybrids (leave-one-person-out) ----------------------------------------------------
hy = json.load(open(f"{D}/pose_hybrid.json"))
hybrid = {}
for m, r in hy.items():
    hybrid[m] = dict(frames=r["frames"], people=r["people"], inRangePct=r.get("in_range_pct"),
                     rep={k: {e: dict(romMae=v[e]["rom"]["mae"], romBias=v[e]["rom"]["bias"], romLoa=v[e]["rom"]["loa"], extMae=v[e]["ext"]["mae"],
                                      romIcc=v[e]["rom_icc21"], n=v[e]["n"]) for e in v} for k, v in r["rep"].items()},
                     frame={k: {e: v[e]["mae"] for e in v if v[e]} for k, v in r["frame"].items()},
                     perPerson=r["per_person_rom_mae"])
rp = pd.read_parquet(f"{D}/pose_hybrid_reps_mp-lite.parquet")
bland = dict(view=rp["view"].tolist(), ex=rp["ex"].tolist(), gt=[r1(v) for v in rp["gt_rom"]], app=[r1(v) for v in rp["est3_rom"]], hybrid=[r1(v) for v in rp["shipped_rom"]])

# ---- Pose: playback of one squat seen by two cameras at once ---------------------------------
hf = pd.read_parquet(f"{D}/pose_hybrid_frames_mp-lite.parquet")
seg = pd.read_csv(f"{D}/rehab24/Segmentation.csv", sep=";")
GT8 = [7, 12, 16, 21, 17, 22, 18, 23]


def ang(a, b, c):
    u, v = a - b, c - b
    return np.degrees(np.arccos(np.clip((u * v).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1) + 1e-12), -1, 1)))


def playback(ex, vid, person):
    out = {"exercise": "Squat" if ex == "Ex6" else "Lunge", "person": int(person), "cams": {}}
    frames = np.load(f"{D}/pose_out/frames_{ex}_{vid}.npy")
    reps = seg[(seg.video_id == vid) & (seg.exercise_id == int(ex[2:])) & (seg.mocap_erroneous == 0) & (seg.cam17_orientation == "front")]
    lo, hi = int(reps.first_frame.min()), int(reps.last_frame.max())
    keep = (frames >= lo) & (frames <= hi)
    g3 = np.load(f"{D}/rehab24/{ex}/{vid}-30fps.npy")[:, :, :3]
    for cam, view in (("c17", "front"), ("c18", "side")):
        d = np.load(f"{D}/pose_out/mp-lite__{ex}_{vid}_{cam}.npz")
        g2 = np.load(f"{D}/rehab24/{ex}/{vid}-{cam}-30fps.npy")
        G2 = g2[frames][:, GT8]; kp = d["kp"]
        pts = np.concatenate([G2[keep].reshape(-1, 2), kp[keep].reshape(-1, 2)]); pts = pts[np.isfinite(pts).all(1)]
        x0, y0 = pts.min(0); span = (pts.max(0) - pts.min(0)).max()
        norm = lambda a: [[None if not np.isfinite(p[0]) else [round(float((p[0] - x0) / span), 4), round(float((p[1] - y0) / span), 4)] for p in f] for f in a]
        h = hf[(hf.vid == vid) & (hf.cam == cam)].set_index(["frame", "side"])
        G3 = g3[frames][:, GT8]
        gt3 = {"left": ang(G3[:, 2], G3[:, 4], G3[:, 6]), "right": ang(G3[:, 3], G3[:, 5], G3[:, 7])}
        w = d["world"]; est3 = {"left": ang(w[:, 2], w[:, 4], w[:, 6]), "right": ang(w[:, 3], w[:, 5], w[:, 7])}
        # The knee the hybrid scored most often in this clip (side-on: the near knee).
        hk = h.reset_index(); hk = hk[hk["frame"].isin(frames[keep])]
        side = hk["side"].mode().iloc[0] if len(hk) else "left"
        hyb = [r1(h.loc[(int(f), side), "shipped"]) if (int(f), side) in h.index else None for f in frames[keep]]
        out["cams"][view] = dict(cam=cam, knee=side, mocap=norm(G2[keep]), model=norm(kp[keep]), gt3=[r1(v) for v in gt3[side][keep]],
                                 app3d=[r1(v) for v in est3[side][keep]], hybrid=hyb)
    out["frames"] = frames[keep].tolist()
    return out


play = playback("Ex6", "PM_105", 6)

# ---- Pulse ---------------------------------------------------------------------------------
ev = json.load(open(eval_path)); js = json.load(open(js_path))
mc = js["summary"]["mcd"]
PULSE_INFO = {
    "Hybrid (app self-check)": ("AstroBone hybrid", "ME-rPPG leading, POS at a quarter weight, spectral fusion; exactly as shipped", "hybrid"),
    "Hybrid, weight chosen without this person": ("AstroBone, held out", "AstroBone hybrid with the POS weight chosen on the other people only", "hybrid"),
    "ME-rPPG + gates (app)": ("ME-rPPG, app", "Deep model, 2025: the app's face-mesh crop and gates", "deep"),
    "ME-rPPG web (ONNX)": ("ME-rPPG, detector crop", "Same browser ONNX model with the official face-detector crop", "deep"),
    "Fusion, equal weights (first design)": ("First hybrid design", "ME-rPPG + POS + CHROM, equal weights; replaced", "first"),
    "ME-chunk.rlap": ("ME-rPPG chunk", "Deep model, offline chunk version", "deep"),
    "FacePhys.rlap": ("FacePhys", "Deep model, 2025", "deep"),
    "PhysNet.pure": ("PhysNet", "Deep model, 2018 (PURE weights)", "deep"),
    "EfficientPhys.pure": ("EfficientPhys", "Deep model, 2023 (PURE weights)", "deep"),
    "POS live (app)": ("AstroBone live", "POS colour wave with the app's gates; Live Capture, no deep model", "hybrid"),
    "POS (JS)": ("POS", "Wang 2017, colour projection", "classic"),
    "CHROM (JS)": ("CHROM", "de Haan 2013, chrominance", "classic"),
    "GREEN": ("GREEN", "Verkruysse 2008, green channel", "classic"),
    "LGI": ("LGI", "Pilz 2018", "classic"), "OMIT": ("OMIT", "Casado 2023", "classic"), "PBV": ("PBV", "de Haan 2014", "classic"),
    "ICA": ("ICA", "Poh 2010", "classic"),
}
pulse_methods = []
for k, (label, note, kind) in PULSE_INFO.items():
    m = mc["methods"].get(k)
    if not m or not m["all"]:
        continue
    pulse_methods.append(dict(id=k, label=label, note=note, kind=kind, **{x: m["all"][x] for x in ("mae", "rmse", "r", "within5", "coverage", "bias", "loa", "n")},
                              sweep=[dict(q=s["minQuality"], mae=s.get("mae"), coverage=s.get("coverage")) for s in m["sweep"]]))
app_windows = [w for v in ev["videos"] if v["id"].startswith("mcd_") for w in v["windows"] if not w["whole"]]
old_refused = 100 * sum(w["app"][0] is None for w in app_windows) / len(app_windows)
old_reasons = {}
for w in app_windows:
    if w["app"][0] is None:
        old_reasons[w["app"][2] or "no clear peak"] = old_reasons.get(w["app"][2] or "no clear peak", 0) + 1
delta = {k: {x: v[x] for x in ("n", "of", "deltaMae", "deltaR", "deltaBias", "directionAgreePct", "flagAgreePct")} | {"pairs": v["pairs"]} for k, v in js["delta"].items() if k in PULSE_INFO}

# One person's pulse wave against the finger sensor, 12 s at rest.
sid = "mcd_1024_before"
z = np.load(f"{D}/rppg_out/{sid}.npz")
fps = float(z["fps"]); n = int(12 * fps); t = np.arange(n) / fps
gt = z["gt"]; gfs = float(z["gt_fs"]); g = np.interp(t, np.arange(len(gt)) / gfs, gt)
me = z["me_mesh"][:n].astype(float)
from scipy.signal import butter, filtfilt
b, a = butter(2, [0.7 / (fps / 2), 3.0 / (fps / 2)], "band")
nz = lambda s: (s - s.mean()) / (s.std() + 1e-9)
wave = dict(id=sid, fps=round(fps, 3), finger=[round(float(v), 3) for v in nz(filtfilt(b, a, g))], camera=[round(float(v), 3) for v in nz(filtfilt(b, a, np.nan_to_num(me)))])
# Display only: the camera wave is shown with the polarity and the delay (pulse transit, at most 0.5 s)
# that best match the finger wave; the heart-rate scoring never uses this alignment.
fw, cw = np.array(wave["finger"]), np.array(wave["camera"])
lags = range(-int(0.5 * fps), int(0.5 * fps) + 1)
score = lambda L: np.corrcoef(fw[max(0, L):len(fw) + min(0, L)], cw[max(0, -L):len(cw) - max(0, L)])[0, 1]
best = max(((L, sgn) for L in lags for sgn in (1, -1)), key=lambda x: x[1] * score(x[0]))
wave["camera"] = [round(float(best[1] * v), 3) for v in np.roll(cw, best[0])]
wave["lagSeconds"] = round(best[0] / fps, 2); wave["r"] = round(float(best[1] * score(best[0])), 3)

windows = [dict(id=r["id"], t0=r["t0"], gt=r1(r["gt"]), hybrid=r1(r["est"].get("Hybrid (app self-check)", {}).get("bpm")), q=r1(r["est"].get("Hybrid (app self-check)", {}).get("q"), 3),
                me=r1(r["est"].get("ME-rPPG web (ONNX)", {}).get("bpm")), pos=r1(r["est"].get("POS (JS)", {}).get("bpm"))) for r in js["rows"] if r["id"].startswith("mcd_")]
people = sorted({v["id"].split("_")[1] for v in ev["videos"] if v["id"].startswith("mcd_")})

out = dict(
    generated=pd.Timestamp.now(tz="UTC").isoformat(timespec="minutes"),
    pose=dict(dataset=dict(name="REHAB24-6", people=9, videos=len(traces), frames=int(sum(len(t["frames"]) for t in traces.values())),
                           reps=int(hy["mp-lite"]["rep"]["all|all"]["est3"]["n"]), cite="Černek et al., 2024"),
              models=models, hybrid=hybrid, bland=bland, playback=play, yaw={k: v for k, v in pe["yaw"].items() if k.startswith("mp-lite")}),
    pulse=dict(dataset=dict(name="MCD-rPPG", people=len(people), videos=len([v for v in ev["videos"] if v["id"].startswith("mcd_")]),
                            windows=mc["windows"], cite="MCD-rPPG, 2025"),
               methods=pulse_methods, oldRefusedPct=r1(old_refused), oldRefusals=old_reasons, delta=delta, wave=wave, windows=windows, fusion=js.get("fusion")),
)
json.dump(out, open(out_path, "w"), separators=(",", ":"))
print("wrote", out_path, os.path.getsize(out_path) // 1024, "KB;", len(models), "pose models;", len(pulse_methods), "pulse methods;", len(people), "people")
