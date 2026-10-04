# AstroBone

**NASA Space Apps 2026 · Create Health Monitoring Software for Astronauts on Space Missions.** On long missions astronauts must spot health changes in themselves. AstroBone's **Daily Self-Check** (in [`twin.html`](https://mysunatislam.github.io/astrobone/twin.html)) does the three things the brief asks for:

- **Gather:** camera knee extension, a 3-minute reaction test (PVT-B), sleep, fatigue, mood, stress, immune symptoms, resting heart rate and dosimeter context.
- **Evaluate:** quality gates first, then a comparison with the astronaut's own baseline across bone & muscle, cardiovascular, behavioral health and immune.
- **Act:** bounded next steps (contact now, repeat, re-check and log for review) with due times and a reviewer export.

A 3D digital twin shows the result on the body. The self-check runs in the browser and sends none of its data to a server. See [Daily Self-Check](docs/self-check.md) and the [pitch kit](docs/space-apps-2026-pitch.md).

AstroBone helps astronauts and crew medical officers review personal health observations, distinguish usable changes from poor measurements, and prepare an evidence-linked follow-up record. The camera avatar is an estimated-motion visualization, not a validated anatomical digital twin. External X-ray research is clearly separated from crew imaging; impact calculations remain in the research tools.

The default **Health review** retains the Research Lab's movement, cardiovascular, radiation and external X-ray channels. The dedicated `/#mission-demo` route now opens **Mission Intelligence**: Commander Elena Torres, ARES TRANSIT-1, Day 147 of a fictional 240-day transit. Eight authored checkpoints, seven anatomical/context layers, evidence graph, data lineage, verification gates, contextual Astra actions, isolated what-if controls, simulated Earth-link loss and handoff export share one deterministic state. **Play demo** runs a cancellable 50-second sequence; **Shift+D** opens presenter controls. See [implementation and truth contract](docs/mission-intelligence.md).

Elena's scenario lives only in memory and never overwrites crew profiles. The older Alex Morgan test fixture remains in Research Lab for regression continuity. Neither persona represents real astronaut observations. Presentation Astra uses deterministic calculations and local prepared-source lookup, not an LLM. The local AI service remains optional in Research Lab.

NASA data actually used: OSD-575 human Inspiration4 serum assays, OSD-435 mouse radiation/cardiac observations, OSD-804 mouse bone microCT, OSD-569 human blood counts, and OSD-656 human urine immune-protein assays. **NASA measurements** shows computed aggregates, units, sample counts and source hashes. These cohorts are never substituted for the demo astronaut's measurements. The current FracAtlas overlay is real public imaging with **precomputed**, uncalibrated model output, not live inference. See [data provenance and reproducibility](docs/mission-health-data.md) and [October 7 delivery plan and rehearsal](docs/october-7-demo.md).

The cardiovascular view now uses an anatomical Z-Anatomy heart/vessel GLB. **Inspect circulation model** opens a separate published left-heart/Windkessel reference simulation with pressure, volume and flow plots, not a patient-specific physiology estimate. See [cardiovascular model and added NASA datasets](docs/cardiovascular-nasa-research.md).

See the [October 3 implementation audit, evidence limits, and competition assessment](docs/competition-audit-2026-10-03.md) and [exact demo script](docs/competition-demo-2026-10-03.md). These supersede older maturity and presentation claims below. Public deployments have not been updated by this local work.

