"""Download pinned official assets to an external runtime, preserving licenses."""
import argparse
import hashlib
import json
import urllib.request
import time
import zipfile
from pathlib import Path

COMMIT = '36ae38720c0008f822dc1cb278b4a41b23d76e01'
WEIGHTS = '3504446fc31e7f76fdb1cd7e463189e7cf0fdd0f'
URLS = {
    'vendor/inference.py': f'https://raw.githubusercontent.com/mohamdev/InstantHMR/{COMMIT}/instanthmr/inference.py',
    'vendor/mhr_renderer.py': f'https://raw.githubusercontent.com/mohamdev/InstantHMR/{COMMIT}/instanthmr/mhr_renderer.py',
    'vendor/skeleton.py': f'https://raw.githubusercontent.com/mohamdev/InstantHMR/{COMMIT}/instanthmr/skeleton.py',
    'vendor/LICENSE-InstantHMR': f'https://raw.githubusercontent.com/mohamdev/InstantHMR/{COMMIT}/LICENSE',
    'models/instanthmr.onnx': f'https://huggingface.co/momolesang/InstantHMR/resolve/{WEIGHTS}/instanthmr.onnx',
    'models/mhr-assets.zip': 'https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip',
    'models/detector.zip': 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_tiny_8xb8-300e_humanart-6f3252f9.zip',
    'models/rtmw.zip': 'https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/rtmw-dw-l-m_simcc-cocktail14_270e-256x192_20231122.zip',
}


def prepare(root):
    root = root.resolve()
    manifest = []
    for relative, url in URLS.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            print(f'Downloading {relative}', flush=True)
            partial = path.with_suffix(path.suffix + '.part')
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(url, timeout=180) as response, partial.open('wb') as output:
                        size = 0
                        while chunk := response.read(1024 * 1024):
                            output.write(chunk); size += len(chunk)
                            if size % (20 * 1024 * 1024) == 0:
                                print(f'  {relative}: {size // (1024 * 1024)} MB', flush=True)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    print(f'Retrying {relative}', flush=True)
                    time.sleep(2)
            partial.replace(path)
        digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
        manifest.append({'file': relative, 'url': url, 'sha256': digest, 'bytes': path.stat().st_size})
        if path.suffix == '.zip':
            destination = path.with_suffix('')
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    target = (destination / member.filename).resolve()
                    if not target.is_relative_to(destination.resolve()):
                        raise ValueError('Unsafe archive member')
                archive.extractall(destination)
    (root / 'manifest.json').write_text(json.dumps({'instanthmr_commit': COMMIT, 'weight_revision': WEIGHTS, 'files': manifest}, indent=2))
    print(f'Models and provenance manifest ready: {root}', flush=True)


def locked_prepare(root):
    root.mkdir(parents=True, exist_ok=True)
    lock = root / '.prepare-lock'
    for attempt in range(300):
        try:
            lock.mkdir()
            break
        except FileExistsError:
            if attempt == 299:
                raise RuntimeError('Another preparation is still running; retry after it completes')
            time.sleep(2)
    try:
        prepare(root)
    finally:
        lock.rmdir()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', type=Path, default=Path('E:/AstroBoneRuntime/vision'))
    locked_prepare(parser.parse_args().runtime)
