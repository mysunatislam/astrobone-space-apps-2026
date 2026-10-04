# Local DensePose Surface Mapping

DensePose is optional and separate from the browser's MediaPipe pose pipeline.
It estimates visible body-surface chart coordinates, not bones, muscles, internal
anatomy, forces, or health status. Detection scores are not accuracy estimates.

## Runtime

- Windows host: Ubuntu-24.04 under WSL2, NVIDIA CUDA passthrough.
- Default runtime: `~/.local/share/astrobone-densepose` inside Ubuntu.
- PyTorch 2.5.1 / torchvision 0.20.1 / CUDA 12.1 wheels.
- Official Detectron2 revision: `fc3b7a1e658db27cdb52ee94ef5dcec7cc7eb1e7`.
- Model: DensePose R50-FPN s1x, official checkpoint `model_final_162be9.pkl`.
- FastAPI binds only `127.0.0.1:8012`. The public hosted web app cannot use this service.

From the workspace in PowerShell:

```powershell
./scripts/start-densepose.ps1
```

Keep that terminal running. Open the local web app, enable frame-processing
consent, start a camera or upload an MP4/WebM, then start DensePose. Stop or
withdraw consent to terminate browser frame transfers. Frames are not saved by
the service. Only the explicit IUV export downloads a result.

## Timing And Source Integrity

Frames are resized to a maximum 640-pixel edge. Only one request is in flight;
there is no backlog. The colored result is composited over the exact captured
frame, never over newer video. Source replacement and seeking invalidate old
responses. Paused video is processed once per selected timestamp. Multiple
detected people cause abstention rather than ambiguous identity tracking.

A paused, unchanged video keeps its exact analyzed-frame overlay visible rather
than hiding it after the live-frame timeout. Seeking, replacing the source,
stopping DensePose, or withdrawing consent still clears it immediately. Service
startup failures are labeled `Service unavailable`; MediaPipe/GLB playback remains
independent of the WSL service.

The UI reports inference and browser round-trip latency. It does not promise
30 FPS, exact motion, or clinical reliability. The pose-driven human remains
available whether or not DensePose is running.

The first CUDA kernels are warmed up during initialization, before readiness is
reported. Allow up to three minutes for a cold service start. The first actual
frame has a longer timeout than subsequent frames.

### Local Smoke Result (September 30, 2026)

RTX 3050 / WSL / 640 x 427 repeated NASA photograph, ten measured requests after
one excluded warm-up: median inference 226.3 ms, median service round trip
331.15 ms. The full browser test with MediaPipe and WebGL concurrently running
observed 313.3 ms inference and 504 ms browser round trip on its sampled result.
This is a hardware/runtime check on one still photograph, not a general speed
guarantee or astronaut-video accuracy validation. The blank frame correctly
produced `no_person`. Raw results are under `.artifacts/densepose-benchmark` and
`.artifacts/ui-qa/densepose-gpu-results.json`.

Checkpoint SHA-256:
`b8a7382001b16e453bad95ca9dbc68ae8f2b839b304cf90eaf5c27fbdb4dae91`.

### Uploaded-Video Check (October 1, 2026)

The real seven-second squat clip used by the knee verification passed through the
file picker, MediaPipe capture, and the actual CUDA DensePose service. At 1.50 s,
the response contained 20 visible surface charts and 24,795 colored overlay
pixels. Desktop (1440 px) and mobile (390 px) screenshots confirmed the map is
composited over the person, with no horizontal page overflow.

Two subsequent moving-video frames measured 323.4 and 328.5 ms inference. Seeking
to 4.50 s produced a new matched overlay (261.6 ms inference, 522 ms browser round
trip), which remained visible while paused. Withdrawing consent cleared it.
There were no browser page errors. A preceding cold browser request took 2,391 ms
end to end; timings vary and this is not a frame-rate guarantee. This unlabeled
clip checks pipeline behavior, not surface-coordinate or medical accuracy.

Artifacts: `.artifacts/densepose-video/report.json` and `overlay-1440.png` /
`overlay-390.png`. Clip provenance is in [knee video verification](knee-video-verification.md).

## Validation

```text
npm test
node scripts/qa-densepose.mjs
node scripts/qa-densepose-video.mjs
python -m pytest vision/test_densepose.py -q
python scripts/benchmark_densepose.py --image <local-test-image>
```

`qa-densepose.mjs` uses synthetic camera/video and mock DensePose outputs; it tests
consent, backpressure, pause, seek, stale-source recovery, and responsive layout.
`qa-densepose-video.mjs` requires the web preview on port 5180, the local service
on port 8012, and `.artifacts/knee-video/squat-7s.mp4`. It checks real uploaded-video
CUDA inference, painted surface pixels, playback, seeking, pause, and consent.
The optional benchmark tests real GPU inference on a fixed image plus a blank
image. None of these checks is a labeled model-accuracy evaluation.

The public NASA smoke-test photograph is credited to NASA:
[Bob Hines exercising on ARED](https://www.nasa.gov/image-article/astronaut-bob-hines-works-out-space-station/).
It is a runtime test, not training data, a medical assessment, or NASA endorsement.

## Model And Anatomy Licenses

- [DensePose model documentation](https://github.com/facebookresearch/detectron2/blob/fc3b7a1e658db27cdb52ee94ef5dcec7cc7eb1e7/projects/DensePose/doc/DENSEPOSE_IUV.md): checkpoint is CC BY-SA 3.0.
- Detectron2/DensePose code: Apache 2.0; retain the installed repository license.
- Anatomical atlas: Z-Anatomy, CC BY-SA 4.0, with BodyParts3D attribution and source-specific terms in `public/models/anatomy/SOURCE-LICENSE.txt`.
- `public/models/anatomy/manifest.json` records the pinned atlas sources and hashes.

The independent anatomy-atlas tab remains a static reference. Movement capture
now uses a derived, articulated bone-and-muscle GLB with 64 rig joints. It is not
individually registered or clinically validated. Counts refer to named mesh
structures, not anatomical bone/muscle counts. Camera landmarks move the
reference anatomy; DensePose does not infer its internal bones or muscle
activation. See [anatomical rig methods and limitations](anatomical-rig.md).
The earlier outer-surface human remains a fallback if the anatomical asset
cannot load.
