"""Fit the BlazeFace box from the face-mesh landmark box (so the browser can crop for ME-rPPG from the mesh)."""
import sys, json, numpy as np, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
X, Y = [], []
for path in sys.argv[1:]:
    cap = cv2.VideoCapture(path); fps = cap.get(5) or 30
    det = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(base_options=BaseOptions(model_asset_path="/home/user/models/blaze_face_short_range.tflite"), running_mode=vision.RunningMode.VIDEO))
    lmk = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path="/home/user/models/face_landmarker.task"), running_mode=vision.RunningMode.VIDEO))
    i = 0
    while i < 900:
        ok, bgr = cap.read()
        if not ok: break
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)); t = int(i * 1000 / fps)
        d = det.detect_for_video(img, t).detections; m = lmk.detect_for_video(img, t).face_landmarks
        if d and m and i % 5 == 0:
            H, W = bgr.shape[:2]; b = d[0].bounding_box
            xs = np.array([p.x for p in m[0]]) * W; ys = np.array([p.y for p in m[0]]) * H
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            X.append([x0, y0, x1 - x0, y1 - y0]); Y.append([b.origin_x, b.origin_y, b.width, b.height])
        i += 1
X, Y = np.array(X), np.array(Y)
# Box = mesh box centre + scale: bx = cx + a*w, by = cy + b*h, bw = c*w, bh = d*h
cx, cy, w, h = X[:, 0], X[:, 1], X[:, 2], X[:, 3]
a = np.median((Y[:, 0] - cx) / w); b_ = np.median((Y[:, 1] - cy) / h); c = np.median(Y[:, 2] / w); d_ = np.median(Y[:, 3] / h)
pred = np.column_stack([cx + a * w, cy + b_ * h, c * w, d_ * h])
err = np.abs(pred - Y) / Y[:, 2:3]
print(json.dumps({"n": len(X), "x": round(a, 4), "y": round(b_, 4), "w": round(c, 4), "h": round(d_, 4), "median_err_pct_of_width": np.round(np.median(err, 0) * 100, 2).tolist()}))
