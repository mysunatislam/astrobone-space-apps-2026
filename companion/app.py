from __future__ import annotations

import os
import sqlite3
import threading
import uuid
from pathlib import Path
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from .agents import CompanionController
from .local_model import LocalModel
from .retrieval import KnowledgeLibrary
from .schema import Assessment, ProfileCreate, RadiationObservation, ReviewRequest, Followup
from .store import Store
from .health import HealthObservation

ROOT = Path(__file__).resolve().parents[1]
LOCAL_DATA = Path(os.getenv('LOCALAPPDATA', Path.home() / '.local/share')) / 'AstroBone/companion'
ORIGINS = [f'http://{host}:{port}' for host in ['localhost', '127.0.0.1'] for port in [5180,5181,5173,5174]]


def create_app(database=None, model=None):
    app = FastAPI(title='AstroBone Local Companion', version='0.1.0', description='Local aggregate observations and bounded research assistance. Not a medical device.')
    store = Store(Path(database) if database else Path(os.getenv('ASTROBONE_COMPANION_DB', LOCAL_DATA / 'crew.sqlite3')))
    local = model or LocalModel()
    library = KnowledgeLibrary(local, store.path.parent / 'knowledge-index')
    controller = CompanionController(store, local, library)
    app.state.store, app.state.library = store, library
    runs = {}
    run_lock = threading.Lock()
    app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET','POST','DELETE'], allow_headers=['Content-Type'])
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1','localhost','testserver'])

    @app.middleware('http')
    async def local_boundary(request: Request, call_next):
        if request.headers.get('origin') and request.headers['origin'] not in ORIGINS:
            return JSONResponse({'detail':'This local service does not accept requests from remote websites.'}, status_code=403)
        if request.method == 'POST':
            if not request.headers.get('content-type', '').startswith('application/json'):
                return JSONResponse({'detail':'JSON aggregate data only.'}, status_code=415)
            length = request.headers.get('content-length', '0')
            if not length.isdigit() or int(length) > 128000:
                return JSONResponse({'detail':'Aggregate request too large.'}, status_code=413)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse({'detail':str(error.args[0])}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({'detail':str(error)}, status_code=422)

    @app.exception_handler(sqlite3.IntegrityError)
    async def conflict(request, error):
        return JSONResponse({'detail':'Profile ID or baseline already exists.'}, status_code=409)

    @app.get('/api/companion/health')
    def health():
        return {'status':'ready', 'local_only':True, 'llm':local.status(), 'knowledge_chunks':len(library.chunks),
                'corpus_sha256':library.digest, 'vision_backend':'MediaPipe browser-local', 'clinical_prediction_model':'not validated / unavailable'}

    @app.get('/api/companion/profiles')
    def profiles():
        return store.profiles()

    @app.post('/api/companion/profiles', status_code=201)
    def create(profile: ProfileCreate):
        return store.create_profile(profile)

    @app.get('/api/companion/profiles/{astronaut_id}')
    def profile(astronaut_id: str):
        return {'profile':store.profile(astronaut_id), 'history':store.history(astronaut_id),
                'radiation':store.radiation_history(astronaut_id), 'health':store.health_history(astronaut_id), 'followups':store.followups(astronaut_id)}

    @app.post('/api/companion/profiles/{astronaut_id}/followups', status_code=201)
    def followup(astronaut_id: str, value: Followup):
        return store.add_followup(astronaut_id, value)

    @app.delete('/api/companion/profiles/{astronaut_id}')
    def delete(astronaut_id: str):
        if run_lock.locked():
            raise HTTPException(409, 'Wait for the active review before deleting a profile')
        store.delete_profile(astronaut_id)
        return {'deleted':True}

    @app.post('/api/companion/profiles/{astronaut_id}/assessments', status_code=201)
    def assessment(astronaut_id: str, observation: Assessment):
        return store.add_assessment(astronaut_id, observation)

    @app.post('/api/companion/profiles/{astronaut_id}/radiation', status_code=201)
    def radiation(astronaut_id: str, observation: RadiationObservation):
        return store.add_radiation(astronaut_id, observation)

    @app.post('/api/companion/demo', status_code=201)
    def demo():
        return store.demo()

    @app.post('/api/companion/profiles/{astronaut_id}/health', status_code=201)
    def health_observation(astronaut_id: str, observation: HealthObservation):
        return store.add_health(astronaut_id, observation)

    @app.get('/api/companion/knowledge')
    def knowledge():
        return library.manifest

    @app.post('/api/companion/runs', status_code=202)
    def run(request: ReviewRequest, tasks: BackgroundTasks):
        store.profile(request.astronaut_id)
        if not run_lock.acquire(blocking=False):
            raise HTTPException(409, 'A local review is already running. Wait for completion.')
        if len(runs) >= 100:
            for key in list(runs):
                if runs[key]['status'] != 'running':
                    del runs[key]
                    break
        run_id = uuid.uuid4().hex
        runs[run_id] = {'id':run_id,'status':'running','trace':[],'report':None}
        def work():
            try:
                report = controller.run(request, lambda item: runs[run_id]['trace'].append(item))
                runs[run_id].update(status='complete', report=report)
            except Exception:
                runs[run_id].update(status='error', error='Local review failed. No recommendation was approved; retry or review the saved observations.')
            finally:
                run_lock.release()
        tasks.add_task(work)
        return {'id':run_id,'status':'running'}

    @app.get('/api/companion/runs/{run_id}')
    def run_status(run_id: str):
        if run_id not in runs:
            raise HTTPException(404, 'Run not found; the local service may have restarted')
        return runs[run_id]

    @app.get('/api/companion/reports/{report_id}')
    def report(report_id: str):
        return store.report(report_id)

    return app


app = create_app()
