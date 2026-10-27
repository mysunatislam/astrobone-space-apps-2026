"""Run one pose model over the repetition frames of one REHAB24-6 video.

Usage: python run_pose.py <model> <video> <out.npz> <frames.npy> [boxes.npz]
frames.npy lists the evaluation frame indices. Every model returns, for each evaluation frame,
L/R shoulder, hip, knee, ankle in pixels (8 x 2) plus a score per point; MediaPipe also returns
its 3D world landmarks (the app's knee angle uses them).
"""
import os, sys, time
import numpy as np, cv2

model, video, out, frames_file = sys.argv[1:5]
boxes_file = sys.argv[5] if len(sys.argv) > 5 else None
eval_frames = np.load(frames_file)
eval_set = set(int(f) for f in eval_frames)
cap = cv2.VideoCapture(video)
W, H = int(cap.get(3)), int(cap.get(4))
# COCO order: 5 Ls 6 Rs 11 Lh 12 Rh 13 Lk 14 Rk 15 La 16 Ra
COCO8 = [5, 6, 11, 12, 13, 14, 15, 16]
MP8 = [11, 12, 23, 24, 25, 26, 27, 28]

kp = np.full((len(eval_frames), 8, 2), np.nan); sc = np.zeros((len(eval_frames), 8))
world = np.full((len(eval_frames), 8, 3), np.nan); extra = {}
times = []
row = {int(f): i for i, f in enumerate(eval_frames)}

if model.startswith("mp-"):
    import mediapipe as mp
    from mediapipe.tasks.python import vision, BaseOptions
    variant = model[3:]
    lmk = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=f"/home/user/models/pose_landmarker_{variant}.task"),
        running_mode=vision.RunningMode.VIDEO, num_poses=1))
    # Feed every 3rd frame across the span (10 fps, a slow phone) so the
    # tracker behaves as it does live; record only evaluation frames.
    first, last = int(eval_frames.min()), int(eval_frames.max())
    feed = set(range(first - first % 2, last + 1, 3)) | eval_set
    cap.set(cv2.CAP_PROP_POS_FRAMES, first - first % 2)
    f = first - first % 2
    while f <= last:
        ok, bgr = cap.read()
        if not ok:
            break
        if f in feed:
            t = time.perf_counter()
            res = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)), int(f * 1000 / 30))
            if f in eval_set:
                times.append(time.perf_counter() - t)
                if res.pose_landmarks:
                    r = row[f]; lm = res.pose_landmarks[0]; wl = res.pose_world_landmarks[0]
                    for j, k in enumerate(MP8):
                        kp[r, j] = (lm[k].x * W, lm[k].y * H); sc[r, j] = min(lm[k].visibility or 0, lm[k].presence or 1)
                        world[r, j] = (wl[k].x, wl[k].y, wl[k].z)
        f += 1
    lmk.close()