- Live app: https://mysunatislam.github.io/astrobone/
- Digital twin: https://mysunatislam.github.io/astrobone/twin.html
- Public repository: https://github.com/mysunatislam/astrobone
- Project owner: Mysunat Islam / [@mysunatislam](https://github.com/mysunatislam)

AstroBone is not a diagnostic system, medical device, or validated astronaut fracture predictor.

## Problem And Proposed Solution

When communication is delayed, a crew medical officer needs a traceable way to review movement changes without confusing poor tracking with a health change. A camera does not measure bone density or establish the cause of reduced movement.

AstroBone provides one explainable workflow:

1. Capture a short, repeatable movement and retain source and quality metadata.
2. Save consented aggregates to a real-observation profile, separate from the synthetic demo.
3. Compare against that person's protocol- and gravity-matched baseline.
4. Withhold an unreliable comparison; show mission exposure as context, not a causal health score.
5. Review relevant evidence, record a bounded repeat request, and compare the next usable observation.

## Capabilities And Availability

The core browser workflow is tested locally. Optional services require their own runtimes and assets; inclusion in this inventory does not mean they were running during the current audit.

- **Multisystem observations** adds source-labelled cardiovascular and personal
  dose-equivalent records, source/device/protocol-matched trends, a shared mission
  timeline, and schematic 3D layers. Experimental quality-gated webcam pulse is
  opt-in, never a substitute for a contact sensor. No webcam SpO2 or radiation sensing.
- **Optional local mesh service** connects RTMW 133 landmarks, InstantHMR and Meta
  MHR LOD3 while preserving the browser human rig. See
  [setup, boundaries and benchmark procedure](docs/multisystem-vision.md).

- **MotionGuard** adds shoulder elevation, elbow/hip/knee flexion, bilateral
  angle differences, per-joint angular speed, trunk-axis deviation, squat and
  controlled-reach counting, and alternating knee-cycle timing to the
  camera-linked twin. Outputs are monocular kinematic estimates, not a fabricated
  bone-load or health score. See `docs/motionguard.md`.

- An articulated Z-Anatomy reference GLB renders 277 skeletal and 683 muscular structures with 64 rig joints. Bones remain rigid; muscle surfaces use approximate visual skinning. Separate layer, opacity, and mesh-line controls are available. This is not measurement of individual internal bones or muscle activation. See [anatomical rig and validation boundaries](docs/anatomical-rig.md). The original outer-body rig remains a load-failure fallback.
- Local MediaPipe hand landmarks drive fingers on both hands; face landmarks show a mesh with eye and lip contours and drive the avatar's jaw. A sustained eye-closure cue uses observed frames and optional speech, without claiming to detect or diagnose sleep. See `docs/live-retargeting.md`.
- Stand, idle breathing, space-traveler, and live-pose motion modes.
- Browser-local MediaPipe Pose tracking maps 33 landmarks to 16 directional channels across the spine, head, shoulders, arms, hands, legs, and feet, with adaptive smoothing, body centering, rig coverage, FPS, and inference-latency feedback. Fresh hand landmarks add up to 30 finger-segment directions and face detail supplies a jaw cue. Desktop browsers can select any enumerated PC webcam, while mobile browsers retain front/rear orientation controls. Pose inference runs in a dedicated worker so camera controls and alerts remain responsive on slower devices.
- A bundled EfficientDet-Lite0 worker identifies supported COCO object classes at a lower frame rate, draws object bounds, and estimates left/ahead/right plus approach/retreat from bounding-box history.
- The crew safety monitor times low-change and selected joint-loading postures, then issues configurable movement reminders. These are prototype ergonomic cues, not evidence of bone injury.
- Spoken cues use Android's native TextToSpeech engine in the packaged app and browser speech synthesis as a web fallback, with event-specific cooldowns.
- Optional movement assessment records knee range of motion, left-right asymmetry, tracking quality, and change from a session baseline.
- Local MP4/WebM exercise video uses the same on-device pose worker and human view as the webcam. An automatic eight-second observation can be replayed; insufficient tracking remains insufficient evidence. Video results retain their own source provenance and cannot reuse a live-camera baseline.
- A consented personal dosimeter series can be entered manually by mission day and instrument ID. Device provenance is not authenticated. It appears separately in the review as radiation context, with no inferred bone dose or combined health score.
- A versioned movement-evidence export adds aggregate capture reliability, frame usability, rig coverage, FPS, latency, and privacy/claim boundaries without storing video or raw landmarks.
- Fracture research code references DenseNet121 and U-Net++; trained checkpoints and a complete serving entry point were not available in the audited checkout, so current end-to-end inference was not verified.
- Earlier FracAtlas demonstration and OSDR-804 mouse microCT integrations are retained as research references. Their source data and generated public artifacts were not present here; do not present them as newly verified datasets or astronaut measurements.
- Transparent impact equations, assumptions, warnings, and a relative skeletal mechanical risk index that is explicitly not a fracture probability.
- Verified Simulink Level-A evidence replay with source hashes and internal consistency checks.
- Crew condition review, protocol-linked actions, trend logging, and handoff/competition/validation exports.
- Persistent high-contrast light and dark themes keep the 3D twin viewport dark while improving dashboard readability.
- Live interface telemetry shows mechanical DCR, modeled capacity reduction, and evidence coverage as separate normalized histories; it is explicitly not a physiological waveform or combined medical score.
- Astra is a floating, twin-linked research copilot that explains the current deterministic evidence state without diagnosing.
- Browser mode supports the local review, bundled avatar, and local pose pipeline without the private AI service. Missing dataset artifacts remain unavailable; a clean-install offline/PWA audit has not been completed.

## System Architecture

| Layer | Technology | Role | Data boundary |
| --- | --- | --- | --- |
| Crew interface | Vite, Three.js | 3D twin, workflow, exports, evidence display | Static GitHub Pages app |
| Functional vision | MediaPipe Tasks Vision + Web Workers | Smoothed pose control, bounded object awareness, posture timing, and camera-direction cues without blocking the UI thread | Runs locally; frames are transferred to in-app workers, never uploaded or retained, and one camera only covers its field of view |
| Voice cues | Android TextToSpeech + Web Speech fallback | Cooldown-protected posture and approach reminders | Advisory output; no diagnosis or collision-avoidance claim |
| Image inference | FastAPI, PyTorch | DenseNet121 score and U-Net++ mask | Uploaded X-ray decoded in memory; not written to disk |
| Mechanics | JavaScript + Simulink evidence | Transparent event reconstruction and replay | Research envelope, not clinical biomechanics |
| Space evidence | NASA OSDR-804 | Biological plausibility and site-specific trends | Mouse microCT; never used as human calibration |
| Decision support | Deterministic JavaScript | Evidence completeness, urgency, actions, handoff | Symptoms never alter the image-model score |

## Movement-first companion

The default screen is **Movement capture**: live camera or local exercise video
beside the pose-linked human. **Personal review** holds the crew member's baseline,
mission-day timeline, comparison, evidence context, and handoff. **Research
tools** retains the X-ray and impact demonstrators but is not the main health
workflow. Camera motion does not measure bone density, muscle strength, or
fracture probability.

On a hosted site, Personal review runs entirely in the browser. With explicit
consent, it stores only allowlisted aggregate measurements in unencrypted local
browser storage, plus any separately consented dosimeter readings; it does not
store frames or raw landmarks. Its report uses
fixed comparison rules and two curated NASA context pages, not RAG, an LLM,
clinical risk prediction, or autonomous treatment. The Day 1-180 scenario is
synthetic. Use pseudonyms and do not enter real health records in this prototype.

Run the browser-only journey, including dosimeter context, on desktop and mobile with a local Vite server:

```powershell
node scripts/qa-health-flow.mjs http://127.0.0.1:5180/
```

## Local Llama / Gemma Companion

The new **Crew companion** workspace adds consented aggregate observations,
locked personal baselines, mission timelines, local LLM tool planning, local
NASA evidence retrieval and verified report export. The existing camera-linked
human remains in **Movement capture**. No cloud API key is needed.

First-time setup from this project directory (Python 3.11+ and Node installed):

```powershell
py -m venv .venv-companion
.\.venv-companion\Scripts\python.exe -m pip install -r requirements-companion.txt
.\scripts\setup-local-model.ps1
```

The setup script downloads the official Ollama runtime, `llama3.2:3b` and
`embeddinggemma` to `E:\AstroBoneRuntime`. Downloads require several GB. Its
`-RuntimeRoot` parameter changes that location. Optional Gemma setup:
`-Model gemma3:4b`. Check the selected model's license before redistribution.

Start or reconnect on subsequent launches:

```powershell
.\scripts\start-companion.ps1
```

Open **http://127.0.0.1:5180/#crew-companion**, select **Day 1-180 demo**, then
**Run verified review**. The scenario is explicitly synthetic. For your own
observations, create a separate profile, complete a camera or video assessment, and use
**Save movement assessment** with explicit consent.

The API is at `http://127.0.0.1:8010/docs`. Logs are under `.artifacts/companion`;
the launcher keeps the unencrypted SQLite database in
`E:\AstroBoneRuntime\data\crew.sqlite3`, outside this OneDrive project. Starting
Uvicorn directly instead defaults to `%LOCALAPPDATA%\AstroBone\companion`.
Do not choose a cloud-synced folder for crew data. Unavailable models fall back to a
clearly labeled deterministic review, never a cloud model. A hosted app cannot
access this private desktop service and instead uses the browser-only review
described above. The LLM is not embedded in the Android APK.

See [architecture and limits](docs/local-companion-architecture.md),
[mission health build contract](docs/autonomous-health-platform.md),
[API design](docs/companion-api.md), and
[competition demonstration](docs/space-apps-companion-storyline.md).

Companion verification commands:

```powershell
.\.venv-companion\Scripts\python.exe -m pytest companion -q
npm test
node scripts/qa-companion.mjs
.\.venv-companion\Scripts\python.exe scripts/verify-local-companion.py
```

The final command requires running local services and creates an isolated
synthetic profile plus a report artifact. It asserts actual LLM planning and
FAISS/embedding retrieval, rather than accepting a fallback as model success.

## Run The Frontend Only

Requirements: Node.js 20 or newer.

```powershell
npm install
npm run prepare:vision
npm run dev
```

Open the URL printed by Vite. The public GitHub Pages build is produced with `npm run build:github`.

## Build The Android App

AstroBone includes a Capacitor 8 Android project with package ID
`com.mysunatislam.astrobone`. MediaPipe camera frames stay on-device, native
TextToSpeech provides spoken safety cues, and JSON evidence exports use
Android's native share sheet.

Requirements: Node.js 22+, Android Studio 2025.2.1 or newer, Android SDK 36,
Java 21+, and an API 24+ device or emulator with an updated System WebView.

```powershell
npm install
npm run android:apk
```

The debug APK is copied to
`.artifacts/android/AstroBone-Twin-debug.apk`. Run `npm run android:open`
to inspect, sign, or deploy the project in Android Studio.

The skeleton, mechanics, NASA evidence, held-out X-ray case, local pose and
object models, posture monitor, and Android voice cues work without a backend.
Live X-ray inference requires a
reachable HTTPS FastAPI deployment configured in the app's **AI service
connection** panel. See `docs/android-app.md` for setup and release boundaries.

## Run The Local AI Service

The trained checkpoints remain local because they are large and experimental. The helper script builds the frontend, checks the checkpoint paths, and starts FastAPI at `http://127.0.0.1:8000`.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-ai.ps1
```

Override any detected path when needed:

```powershell
.\scripts\start-local-ai.ps1 `
  -Python "C:\path\to\python.exe" `
  -ClassifierCheckpoint "E:\AstroBone\ml\runs\classifier_densenet121\best_classifier.pt" `
  -SegmenterCheckpoint "E:\AstroBone\ml\runs\segmentation_unetpp_densenet121\best_segmenter.pt" `
  -InstallDependencies
```

API endpoints:

- `GET /api/v1/health`
- `POST /api/v1/xray/analyze` with a JPEG, PNG, or WebP image up to 15 MB

## Reproduce The NASA Data Artifact

The committed OSDR source table and data dictionary are CC0. Rebuild the browser summary with:

```powershell
python .\scripts\build_osdr_summary.py
```

The output records the accession, DOI, license, file hashes, sample counts, and flight-versus-ground comparisons. OSDR-804 contains female mouse microCT data after a 37-day spaceflight; it supports biological plausibility but does not calibrate human fracture risk.

## Evaluate The Exact Served Checkpoints

Earlier training scripts evaluated their final in-memory epoch even when a different best-validation checkpoint was saved. That behavior is fixed for future training. Do not attribute the earlier AUC/Dice values to the served checkpoints.

Run the dedicated evaluator on the exact checkpoints and frozen test manifests:

```powershell
python -m ml.scripts.evaluate_served_checkpoints `
  --classification-csv "E:\AstroBone\data\splits\fracatlas\classification_test.csv" `
  --segmentation-csv "E:\AstroBone\data\splits\fracatlas\segmentation_test.csv" `
  --classifier "E:\AstroBone\ml\runs\classifier_densenet121\best_classifier.pt" `
  --segmenter "E:\AstroBone\ml\runs\segmentation_unetpp_densenet121\best_segmenter.pt" `
  --output ".\public\model-evidence\served-model-metrics.json"
```

The report includes checkpoint and split hashes, confusion counts, discrimination, calibration, Dice/IoU, and bootstrap confidence intervals. It remains internal held-out FracAtlas validation, not external or clinical validation.

## Verification

```powershell
npm test
npm run build
python -m compileall api ml\scripts
```

With a local server running, the Playwright harness checks desktop and mobile layout, WebGL pixel variation, skeleton motion, NASA evidence, local camera processing, and console errors:

```powershell
npm run test:ui -- http://127.0.0.1:8000/
```

Pass a real test X-ray as the second argument to include live API inference:

```powershell
npm run test:ui -- http://127.0.0.1:8000/ "E:\AstroBone\data\raw\FracAtlas\images\Fractured\IMG0001739.jpg"
```

## Evidence And Claim Boundaries

- FracAtlas is a public musculoskeletal X-ray dataset, not astronaut medical data.
- OSDR-804 is mouse microCT evidence, not human calibration.
- Monocular webcam landmarks estimate functional movement and depth; they are not motion-capture ground truth, do not detect a fracture, and never change the image score.
- The demand-capacity ratio is a transparent scenario-comparison construct, not a probability.
- Simulink agreement proves implementation consistency only.
- External imaging, biomechanics, usability, medical, and mission-operational validation remain required.

## Research Documentation

- [Daily Self-Check](docs/self-check.md) - gather, evaluate and act loop: instruments, quality gates, personal review triggers, storage and verification status
- [240-second presentation and voiceover](docs/pitch-voiceover.md) - `pitch.html`: timed video-style pitch with live tracking and twin demos, teleprompter, recording checklist and script
- [Space Apps 2026 pitch kit](docs/space-apps-2026-pitch.md) - brief mapping, 240-second and 30-second scripts, judge questions and claims to avoid
- [Digital twin page and visual requirement](docs/ui-visual-experience.md) - `twin.html`: full-screen 3D digital twin (Mission Control, Digital Twin, Functional Scan, Impact Lab, Physiology, Evidence); every visual tied to fixture data or a tested model
- [Articulated anatomical reference](docs/anatomical-rig.md) - generated GLB, observed/coupled motion, bone/muscle layers, provenance, and software verification
- [Local DensePose setup and limitations](docs/densepose.md) - camera/video surface maps, private GPU runtime, tests, and anatomical atlas boundaries
- `docs/architecture-freeze-v2.md` - frozen architecture, terminology, evidence boundaries, and change gate
- `docs/parameter-evidence-table.md` - source, confidence, uncertainty, and disposition for every active parameter
- `docs/mechanical-model-v2.md` - reduced-order axial, bending, shear, and torsion equation contract
- `docs/competition-readiness.md` - Space Apps delivery plan and remaining gates
- `docs/real-world-validation.md` - staged path from software checks to mission-analog evidence
- `docs/functional-camera-validation-protocol.md` - frozen protocol for external webcam reliability and validity testing
- `docs/android-app.md` - native Android build, privacy, backend, testing, and release workflow
- `docs/validation-model-cards.md` - intended use, non-use, metrics status, and failure modes
- `docs/model-assumptions.md` - equations, units, assumptions, and claim limits
- `docs/data-dictionary.md` - model variables, ranges, sources, and uncertainty
- `docs/simulation-evidence.md` - Simulink provenance and verification boundary
- `docs/space-bone-datasets.md` - candidate spaceflight bone datasets
- `docs/crew-operations-workflow.md` - prevention, response, monitoring, and handoff design
- `THIRD_PARTY_NOTICES.md` - datasets, models, assets, source links, and licenses
- `AI_USE_DISCLOSURE.md` - how AI tools and models were used in the project

## Priority Before NASA Space Apps 2026

1. Map AstroBone to one official 2026 challenge after the challenge statements are released.
2. Complete checkpoint-aligned and external image evaluation with confidence intervals and failure cases.
3. Source V2 tibial geometry and mode-specific capacities, then add an independent biomechanics or benchtop benchmark.
4. Run a small crew-analog usability study and obtain qualified aerospace-medicine review.
5. Freeze a reproducible release, record a two-minute end-to-end demo, and disclose all AI/data use.
