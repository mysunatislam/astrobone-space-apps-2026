"""Scale-up camera pulse validation on MCD-rPPG: every camera, at rest and after squats.
Per video: face-mesh skin colour + motion exactly as rppg_lib (mirrors the app), ME-rPPG through the
app's ONNX file with the app's face-mesh crop, and the frame-synchronised finger PPG.
Usage: python -I mcd_scale_worker.py <jobs.txt> <out_dir> <seconds> <shard> <nshards>
"""
import os, sys, time, json, subprocess
sys.path.insert(0, "/home/user/astrobone-space-apps-2026/scripts/validation")
import numpy as np, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
from rppg_lib import skin_boxes, Steady, app_rgb
import onnxruntime as ort

REPO = "/home/user/astrobone-space-apps-2026"; B = "https://huggingface.co/datasets/kyegorov/mcd_rppg/resolve/main"
jobs_file, out_dir, seconds, shard, nshards = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
tmp = f"/home/user/data/tmp_mcd{shard}"; os.makedirs(tmp, exist_ok=True); os.makedirs(out_dir, exist_ok=True)
so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
ME = ort.InferenceSession(f"{REPO}/public/models/me-rppg/model.onnx", so, providers=["CPUExecutionProvider"])
shapes = json.load(open(f"{REPO}/public/models/me-rppg/state.json")); allst = np.fromfile(f"{REPO}/public/models/me-rppg/state.bin", np.float32)
INIT, off = [], 0
for s in shapes:
    n = int(np.prod(s["dims"])); INIT.append(allst[off:off + n].reshape(s["dims"])); off += n
IN = [i.name for i in ME.get_inputs()]
MESH_TO_BLAZE = (-0.0077, 0.1079, 1.0849, 0.9405)

def log(*a): print(time.strftime("%H:%M:%S"), shard, *a, flush=True)

class K:
    def __init__(s, v): s.q, s.r, s.x, s.p = 1e-2, 5e-1, v, 1
    def update(s, z):
        p = s.p + s.q; k = p / (p + s.r); s.x += k * (z - s.x); s.p = (1 - k) * p

def size_of(path):
    out = subprocess.run(["curl", "-sIL", f"{B}/{path}"], capture_output=True, text=True).stdout
    sizes = [int(l.split(":")[1]) for l in out.lower().splitlines() if l.startswith("content-length")]
    return sizes[-1] if sizes else None

def fetch(path, dst, nbytes=None):
    for a in range(5):
        cmd = ["curl", "-sSL", "--fail", "-o", dst] + (["-r", f"0-{nbytes}"] if nbytes else []) + [f"{B}/{path}"]
        if subprocess.run(cmd, timeout=1800).returncode == 0: return
        time.sleep(2 ** a)
    raise RuntimeError("download failed " + path)

def run(video, max_frames):
    cap = cv2.VideoCapture(video); fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    lmk = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=f"{REPO}/public/models/face_landmarker.task"), running_mode=vision.RunningMode.VIDEO, num_faces=1))
    st = [x.copy() for x in INIT]; kf = None; steady = Steady(); prev = None; rgb, motion, me = [], [], []; i = 0; lastT = None
    while i < max_frames:
        ok, bgr = cap.read()
        if not ok: break
        frame = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB); t = i * 1000 / fps; H, W = frame.shape[:2]
        res = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), int(t))
        v, m, bv = None, np.nan, np.nan
        if res.face_landmarks:
            pts = res.face_landmarks[0]; lm = [(p.x, p.y) for p in pts]; boxes = skin_boxes(lm)
            fx, fy, fw, fh = boxes["forehead"]; c = (fx + fw / 2, fy + fh / 2)
            m = 0.0 if prev is None else float(np.hypot(c[0] - prev[0], c[1] - prev[1]) / max(fw, 1e-6)); prev = c
            v = app_rgb(frame, steady(boxes, t, m))
            xs = [p.x * W for p in pts]; ys = [p.y * H for p in pts]; mw, mh = max(xs) - min(xs), max(ys) - min(ys)
            raw = [min(xs) + MESH_TO_BLAZE[0] * mw, min(ys) + MESH_TO_BLAZE[1] * mh, MESH_TO_BLAZE[2] * mw, MESH_TO_BLAZE[3] * mh]
            if kf is None: kf = [K(r) for r in raw]
            else:
                for k_, r in zip(kf, raw): k_.update(r)
            x, y, w, h0 = [k_.x for k_ in kf]; h = h0 * 1.2; y = y - h * 0.2
            x0, y0 = max(0, x), max(0, y); w = min(w, W - x0); h = min(h, H - y0)
            if w >= 2 and h >= 2:
                crop = cv2.resize(frame[int(y0):int(y0 + h), int(x0):int(x0 + w)], (36, 36), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
                dt = max(1 / 30 if lastT is None else (t - lastT) / 1000, 1 / 90); lastT = t
                feeds = {IN[0]: crop[None, None], IN[-1]: np.array(dt, np.float32)}; feeds.update({n: s for n, s in zip(IN[1:-1], st)})
                o = ME.run(None, feeds); bv = float(o[0].reshape(-1)[0]); st = o[1:]
        else: prev = None
        rgb.append(v if v is not None else (np.nan,) * 3); motion.append(m); me.append(bv); i += 1
    cap.release(); lmk.close()
    return np.array(rgb, float), np.array(motion), np.array(me, np.float32), fps, i, (W, H)

jobs = [l.split() for l in open(jobs_file) if l.strip()]
for k, (pid, cam, step) in enumerate(jobs):
    if k % nshards != shard: continue
    jid = f"{pid}_{cam}_{step}"; out = f"{out_dir}/{jid}.npz"
    if os.path.exists(out): continue
    try:
        t0 = time.time(); vpath = f"video/{pid}_{cam}_{step}.avi"; size = size_of(vpath)
        nbytes = int(size * min(1, (seconds + 12) / 175)) if size else None
        vid = f"{tmp}/{jid}.avi"; fetch(vpath, vid, nbytes)
        gt = f"{tmp}/{jid}.ppg"; fetch(f"ppg_sync/{pid}_{cam}_{step}.txt", gt)
        t1 = time.time()
        rgb, motion, me, fps, n, wh = run(vid, int(seconds * 30.5))
        g = np.loadtxt(gt); g = g[:, 0] if g.ndim == 2 else g
        np.savez_compressed(out, rgb=rgb, motion=motion, me_mesh=me, fps=fps, n_frames=n, gt=g.astype(float), gt_fs=fps, wh=np.array(wh))
        os.remove(vid); os.remove(gt)
        log("done", jid, n, "frames", round(t1 - t0), "s dl", round(time.time() - t1), "s proc")
    except Exception as e:
        log("FAIL", jid, repr(e))
