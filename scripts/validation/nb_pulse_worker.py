"""Head-to-head traces for the NeuroBridge VitalSense pulse vs the AstroBone self-check pulse.

Usage: python nb_pulse_worker.py <out_dir> [seconds=60] [ids...]
For each MCD-rPPG front-webcam video (rest and after squats, the same 40 people as the main validation)
it writes <out_dir>/<id>.npz with, per frame:
  ab_rgb, ab_motion   AstroBone's skin colour and motion (rppg_lib.skin_boxes/Steady/app_rgb, as rppg_worker.py)
  me_mesh             ME-rPPG (browser ONNX) cropped from the face-mesh box, as src/meRppg.js ships it
  nb_rgb, nb_headY, nb_motion, nb_roi   NeuroBridge app/perception.js samplePulse: three forehead/cheek
                      rectangles from app/vitalsense.js vitalROIs, each area-averaged to 16x16, brightness
                      gate .08-.95, mean of accepted rectangles in 0-1; headY = mean landmark y; motion =
                      the same EMA of landmark displacement per second
  gt, gt_fs           finger PPG resampled to video frames (ppg_sync)
Downloads are deleted after use.
"""
import os, sys, json, time, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from rppg_lib import skin_boxes, Steady, app_rgb
import onnxruntime as ort

HF = "https://huggingface.co/datasets/kyegorov/mcd_rppg/resolve/main"
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODELS = os.environ.get("MODELS", "/home/user/models")
IDS = [1020, 1024, 1035, 1091, 1097, 1099, 1107, 1113, 1115, 1149, 1156, 1176, 1180, 1181, 1213, 1217, 1234, 1259, 1266, 1275,
       1285, 1287, 1292, 1298, 1305, 1314, 1360, 1362, 1386, 1399, 1414, 1442, 1474, 1477, 1513, 1531, 1541, 1543, 1563, 1581]
MESH_TO_BLAZE = (-0.0077, 0.1079, 1.0849, 0.9405)
out_dir = sys.argv[1]; seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 60
only = set(sys.argv[3:])
tmp = os.path.join(out_dir, "tmp"); os.makedirs(tmp, exist_ok=True)

ME = ort.InferenceSession(f"{REPO}/public/models/me-rppg/model.onnx", providers=["CPUExecutionProvider"])
_shapes = json.load(open(f"{REPO}/public/models/me-rppg/state.json")); _all = np.fromfile(f"{REPO}/public/models/me-rppg/state.bin", np.float32); ME_INIT = {}; _o = 0
for _s in _shapes:
    _n = int(np.prod(_s["dims"])); ME_INIT[_s["name"]] = _all[_o:_o + _n].reshape(_s["dims"]); _o += _n
ME_IN = [i.name for i in ME.get_inputs()]


class Kalman1D:
    def __init__(self, q, r, x, p): self.q, self.r, self.x, self.p = q, r, x, p
    def update(self, z):
        p = self.p + self.q; k = p / (p + self.r); self.x += k * (z - self.x); self.p = (1 - k) * p


def nb_rois(lm, W, H):
    xs = [p.x for p in lm]; ys = [p.y for p in lm]
    left, top = min(xs), min(ys); bw, bh = max(xs) - left, max(ys) - top
    if bw < .08 or bh < .1: return []
    out = []
    for x, y, w, h in [[.32, .06, .36, .14], [.16, .46, .20, .16], [.64, .46, .20, .16]]:
        px = max(0, int(np.floor((left + x * bw) * W))); py = max(0, int(np.floor((top + y * bh) * H)))
        rw = min(W - px, max(4, round(w * bw * W))); rh = min(H - py, max(4, round(h * bh * H)))
        if rw >= 4 and rh >= 4: out.append((px, py, rw, rh))
    return out


def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)


