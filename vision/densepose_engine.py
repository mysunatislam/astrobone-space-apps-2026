import base64
import os
import time
from pathlib import Path

import cv2
import numpy as np


def png_data(image):
    ok, encoded = cv2.imencode('.png', image)
    if not ok:
        raise ValueError('Could not encode DensePose output')
    return 'data:image/png;base64,' + base64.b64encode(encoded).decode('ascii')


def chart_images(labels, uv, box, image_shape):
    height, width = image_shape[:2]
    x, y, box_width, box_height = [int(v) for v in box]
    if box_width < 1 or box_height < 1 or box_width > 1280 or box_height > 1280:
        raise ValueError('DensePose returned an invalid box')
    labels, uv = np.asarray(labels), np.asarray(uv)
    if labels.ndim != 2 or uv.shape != (2, *labels.shape):
        raise ValueError('DensePose chart dimensions are inconsistent')
    if not np.isfinite(labels).all() or np.any(labels < 0) or np.any(labels > 24) or np.any(labels != np.floor(labels)) or not np.isfinite(uv).all():
        raise ValueError('Invalid DensePose chart values')
    labels = cv2.resize(labels.astype(np.uint8), (box_width, box_height), interpolation=cv2.INTER_NEAREST)
    coordinates = cv2.resize(np.moveaxis(uv, 0, -1), (box_width, box_height), interpolation=cv2.INTER_LINEAR)
    iuv = np.zeros((height, width, 3), dtype=np.uint8)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(width, x + box_width), min(height, y + box_height)
    if x1 <= x0 or y1 <= y0:
        raise ValueError('DensePose box is outside the frame')
    part = labels[y0-y:y1-y, x0-x:x1-x]
    values = coordinates[y0-y:y1-y, x0-x:x1-x]
    if np.any(part > 24) or not np.isfinite(values).all():
        raise ValueError('Invalid DensePose chart values')
    # OpenCV BGR -> downloaded PNG RGB: R=part ID, G=U, B=V.
    iuv[y0:y1, x0:x1, 2] = part
    iuv[y0:y1, x0:x1, 1] = (np.clip(values[..., 0], 0, 1) * 255).astype(np.uint8) * (part > 0)
    iuv[y0:y1, x0:x1, 0] = (np.clip(values[..., 1], 0, 1) * 255).astype(np.uint8) * (part > 0)
    hsv = np.zeros((height, width, 3), dtype=np.uint8)
    hsv[..., 0] = (iuv[..., 2].astype(np.uint16) * 7 % 180).astype(np.uint8)
    hsv[..., 1] = 180
    hsv[..., 2] = 230
    overlay = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    overlay = np.dstack([overlay, np.where(iuv[..., 2] > 0, 175, 0).astype(np.uint8)])
    parts = sorted(int(v) for v in np.unique(part) if v > 0)
    return {'overlay': png_data(overlay), 'iuv': png_data(iuv), 'visible_parts': parts,
            'surface_pixels': int(np.count_nonzero(iuv[..., 2]))}


class DensePoseEngine:
    def __init__(self):
        import torch
        from detectron2.config import get_cfg
        from detectron2.engine import DefaultPredictor
        from densepose import add_densepose_config
        from densepose.vis.extractor import DensePoseResultExtractor
        # Small frame preprocessing and chart interpolation otherwise oversubscribe
        # laptop CPUs while the browser is also running MediaPipe and WebGL.
        torch.set_num_threads(2)
        cv2.setNumThreads(1)
        runtime = Path(os.getenv('ASTROBONE_DENSEPOSE_RUNTIME', str(Path.home() / '.local/share/astrobone-densepose')))
        device = os.getenv('ASTROBONE_DENSEPOSE_DEVICE', 'cuda')
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA is unavailable. DensePose has not started.')
        checkpoint = runtime / 'models/densepose_r50_fpn.pkl'
        if not checkpoint.is_file():
            raise RuntimeError('Run scripts/setup-densepose-wsl.sh first')
        cfg = get_cfg()
        add_densepose_config(cfg)
        cfg.merge_from_file(str(runtime / 'detectron2/projects/DensePose/configs/densepose_rcnn_R_50_FPN_s1x.yaml'))
        cfg.MODEL.WEIGHTS = str(checkpoint)
        cfg.MODEL.DEVICE = device
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = .7
        cfg.INPUT.MIN_SIZE_TEST = 384
        cfg.INPUT.MAX_SIZE_TEST = 640
        cfg.TEST.DETECTIONS_PER_IMAGE = 3
        self.predictor = DefaultPredictor(cfg)
        self.extractor = DensePoseResultExtractor()
        self.device = device
        self.torch = torch
        with torch.inference_mode():
            self.predictor(np.zeros((427, 640, 3), dtype=np.uint8))
        if device == 'cuda':
            torch.cuda.synchronize()

    def status(self):
        return {'ready': True, 'model': 'DensePose R50-FPN s1x', 'device': self.device,
                'retains_frames': False, 'clinical_validation': False}

    def predict(self, image):
        started = time.perf_counter()
        with self.torch.inference_mode():
            instances = self.predictor(image)['instances'].to('cpu')
        people = len(instances)
        base = {**self.status(), 'width': image.shape[1], 'height': image.shape[0], 'people': people,
                'inference_ms': round((time.perf_counter() - started) * 1000, 1),
                'limitation': 'Visible surface correspondence only. Not internal anatomy, force, or diagnosis.'}
        if people != 1:
            return {**base, 'status': 'no_person' if people == 0 else 'multiple_people',
                    'reason': 'One visible person is required for an unambiguous surface map.'}
        results, boxes = self.extractor(instances)
        result = results[0]
        output = chart_images(result.labels.numpy(), result.uv.numpy(), boxes[0].numpy(), image.shape)
        return {**base, **output, 'status': 'estimated', 'detection_score': float(instances.scores[0]),
                'bbox_xywh': boxes[0].tolist(), 'processing_ms': round((time.perf_counter() - started) * 1000, 1)}
