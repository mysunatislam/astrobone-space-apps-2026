import base64
import importlib

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from .densepose_engine import chart_images


def decode(data):
    return cv2.imdecode(np.frombuffer(base64.b64decode(data.split(',', 1)[1]), np.uint8), cv2.IMREAD_UNCHANGED)


def test_iuv_channel_order_and_background():
    labels = np.array([[0, 1], [12, 24]], np.uint8)
    uv = np.full((2, 2, 2), .5, np.float32)
    result = chart_images(labels, uv, [1, 1, 2, 2], (4, 4, 3))
    image = decode(result['iuv'])
    assert image[1, 2].tolist() == [127, 127, 1]  # OpenCV BGR; PNG RGB is I,U,V.
    assert image[1, 1].tolist() == [0, 0, 0]
    assert image[2, 2, 2] == 24
    assert result['visible_parts'] == [1, 12, 24]
    assert result['surface_pixels'] == 3
    assert decode(result['overlay'])[1, 1, 3] == 0


def test_boxes_are_clipped_without_shifting_correspondence():
    labels = np.array([[1, 2], [3, 4]], np.uint8)
    result = chart_images(labels, np.zeros((2, 2, 2), np.float32), [-1, -1, 2, 2], (3, 3, 3))
    assert decode(result['iuv'])[0, 0, 2] == 4
    assert result['surface_pixels'] == 1


@pytest.mark.parametrize('box', [[0, 0, 0, 2], [0, 0, 2000, 2], [10, 10, 2, 2]])
def test_invalid_boxes_are_rejected(box):
    with pytest.raises(ValueError):
        chart_images(np.ones((2, 2), np.uint8), np.zeros((2, 2, 2)), box, (4, 4, 3))


def test_invalid_uv_and_chart_ids_are_rejected():
    for labels, uv in [(np.full((2, 2), value), np.zeros((2, 2, 2))) for value in [-1, 25, 256, .5, np.nan]] + [(np.ones((2, 2)), np.full((2, 2, 2), np.nan))]:
        with pytest.raises(ValueError):
            chart_images(labels, uv, [0, 0, 2, 2], (4, 4, 3))


@pytest.fixture
def service(monkeypatch):
    module = importlib.import_module('vision.densepose_app')
    class StubEngine:
        def status(self):
            return {'ready': True, 'retains_frames': False}
        def predict(self, image):
            return {'status': 'no_person', 'retains_frames': False, 'width': image.shape[1]}
    monkeypatch.setattr(module, 'engine', StubEngine())
    with TestClient(module.app) as client:
        yield module, client


def test_api_origin_host_and_cache_boundary(service):
    _, client = service
    response = client.get('/health', headers={'Origin': 'http://127.0.0.1:5180'})
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.json()['retains_frames'] is False
    assert client.get('/health', headers={'Origin': 'https://untrusted.example'}).status_code == 403
    assert client.get('/health', headers={'Host': 'untrusted.example'}).status_code == 400


def test_api_requires_jpeg_and_limits_size(service):
    _, client = service
    assert client.post('/frame', content=b'anything').status_code == 415
    headers = {'Content-Type': 'image/jpeg'}
    assert client.post('/frame', content=b'not jpeg', headers=headers).status_code == 422
    assert client.post('/frame', content=b'\xff\xd8' + b'0' * 1_000_000, headers=headers).status_code == 413
    _, jpeg = cv2.imencode('.jpg', np.zeros((16, 16, 3), np.uint8))
    assert client.post('/frame', content=jpeg.tobytes(), headers=headers).json()['width'] == 16


def test_busy_frames_are_dropped_not_queued(service):
    module, client = service
    _, jpeg = cv2.imencode('.jpg', np.zeros((16, 16, 3), np.uint8))
    with module.lock:
        assert client.post('/frame', content=jpeg.tobytes(), headers={'Content-Type': 'image/jpeg'}).status_code == 409


def test_uninitialized_api_does_not_claim_readiness(service, monkeypatch):
    module, client = service
    monkeypatch.setattr(module, 'engine', None)
    assert client.get('/health').json()['ready'] is False
    assert client.post('/frame').status_code == 503
