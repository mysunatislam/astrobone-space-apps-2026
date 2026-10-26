"""Process a queue of rPPG videos with every method, loading each deep model once.

Usage: python rppg_worker.py <jobs.tsv> <out_dir> [seconds]
jobs.tsv rows: id <TAB> video path or URL <TAB> gt kind (mcd|ubfc) <TAB> gt path or URL
Writes <out_dir>/<id>.npz (skips ids already done). Downloaded videos are deleted after use.
"""
import os, sys, time, json, subprocess, urllib.request
os.environ.setdefault("KERAS_BACKEND", "jax")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from rppg_lib import skin_boxes, Steady, app_rgb
import rppg

DEEP = ["FacePhys.rlap", "ME-chunk.rlap", "PhysNet.pure", "EfficientPhys.pure"]  # RhythmMamba, PhysFormer, TSCAN dropped after the first videos (slow on CPU or no output)
jobs_file, out_dir = sys.argv[1:3]
seconds = float(sys.argv[3]) if len(sys.argv) > 3 else None
tmp = "/home/user/data/tmp_rppg"; os.makedirs(tmp, exist_ok=True); os.makedirs(out_dir, exist_ok=True)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def fetch(src, dst):
    if not src.startswith("http"):
        return src, False
    for attempt in range(4):
        try:
            subprocess.run(["curl", "-sSL", "--fail", "-o", dst, src], check=True, timeout=1800)
            return dst, True
        except Exception as e:
            log("download retry", attempt, e); time.sleep(2 ** attempt)
    raise RuntimeError("download failed " + src)


class Kalman1D:
    """The ME-rPPG web demo's 1-D Kalman filter."""
    def __init__(self, q, r, x, p):
        self.q, self.r, self.x, self.p = q, r, x, p

    def update(self, z):
        p = self.p + self.q; k = p / (p + self.r); self.x += k * (z - self.x); self.p = (1 - k) * p
        return self.x


import onnxruntime as ort
ME_SESSION = ort.InferenceSession("/home/user/models/me-web/model.onnx", providers=["CPUExecutionProvider"])
ME_INIT = {k: np.array(v, np.float32) for k, v in json.load(open("/home/user/models/me-web/state.json")).items()}
ME_IN = [i.name for i in ME_SESSION.get_inputs()]; ME_OUT = [o.name for o in ME_SESSION.get_outputs()]


# BlazeFace box from the face-mesh landmark box (fit_facebox.py, 540 frames, median error ~2 % of face width):
# x = x0 - 0.0077 w, y = y0 + 0.1079 h, width = 1.0849 w, height = 0.9405 h.
MESH_TO_BLAZE = (-0.0077, 0.1079, 1.0849, 0.9405)


