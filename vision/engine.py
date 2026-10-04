from __future__ import annotations
import importlib.util
import os
import sys
import time
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(os.getenv('ASTROBONE_VISION_RUNTIME', 'E:/AstroBoneRuntime/vision'))


def vendor(name):
    spec = importlib.util.spec_from_file_location(f'astrobone_vendor_{name}', ROOT / 'vendor' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def model_path(folder):
    candidates = list((ROOT / 'models' / folder).rglob('*.onnx'))
    if len(candidates) != 1:
        raise RuntimeError(f'Expected one prepared {folder} ONNX model; run setup-local-vision.ps1')
    return str(candidates[0])


class VisionEngine:
    def __init__(self, device='cpu'):
        import onnxruntime as ort
        from rtmlib import YOLOX, RTMPose
        ort.set_default_logger_severity(3)
        self._dll_handles = []
        if device == 'cuda' and hasattr(ort, 'preload_dlls'):
            if os.name == 'nt':
                # cuDNN loads subsidiary engines lazily via LoadLibrary, beyond ORT's preload list.
                bins = list((Path(sys.prefix) / 'Lib/site-packages/nvidia').glob('*/bin'))
                self._dll_handles = [os.add_dll_directory(str(path)) for path in bins]
                os.environ['PATH'] = os.pathsep.join([*(str(path) for path in bins), os.environ.get('PATH', '')])
            ort.preload_dlls(directory='')
        self.device = device
        self.detector = YOLOX(model_path('detector'), model_input_size=(416, 416), backend='onnxruntime', device=device)
        self.wholebody = RTMPose(model_path('rtmw'), model_input_size=(192, 256), backend='onnxruntime', device=device, to_openpose=False)
        self.hmr = vendor('inference').InstantHMR(ROOT / 'models/instanthmr.onnx', device=device)
        self.mesh = None
        self.mesh_error = None
        try:
            self.mesh = vendor('mhr_renderer').MHRRenderer(ROOT / 'models/mhr-assets/assets', device='cpu', lod=3)
        except (ImportError, RuntimeError, FileNotFoundError, OSError) as error:
            self.mesh_error = str(error)
        self.skeleton = vendor('skeleton')

    def status(self):
        return {'ready': True, 'provider': self.hmr.session.get_providers()[0], 'precision': self.hmr.session.get_inputs()[0].type,
                'providers': {'detector': self.detector.session.get_providers()[0], 'wholebody': self.wholebody.session.get_providers()[0], 'hmr': self.hmr.session.get_providers()[0], 'mesh': 'CPU/PyTorch'},
                'mesh': 'MHR LOD3' if self.mesh else 'unavailable', 'mesh_error': self.mesh_error,
                'wholebody': 'RTMW-m 256x192 / 133 landmarks', 'sam3d': 'not installed; access-controlled reference checkpoint required',
                'measurement': 'Estimated external surface and joints; not imaged bones or calibrated body dimensions'}

    def predict(self, image, pipeline='B'):
        start = time.perf_counter()
        bboxes = self.detector(image)
        detected = time.perf_counter()
        if len(bboxes) != 1:
            return {'status': 'no_single_person', 'people': len(bboxes), 'reason': 'Exactly one visible person is required', 'total_ms': (detected-start)*1000}
        bbox = np.asarray(bboxes[0])[:4]
        keypoints, scores = (self.wholebody(image, bboxes=[bbox]) if pipeline == 'B' else (None, None))
        posed = time.perf_counter()
        prediction = self.hmr.predict(cv2.cvtColor(image, cv2.COLOR_BGR2RGB), bbox=bbox)
        inferred = time.perf_counter()
        vertices = self.mesh.forward(prediction.mhr_params, prediction.shape_params) if self.mesh else None
        decoded = time.perf_counter()
        values = [prediction.joints_3d_local, prediction.joints_2d, prediction.mhr_params, prediction.shape_params]
        if vertices is not None:
            values.append(vertices)
        if not all(np.isfinite(v).all() for v in values):
            raise ValueError('Model output was nonfinite')
        # No scalar accuracy score is invented for InstantHMR: its coordinate head has no confidence output.
        return {'status': 'estimated', 'pipeline': pipeline, 'coordinate_system': 'metres_y_down_z_forward_body_local',
                'joints_3d': prediction.joints_3d_local.tolist(), 'joints_2d': prediction.joints_2d.tolist(),
                'joint_names': list(self.skeleton.JOINT_NAMES), 'edges': list(self.skeleton.SKELETON_EDGES),
                'mhr_params': prediction.mhr_params.tolist(), 'shape_params': prediction.shape_params.tolist(),
                'camera_translation': prediction.cam_trans.tolist(), 'bbox': bbox.tolist(),
                'wholebody_2d': keypoints[0].tolist() if keypoints is not None else None,
                'wholebody_confidence': scores[0].tolist() if scores is not None else None,
                'vertices': vertices.tolist() if vertices is not None else None,
                'faces': self.mesh.faces.tolist() if vertices is not None else None,
                'timing_ms': {'detector': (detected-start)*1000, 'wholebody': (posed-detected)*1000,
                              'hmr': (inferred-posed)*1000, 'mesh': (decoded-inferred)*1000, 'compute_total': (decoded-start)*1000},
                'provider': self.hmr.session.get_providers()[0], 'calibrated': False, 'confidence': None}
