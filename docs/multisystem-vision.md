# Multisystem Observations and Local Reconstruction

## What this version does

- Browser MediaPipe retains pose, hand and face tracking, the clothed human rig,
  eye-closure observations, and existing movement assessment contracts.
- Optional local RTMW-m 256x192 produces 133 2D landmarks. InstantHMR predicts
  70 body-local 3D joints and MHR parameters; Meta MHR decodes a LOD3 mesh.
- Three.js displays the actual decoded surface with a One Euro vertex filter.
  The user opts in before frames go to localhost. Frames are not persisted.
- Health records preserve mission day, observation time, metric units, source,
  device ID, acquisition protocol, and explicit storage consent. SQLite and
  browser-only modes expose the same observation endpoint.
- Personal review compares within source/device/protocol series, aligns separate
  cardiovascular, exposure and movement plots, and exports the observations.
- Experimental webcam pulse uses the POS color projection and spectral estimation.
  A 20-second window, >=15 Hz sampling, cadence, lighting, motion and spectral
  concentration gates are required. Those gates are engineering heuristics.

## Run

From the project directory in PowerShell:

```powershell
# First installation: separate Python 3.12 environment and models on E:
.\scripts\setup-local-vision.ps1 -Gpu

# Local inference service. Keep this terminal open.
.\scripts\start-local-vision.ps1

# CPU-only fallback:
.\scripts\start-local-vision.ps1 -Device cpu
```

Open the local web app. In Movement capture, start the camera, then consent to
local frame transfer and connect the mesh engine. Stopping the engine, revoking
consent, a failed request, lost person detection or stale geometry retains/restores
the browser human rig. One request is in flight at a time; no queued camera backlog.
There is a 200 ms pause between completed requests. The first reconstruction has
a 60-second warmup allowance; subsequent requests time out after 15 seconds.
The optional service is desktop-local, not an embedded Android inference engine.

```powershell
& E:\AstroBoneRuntime\vision\venv\Scripts\python.exe scripts\benchmark-vision.py `
  --image .artifacts\mediapipe-woman-hands.jpg --device cuda
```

Benchmark A = detector + InstantHMR + MHR. B adds RTMW. Warm-up is excluded;
reported median/p95 include JSON serialization, but not camera capture, transport
or browser rendering. A single-photo timing test does not measure pose accuracy,
motion robustness or end-to-end webcam frame rate. Keep the B branch when fine
landmark coverage matters; latency alone is not sufficient to choose a production
pipeline. The ONNX input type/provider is reported rather than assuming FP16/CUDA.

## Local measurements (2026-09-29)

RTX 3050 6 GB, ONNX Runtime 1.23.2, FP32 InstantHMR. Detector, RTMW and HMR
confirmed CUDA after inference; the MHR decoder runs on CPU/PyTorch.

| Pipeline | Median | p95 | Samples |
| --- | ---: | ---: | ---: |
| A: detector + InstantHMR + MHR | 321 ms | 1453 ms | 12 |
| B: detector + RTMW + InstantHMR + MHR | 247 ms | 662 ms | 12 |

These are one-image, sequential A-then-B runs after two warmups per branch.
The surprising faster B result can reflect warmup, scheduling and measurement
variation; it does not demonstrate that adding RTMW accelerates inference.
CPU-only exploratory medians were 1083 ms (A) and 1246 ms (B), eight samples each.
No result includes browser/network costs or proves sustained webcam throughput.
Compare interleaved runs and representative motion sequences before selecting a
deployment pipeline. Raw results are in `.artifacts/vision-benchmark*.json`.
An actual HTTP service smoke test also decoded the reference photograph into
4,899 vertices and 133 whole-body landmarks. Its first cold request took about
19 seconds, illustrating why warm single-image medians are not startup latency.

## Boundaries

- Camera geometry is uncalibrated and model-estimated. It is not internal bone
  imaging, a force measurement, bone-density measurement or a validated digital
  twin. Health layers are schematic, including the heart marker and exposure shell.
- Schematic health overlays belong to the browser rig. They are hidden during MHR
  reconstruction because anatomical registration to that surface is not implemented.
- MHR face expressions are not predicted by InstantHMR. MediaPipe face observations
  remain a separate channel; they are not falsely applied as MHR facial parameters.
- Existing movement assessments remain MediaPipe-derived. They are not silently
  relabelled as RTMW/MHR measurements or compared across incompatible model baselines.
- The first qualified cardiovascular reading is a descriptive reference, not a
  clinically established baseline. Instrument entries are operator-entered and not
  authenticated device telemetry. HRV requires a defined RMSSD protocol from a
  suitable sensor. SpO2 must come from a suitable instrument, never the webcam.
- rPPG needs validation against a contact reference across motion, skin tones,
  lighting, camera auto-exposure and compression. A spectral peak can be an artifact.
  No clinical alert or treatment decision is issued from webcam pulse.
- Personal dose equivalent (mSv), its rate (uSv/h) and the existing absorbed dose
  (mGy) are distinct quantities. No mGy-to-mSv conversion, organ-dose map, radiation
  threshold, event classification or disease probability is invented.
- Dose-equivalent records must not decrease within one instrument/protocol series.
  Use a separately identified protocol when a cumulative instrument is reset.
- Temporal association does not establish radiation causation. There is no combined
  health score, outcome-trained fusion model, or autonomous exercise prescription.
- SAM 3D Body DINOv3 remains optional/uninstalled. Its gated checkpoint requires
  authorized access. A larger reference model is not automatically ground truth.

## Data/API

`POST /api/companion/profiles/{id}/health` accepts:

```json
{
  "mission_day": 41,
  "observed_at": "2026-09-01T12:00:00Z",
  "source": "instrument",
  "device_id": "PPG-001",
  "protocol": "resting-seated-5min-v1",
  "metrics": {"heart_rate_bpm": 76},
  "quality": 1,
  "consent_to_store": true
}
```

`quality: 1` on a manual instrument entry means input accepted, not verified
measurement accuracy. Synthetic demo profiles cannot receive real readings.
The Day 1-180 example is entirely scripted and marked SYNTHETIC throughout.
Deleting a profile deletes related health records. Local storage is not encrypted.

Local vision endpoints: `GET /health`, `POST /initialize`,
`POST /frame?pipeline=A|B` (`image/jpeg`, <=1 MB, max edge 1280).
Only allowlisted localhost origins are accepted. Do not expose port 8011 publicly.

## Provenance

- InstantHMR code: https://github.com/mohamdev/InstantHMR
  commit `36ae38720c0008f822dc1cb278b4a41b23d76e01` (Apache-2.0 code).
- Weights: https://huggingface.co/momolesang/InstantHMR
  revision `3504446fc31e7f76fdb1cd7e463189e7cf0fdd0f` (SAM license).
- MHR assets v1.0.1: https://github.com/facebookresearch/MHR
- RTMW: https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose
- RTMLib preprocessing: https://github.com/Tau-J/rtmlib
- Reference model: https://github.com/facebookresearch/sam-3d-body
- POS reference implementation: https://github.com/ubicomplab/rPPG-Toolbox
- One Euro Filter: https://gery.casiez.net/1euro/
- NASA cardiovascular context: https://www.nasa.gov/directorates/esdmd/hhp/cv-risk/

The setup saves source URLs, revisions and SHA-256 hashes under
`E:\AstroBoneRuntime\vision\manifest.json`. Model weights are not bundled with
the public site or APK. Review each model's license before redistribution.
