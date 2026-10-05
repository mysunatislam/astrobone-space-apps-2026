"""Builds a face video with a known, injected pulse for checking the camera pulse and stress readout.

The face is one frame of a video you supply (--source, with --frame and --crop x,y,size locating a
still, front-facing face), enlarged to 700 x 700. Every frame adds a blood-volume colour change at known beat times (72 bpm with
breathing-linked variation), plus sensor noise, then H.264 compression. The truth is written next to
the video, so the browser's estimate can be checked against it.

Usage: python scripts/make-pulse-test-video.py [out.mp4] --source face.mp4 --frame 20 --crop 470,150,280
       [--seconds 40] [--bpm 72] [--swing-ms 60]
A .mjpeg output is a Motion-JPEG stream for Chrome's fake webcam (--use-file-for-fake-video-capture).
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("out", nargs="?", default=".artifacts/video-sync/face-pulse.mp4")
parser.add_argument("--source", required=True, help="video containing a still, front-facing face")
parser.add_argument("--frame", type=int, default=0, help="frame index to use")
parser.add_argument("--crop", default=None, help="x,y,size of a square around the face (default: centre square)")
parser.add_argument("--seconds", type=float, default=40)
parser.add_argument("--fps", type=float, default=30)
parser.add_argument("--bpm", type=float, default=72)
parser.add_argument("--swing-ms", type=float, default=60, help="beat-interval swing with breathing (0.25 Hz)")
parser.add_argument("--amplitude", type=float, default=1.6, help="green-channel pulse amplitude, grey levels")
parser.add_argument("--noise", type=float, default=1.0, help="sensor noise, grey levels (standard deviation)")
args = parser.parse_args()

capture = cv2.VideoCapture(args.source)
capture.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
ok, frame = capture.read()
if not ok:
    raise SystemExit(f"cannot read {args.source}")
if args.crop:
    x, y, size = (int(v) for v in args.crop.split(","))
else:
    size = min(frame.shape[:2]); x, y = (frame.shape[1] - size) // 2, (frame.shape[0] - size) // 2
face = cv2.resize(frame[y:y + size, x:x + size], (700, 700), interpolation=cv2.INTER_CUBIC).astype(np.float32)

# Beat times: mean interval 60/bpm, swinging with a 0.25 Hz breathing rhythm.
mean_interval = 60 / args.bpm
beats = [0.0]
while beats[-1] < args.seconds + 2:
    beats.append(beats[-1] + mean_interval + args.swing_ms / 1000 * np.sin(2 * np.pi * 0.25 * beats[-1]))
beats = np.array(beats)


def pulse(t):
    """Blood-volume pulse at time t: a systolic peak and a smaller dicrotic wave, zero mean."""
    k = np.searchsorted(beats, t, side="right") - 1
    phase = (t - beats[k]) / (beats[k + 1] - beats[k])
    return np.exp(-((phase - 0.18) / 0.09) ** 2) + 0.35 * np.exp(-((phase - 0.5) / 0.12) ** 2) - 0.36


# More blood absorbs more light, most in green (relative change per channel, B, G, R order).
signature = np.array([0.53, 0.77, 0.33], dtype=np.float32) / 0.77 * args.amplitude
rng = np.random.default_rng(7)
out = Path(args.out)
out.parent.mkdir(parents=True, exist_ok=True)
mjpeg = out.suffix.lower() == ".mjpeg"
if mjpeg:
    stream = out.open("wb")
else:
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"avc1"), args.fps, (700, 700))
    if not writer.isOpened():
        raise SystemExit("H.264 encoder unavailable")
for i in range(int(args.seconds * args.fps)):
    t = i / args.fps
    image = np.clip(face - signature * pulse(t) + rng.normal(0, args.noise, face.shape).astype(np.float32), 0, 255).astype(np.uint8)
    if mjpeg:
        stream.write(cv2.imencode(".jpg", cv2.resize(image, (480, 480), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes())
    else:
        writer.write(image)
if mjpeg:
    stream.close()
else:
    writer.release()

intervals = np.diff(beats[beats <= args.seconds]) * 1000
truth = {
    "video": out.name, "fps": args.fps, "seconds": args.seconds, "bpm": round(60 / (intervals.mean() / 1000), 1),
    "rmssdMs": round(float(np.sqrt(np.mean(np.diff(intervals) ** 2))), 1), "sdnnMs": round(float(intervals.std()), 1),
    "amplitudeGreyLevels": args.amplitude, "noiseGreyLevels": args.noise,
}
out.with_suffix(".truth.json").write_text(json.dumps(truth, indent=2))
print(json.dumps(truth))
