"""Measure complete A/B inference on a supplied real image; never an accuracy benchmark."""
import argparse
import json
import sys
import time
from pathlib import Path
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vision.engine import VisionEngine

parser = argparse.ArgumentParser()
parser.add_argument('--image', required=True)
parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
parser.add_argument('--runs', type=int, default=12)
parser.add_argument('--output', default='.artifacts/vision-benchmark.json')
args = parser.parse_args()
image = cv2.imread(args.image)
if image is None:
    raise ValueError('Image not readable')
image = cv2.resize(image, (int(image.shape[1] * 640 / image.shape[0]), 640))
engine = VisionEngine(args.device)
result = {'input': args.image, 'capabilities': engine.status(), 'scope': 'Single-image latency only. Not motion/accuracy validation; not a claimed webcam FPS.', 'pipelines': {}}
for pipeline in ['A', 'B']:
    samples = []
    for index in range(args.runs + 2):
        start = time.perf_counter()
        frame = engine.predict(image, pipeline)
        encoded = json.dumps(frame, allow_nan=False)
        ms = (time.perf_counter() - start) * 1000
        if frame['status'] != 'estimated':
            raise RuntimeError(frame)
        if index >= 2:
            samples.append(ms)
    result['pipelines'][pipeline] = {'median_ms': float(np.median(samples)), 'p95_ms': float(np.percentile(samples, 95)), 'runs': len(samples), 'last_compute_ms': frame['timing_ms'], 'response_bytes': len(encoded), 'vertices': len(frame['vertices'] or []), 'wholebody_landmarks': len(frame['wholebody_2d'] or [])}
    print(pipeline, result['pipelines'][pipeline], flush=True)
result['lower_latency_pipeline'] = min(result['pipelines'], key=lambda k: result['pipelines'][k]['median_ms'])
result['capabilities'] = engine.status()
result['selection_policy'] = 'Latency alone does not justify removing the whole-body branch. Compare motion/occlusion quality before making it the default.'
out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, indent=2))
out.with_suffix('.frame.json').write_text(json.dumps(frame, allow_nan=False))
print(out, flush=True)