def process(vid_path, fps):
    cap = cv2.VideoCapture(vid_path)
    lmk = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=f"{MODELS}/face_landmarker.task"), running_mode=vision.RunningMode.VIDEO, num_faces=1))
    steady = Steady(); prev_c = None; prev_lm = None; nb_m = 0.0
    state = [ME_INIT[n] for n in ME_IN[1:-1]]; kf = None
    rec = {k: [] for k in ("ab_rgb", "ab_motion", "me_mesh", "nb_rgb", "nb_headY", "nb_motion", "nb_roi")}
    i = 0; nmax = int(round(seconds * fps))
    while i < nmax:
        ok, bgr = cap.read()
        if not ok: break
        frame = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB); H, W = frame.shape[:2]; t = i * 1000 / fps
        res = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), int(t))
        ab, m, me, nb, hy, roi = (np.nan,) * 3, np.nan, np.nan, (np.nan,) * 3, np.nan, 0
        if res.face_landmarks:
            L = res.face_landmarks[0]
            lm = [(p.x, p.y) for p in L]; boxes = skin_boxes(lm)
            fx, fy, fw, fh = boxes["forehead"]; c = (fx + fw / 2, fy + fh / 2)
            m = 0.0 if prev_c is None else float(np.hypot(c[0] - prev_c[0], c[1] - prev_c[1]) / max(fw, 1e-6)); prev_c = c
            v = app_rgb(frame, steady(boxes, t, m))
            if v is not None: ab = tuple(v)
            # ME-rPPG, face-mesh box mapped to BlazeFace, Kalman, 20 % taller and raised, 36x36
            xs_ = [p.x * W for p in L]; ys_ = [p.y * H for p in L]; mw, mh = max(xs_) - min(xs_), max(ys_) - min(ys_)
            raw = [min(xs_) + MESH_TO_BLAZE[0] * mw, min(ys_) + MESH_TO_BLAZE[1] * mh, MESH_TO_BLAZE[2] * mw, MESH_TO_BLAZE[3] * mh]
            if kf is None: kf = [Kalman1D(1e-2, 5e-1, v_, 1) for v_ in raw]
            else:
                for k_, v_ in zip(kf, raw): k_.update(v_)
            x, y, w, h0 = [k_.x for k_ in kf]; h = h0 * 1.2; y = y - h * 0.2
            x0, y0 = max(0, x), max(0, y); w = min(w, W - x0); h = min(h, H - y0)
            if w >= 2 and h >= 2:
                crop = cv2.resize(frame[int(y0):int(y0 + h), int(x0):int(x0 + w)], (36, 36), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
                feeds = {ME_IN[0]: crop[None, None], ME_IN[-1]: np.array(1 / fps, np.float32)}
                feeds.update({n: s for n, s in zip(ME_IN[1:-1], state)})
                o = ME.run(None, feeds); me = float(o[0].reshape(-1)[0]); state = o[1:]
            # NeuroBridge samplePulse
            if prev_lm is not None:
                d = [np.hypot(L[j].x - prev_lm[j].x, L[j].y - prev_lm[j].y) for j in range(0, len(L), 8)]
                nb_m = .7 * nb_m + .3 * (sum(d) / max(1, len(d))) * 1000 / (1000 / fps)
            else: nb_m = 0.0
            prev_lm = L
            acc = []
            for (px, py, rw, rh) in nb_rois(L, W, H):
                tile = cv2.resize(frame[py:py + rh, px:px + rw], (16, 16), interpolation=cv2.INTER_AREA).reshape(-1, 3).mean(0) / 255
                if .08 < tile.mean() < .95: acc.append(tile)
            roi = len(acc)
            if acc: nb = tuple(np.mean(acc, 0)); hy = float(np.mean([p.y for p in L]))
        else:
            prev_c = None; prev_lm = None; nb_m = 0.0
        for k, v in (("ab_rgb", ab), ("ab_motion", m), ("me_mesh", me), ("nb_rgb", nb), ("nb_headY", hy), ("nb_motion", nb_m), ("nb_roi", roi)):
            rec[k].append(v)
        i += 1
    cap.release(); lmk.close()
    return {k: np.array(v, float) for k, v in rec.items()}, i


for pid in IDS:
    for step in ("before", "after"):
        jid = f"mcd_{pid}_{step}"
        if only and jid not in only and str(pid) not in only: continue
        out = f"{out_dir}/{jid}.npz"
        if os.path.exists(out): continue
        t0 = time.time()
        try:
            v = f"{tmp}/{jid}.avi"; g = f"{tmp}/{jid}.txt"
            subprocess.run(["curl", "-sSL", "--fail", "-o", v, f"{HF}/video/{pid}_FullHDwebcam_{step}.avi"], check=True, timeout=1800)
            subprocess.run(["curl", "-sSL", "--fail", "-o", g, f"{HF}/ppg_sync/{pid}_FullHDwebcam_{step}.txt"], check=True, timeout=600)
            fps = cv2.VideoCapture(v).get(cv2.CAP_PROP_FPS) or 30.0
            rec, n = process(v, fps)
            gt = np.loadtxt(g)[:, 0]
            np.savez_compressed(out, fps=fps, n_frames=n, gt=gt, gt_fs=fps, **rec)
            os.remove(v); os.remove(g)
            log("done", jid, n, "frames", round(time.time() - t0), "s")
        except Exception as e:
            log("FAIL", jid, repr(e))
