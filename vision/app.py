import os
import threading
# Bound decompression before OpenCV allocates decoded image storage.
os.environ['OPENCV_IO_MAX_IMAGE_PIXELS'] = str(1280 * 1280)
import cv2
import numpy as np
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from .engine import VisionEngine

app = FastAPI(title='AstroBone local vision', description='Opt-in image inference on this computer. No frames persisted.')
origins = [f'http://{h}:{p}' for h in ['localhost', '127.0.0.1'] for p in [5180,5181,5173,5174]]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET','POST'], allow_headers=['Content-Type'])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1', 'testserver'])
engine = None
lock = threading.Lock()


@app.middleware('http')
async def boundary(request, call_next):
    if request.headers.get('origin') not in [None, *origins]:
        return JSONResponse({'detail': 'Only local AstroBone origins are accepted'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/health')
def health():
    return engine.status() if engine else {'ready': False, 'reason': 'Models not initialized. Enable the local vision engine.'}


@app.post('/initialize')
def initialize():
    global engine
    if not lock.acquire(False):
        raise HTTPException(409, 'Vision engine is busy')
    try:
        if engine is None:
            engine = VisionEngine(device=os.getenv('ASTROBONE_VISION_DEVICE', 'cpu'))
        return engine.status()
    except Exception as error:
        raise HTTPException(503, str(error)) from error
    finally:
        lock.release()


@app.post('/frame')
async def frame(request: Request, pipeline: str = 'B'):
    if pipeline not in {'A', 'B'}:
        raise HTTPException(422, 'Pipeline must be A or B')
    if not engine:
        raise HTTPException(503, 'Initialize models first')
    if request.headers.get('content-type') != 'image/jpeg':
        raise HTTPException(415, 'JPEG frame required')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 1_000_000:
            raise HTTPException(413, 'Frame exceeds 1 MB')
    if not data:
        raise HTTPException(422, 'Empty JPEG frame')
    try:
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as error:
        raise HTTPException(422, 'JPEG frame is invalid or exceeds the pixel limit') from error
    if image is None or max(image.shape[:2]) > 1280:
        raise HTTPException(422, 'Frame must be a valid JPEG with maximum edge 1280')
    if not lock.acquire(False):
        raise HTTPException(409, 'Frame dropped: engine busy')
    try:
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(engine.predict, image, pipeline)
    finally:
        lock.release()