def traces(video, max_frames):
    cap = cv2.VideoCapture(video); fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    lmk = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path="/home/user/models/face_landmarker.task"), running_mode=vision.RunningMode.VIDEO, num_faces=1))
    det = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path="/home/user/models/blaze_face_short_range.tflite"), running_mode=vision.RunningMode.VIDEO, min_detection_confidence=0.5))
    state = [ME_INIT[n] for n in ME_IN[1:-1]]; kf = None; me = []
    # Second ME-rPPG run cropping from the face-mesh box mapped to BlazeFace's (what the browser ships).
    state2 = [ME_INIT[n] for n in ME_IN[1:-1]]; kf2 = None; me2 = []
    steady = Steady(); prev = None; rgb, motion, fbox = [], [], []
    i = 0
    while max_frames is None or i < max_frames:
        ok, bgr = cap.read()
        if not ok:
            break
        frame = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB); t = i * 1000 / fps
        res = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), int(t))
        v, m, fb = None, np.nan, (np.nan,) * 4
        if res.face_landmarks:
            lm = [(p.x, p.y) for p in res.face_landmarks[0]]; boxes = skin_boxes(lm)
            fx, fy, fw, fh = boxes["forehead"]; c = (fx + fw / 2, fy + fh / 2)
            m = 0.0 if prev is None else float(np.hypot(c[0] - prev[0], c[1] - prev[1]) / max(fw, 1e-6)); prev = c
            v = app_rgb(frame, steady(boxes, t, m))
            xs = [p[0] for p in lm]; ys = [p[1] for p in lm]; fb = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
        else:
            prev = None
        # ME-rPPG as its official web demo runs it: BlazeFace box, Kalman-smoothed, 20 % taller and
        # raised, cropped to 36 x 36, one recurrent step per frame.
        bv = np.nan
        dets = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), int(t)).detections
        if dets:
            bb = dets[0].bounding_box; raw = [bb.origin_x, bb.origin_y, bb.width, bb.height]
            if kf is None:
                kf = [Kalman1D(1e-2, 5e-1, v, 1) for v in raw]
            else:
                for k_, v_ in zip(kf, raw):
                    k_.update(v_)
            x, y, w, h0 = [k_.x for k_ in kf]; h = h0 * 1.2; y = y - h * 0.2
            x0, y0 = max(0, x), max(0, y); w = min(w, frame.shape[1] - x0); h = min(h, frame.shape[0] - y0)
            if w >= 2 and h >= 2:
                crop = cv2.resize(frame[int(y0):int(y0 + h), int(x0):int(x0 + w)], (36, 36), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
                feeds = {ME_IN[0]: crop[None, None], ME_IN[-1]: np.array(1 / fps, np.float32)}
                feeds.update({n: st for n, st in zip(ME_IN[1:-1], state)})
                o = ME_SESSION.run(None, feeds); bv = float(o[0].reshape(-1)[0]); state = o[1:]
        me.append(bv)
        bv2 = np.nan
        if res.face_landmarks:
            H_, W_ = frame.shape[:2]
            xs_ = [p.x * W_ for p in res.face_landmarks[0]]; ys_ = [p.y * H_ for p in res.face_landmarks[0]]
            mw, mh = max(xs_) - min(xs_), max(ys_) - min(ys_)
            raw2 = [min(xs_) + MESH_TO_BLAZE[0] * mw, min(ys_) + MESH_TO_BLAZE[1] * mh, MESH_TO_BLAZE[2] * mw, MESH_TO_BLAZE[3] * mh]
            if kf2 is None:
                kf2 = [Kalman1D(1e-2, 5e-1, v, 1) for v in raw2]
            else:
                for k_, v_ in zip(kf2, raw2):
                    k_.update(v_)
            x, y, w, h0 = [k_.x for k_ in kf2]; h = h0 * 1.2; y = y - h * 0.2
            x0, y0 = max(0, x), max(0, y); w = min(w, frame.shape[1] - x0); h = min(h, frame.shape[0] - y0)
            if w >= 2 and h >= 2:
                crop = cv2.resize(frame[int(y0):int(y0 + h), int(x0):int(x0 + w)], (36, 36), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
                feeds = {ME_IN[0]: crop[None, None], ME_IN[-1]: np.array(1 / fps, np.float32)}
                feeds.update({n: st for n, st in zip(ME_IN[1:-1], state2)})
                o = ME_SESSION.run(None, feeds); bv2 = float(o[0].reshape(-1)[0]); state2 = o[1:]
        me2.append(bv2)
        rgb.append(v if v is not None else (np.nan,) * 3); motion.append(m); fbox.append(fb); i += 1
    cap.release(); lmk.close(); det.close()
    traces.me = np.array(me, np.float32); traces.me2 = np.array(me2, np.float32)
    return np.array(rgb, float), np.array(motion), np.array(fbox, np.float32), fps, i


log("loading models")
models = {name: rppg.Model(name) for name in DEEP}
log("models loaded")
for line in open(jobs_file):
    if not line.strip():
        continue
    jid, vsrc, gkind, gsrc = line.rstrip("\n").split("\t")
    out = f"{out_dir}/{jid}.npz"
    if os.path.exists(out):
        continue
    try:
        t0 = time.time()
        video, dl = fetch(vsrc, f"{tmp}/{jid}{os.path.splitext(vsrc)[1]}")
        gt_path, gdl = fetch(gsrc, f"{tmp}/{jid}.gt.txt")
        t_dl = time.time() - t0
        if seconds:  # trim with a stream copy so frames are unchanged
            fps0 = cv2.VideoCapture(video).get(cv2.CAP_PROP_FPS) or 30.0
            trimmed = f"{tmp}/{jid}.trim{os.path.splitext(video)[1]}"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-frames:v", str(int(round(seconds * fps0))), "-c", "copy", trimmed], check=True)
            if dl:
                os.remove(video)
            video, dl = trimmed, True
        t1 = time.time()
        rgb, motion, fbox, fps, n = traces(video, None)
        t_tr = time.time() - t1
        save = dict(rgb=rgb, motion=motion, face_box=fbox, fps=fps, n_frames=n, t_trace=t_tr, me_web=traces.me, me_mesh=traces.me2)
        for name, model in models.items():
            t2 = time.time()
            try:
                model.process_video(video)
                b, ts = model.bvp(raw=True)
                save[f"deep::{name}"] = np.asarray(b, np.float32); save[f"deepts::{name}"] = np.asarray(ts, np.float32)
            except Exception as e:
                log("FAIL", jid, name, repr(e))
            save[f"deeptime::{name}"] = time.time() - t2
        if gkind == "mcd":
            gt = np.loadtxt(gt_path)[:, 0]; gt_fs = fps
        else:
            rows = [np.array(l.split(), float) for l in open(gt_path) if l.strip()]
            gt, gt_t = rows[0], rows[2]; gt_fs = (len(gt_t) - 1) / (gt_t[-1] - gt_t[0])
        save.update(gt=np.asarray(gt, float), gt_fs=gt_fs)
        np.savez_compressed(out, **save)
        log("done", jid, json.dumps({"frames": n, "dl": round(t_dl), "trace": round(t_tr), "deep": {k.split("::")[1]: round(v) for k, v in save.items() if k.startswith("deeptime")}}))
        if dl:
            os.remove(video)
        if gdl:
            os.remove(gt_path)
    except Exception as e:
        log("JOB FAIL", jid, repr(e))