else:
    def frames_iter():
        for f in sorted(eval_set):
            cap.set(cv2.CAP_PROP_POS_FRAMES, f) if f != getattr(frames_iter, "next", -1) else None
            ok, bgr = cap.read(); frames_iter.next = f + 1
            if ok:
                yield f, bgr

    if model == "yolo11m":
        from ultralytics import YOLO
        net = YOLO("/home/user/models/yolo11m-pose.pt")
        person_boxes = np.full((len(eval_frames), 5), np.nan)
        for f, bgr in frames_iter():
            t = time.perf_counter(); r0 = net(bgr, verbose=False, imgsz=640)[0]; times.append(time.perf_counter() - t)
            if len(r0.boxes):
                b = r0.boxes.xyxy.numpy(); conf = r0.boxes.conf.numpy(); area = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
                i = int(np.argmax(area * conf)); r = row[f]
                person_boxes[r] = [*b[i], conf[i]]
                k = r0.keypoints.data.numpy()[i]
                kp[r] = k[COCO8, :2]; sc[r] = k[COCO8, 2]
        extra["boxes"] = person_boxes
    elif model == "rtmo-m":
        import onnxruntime as ort
        s = ort.InferenceSession("/home/user/models/rtmo-m.onnx", providers=["CPUExecutionProvider"])
        for f, bgr in frames_iter():
            t = time.perf_counter()
            scale = 640 / max(W, H); img = np.full((640, 640, 3), 114, np.uint8)
            rs = cv2.resize(bgr, (int(W * scale), int(H * scale))); img[:rs.shape[0], :rs.shape[1]] = rs
            dets, kps = s.run(None, {"input": img.transpose(2, 0, 1)[None].astype(np.float32)})
            times.append(time.perf_counter() - t)
            d = dets[0]
            if len(d) and d[:, 4].max() > 0.3:
                area = (d[:, 2] - d[:, 0]) * (d[:, 3] - d[:, 1]); i = int(np.argmax(area * (d[:, 4] > 0.3)))
                r = row[f]; kp[r] = kps[0, i, COCO8, :2] / scale; sc[r] = kps[0, i, COCO8, 2]
    else:
        boxes = np.load(boxes_file)["boxes"]
        if model == "movenet-thunder":
            import onnxruntime as ort
            s = ort.InferenceSession("/home/user/models/movenet-thunder.onnx", providers=["CPUExecutionProvider"])
        else:
            import torch
            from transformers import AutoProcessor, VitPoseForPoseEstimation
            path = {"vitpose-b": "usyd-community_vitpose-base-simple", "synthpose-b": "stanfordmimi_synthpose-vitpose-base-hf"}[model]
            proc = AutoProcessor.from_pretrained(f"/home/user/models/{path}")
            net = VitPoseForPoseEstimation.from_pretrained(f"/home/user/models/{path}").eval()
        for f, bgr in frames_iter():
            r = row[f]; b = boxes[r]
            if not np.isfinite(b[0]):
                continue
            t = time.perf_counter()
            if model == "movenet-thunder":
                cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2; side = max(b[2] - b[0], b[3] - b[1]) * 1.25
                M = np.array([[256 / side, 0, 128 - cx * 256 / side], [0, 256 / side, 128 - cy * 256 / side]])
                crop = cv2.warpAffine(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), M, (256, 256))
                o = s.run(None, {"input": crop[None].astype(np.int32)})[0][0, 0]
                pts = o[:, [1, 0]] * 256
                pts = (pts - [128 - cx * 256 / side, 128 - cy * 256 / side]) * side / 256
                kp[r] = pts[COCO8]; sc[r] = o[COCO8, 2]
            else:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                inputs = proc(rgb, boxes=[[[b[0], b[1], b[2] - b[0], b[3] - b[1]]]], return_tensors="pt")
                with torch.no_grad():
                    o = net(**inputs)
                res = proc.post_process_pose_estimation(o, boxes=[[[b[0], b[1], b[2] - b[0], b[3] - b[1]]]])[0][0]
                k = res["keypoints"].numpy(); s_ = res["scores"].numpy()
                kp[r] = k[COCO8]; sc[r] = s_[COCO8]
                if model == "synthpose-b":
                    # Anatomical joint centres: knee = mid lateral/medial epicondyle, ankle = mid malleoli.
                    a = kp[r].copy(); ss = sc[r].copy()
                    a[4] = (k[33] + k[35]) / 2; a[5] = (k[32] + k[34]) / 2; a[6] = (k[37] + k[39]) / 2; a[7] = (k[36] + k[38]) / 2
                    extra.setdefault("anat", np.full((len(eval_frames), 8, 2), np.nan))[r] = a
            times.append(time.perf_counter() - t)

np.savez_compressed(out, frames=eval_frames, kp=kp, score=sc, world=world, ms=np.array(times) * 1000, W=W, H=H, **extra)
print(out, "ms/frame median %.0f" % (np.median(times) * 1000 if times else -1), "detected", int(np.isfinite(kp[:, 4, 0]).sum()), "/", len(eval_frames), flush=True)
