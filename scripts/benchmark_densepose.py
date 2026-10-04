"""Local runtime smoke/latency check, not model accuracy or clinical validation."""
import argparse
import base64
import hashlib
import json
import time
from pathlib import Path

import cv2
import httpx
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path('.artifacts/densepose-benchmark'))
    parser.add_argument('--runs', type=int, default=10)
    args = parser.parse_args()
    image = cv2.imread(str(args.image))
    if image is None:
        raise ValueError('Could not decode test image')
    scale = min(1, 640 / max(image.shape[:2]))
    image = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)))
    _, jpeg = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 82])
    args.out.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url='http://127.0.0.1:8012', timeout=180) as client:
        response = client.post('/initialize')
        response.raise_for_status()
        runtime = response.json()
        assert runtime['ready'] and runtime['device'] == 'cuda' and runtime['retains_frames'] is False
        measurements = []
        for index in range(args.runs + 1):
            started = time.perf_counter()
            response = client.post('/frame', content=jpeg.tobytes(), headers={'Content-Type': 'image/jpeg'})
            response.raise_for_status()
            result = response.json()
            elapsed = (time.perf_counter() - started) * 1000
            assert result['retains_frames'] is False
            measurements.append({'warmup': index == 0, 'round_trip_ms': round(elapsed, 1), 'inference_ms': result['inference_ms'], 'status': result['status']})
            print(measurements[-1], flush=True)
        if result['status'] == 'estimated':
            for key in ['overlay', 'iuv']:
                (args.out / f'{key}.png').write_bytes(base64.b64decode(result[key].split(',', 1)[1]))
            overlay = cv2.imread(str(args.out / 'overlay.png'), cv2.IMREAD_UNCHANGED)
            alpha = overlay[..., 3:4] / 255.
            cv2.imwrite(str(args.out / 'preview.jpg'), (image * (1-alpha) + overlay[..., :3] * alpha).astype(np.uint8))
        _, blank = cv2.imencode('.jpg', np.zeros_like(image))
        response = client.post('/frame', content=blank.tobytes(), headers={'Content-Type': 'image/jpeg'})
        response.raise_for_status()
        assert response.json()['status'] == 'no_person'
    summary = {
        'runtime': runtime, 'image_sha256': hashlib.sha256(args.image.read_bytes()).hexdigest(),
        'input_dimensions': [image.shape[1], image.shape[0]], 'runs': measurements,
        'median_round_trip_ms': float(np.median([row['round_trip_ms'] for row in measurements[1:]])),
        'median_inference_ms': float(np.median([row['inference_ms'] for row in measurements[1:]])),
        'last_result': {key: value for key, value in result.items() if key not in ['overlay', 'iuv']},
        'blank_frame_rejected': True,
        'limitation': 'Repeated single-image smoke test. No ground truth, no accuracy estimate, no clinical validation. Browser capture/decoding/rendering overhead excluded.',
    }
    (args.out / 'results.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
