import os
import threading
os.environ['OPENCV_IO_MAX_IMAGE_PIXELS'] = str(1280 * 1280)
import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .densepose_engine import DensePoseEngine

app = FastAPI(title='AstroBone private DensePose service')
origins = [f'http://{host}:{port}' for host in ['localhost', '127.0.0.1'] for port in [5180, 5181, 5173, 5174]]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])
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
    return engine.status() if engine else {'ready': False, 'retains_frames': False, 'reason': 'DensePose not initialized'}

@app.post('/initialize')
def initialize():
    global engine
    if not lock.acquire(False):
        raise HTTPException(409, 'DensePose is busy')
    try:
        if engine is None:
            engine = DensePoseEngine()
        return engine.status()
    except Exception as error:
        raise HTTPException(503, str(error)) from error
    finally:
        lock.release()

@app.post('/frame')
async def frame(request: Request):
    if engine is None:
        raise HTTPException(503, 'Initialize DensePose first')
    if request.headers.get('content-type') != 'image/jpeg':
        raise HTTPException(415, 'JPEG frame required')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 1_000_000:
            raise HTTPException(413, 'Frame exceeds 1 MB')
    if not data.startswith(b'\xff\xd8'):
        raise HTTPException(422, 'JPEG frame required')
    try:
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as error:
        raise HTTPException(422, 'Invalid or oversized image') from error
    if image is None or max(image.shape[:2]) > 1280:
        raise HTTPException(422, 'JPEG maximum edge is 1280 pixels')
    if not lock.acquire(False):
        raise HTTPException(409, 'Frame dropped: DensePose is busy')
    try:
        return await run_in_threadpool(engine.predict, image)
    except Exception as error:
        raise HTTPException(503, f'DensePose inference failed: {error}') from error
    finally:
        lock.release()
