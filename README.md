# AstroBone

**Health monitoring software for astronauts on long missions.** A short daily self-check gathers health indicators on the device, compares each one with the astronaut's own baseline, and gives a safe next step. A 3D digital twin shows the result on the body. NASA life-science data decides what the check asks for and when. It runs in the browser, works offline, and no health data leaves the device.

**Live app:** https://mysunatislam.github.io/astrobone-space-apps-2026/

NASA Space Apps Challenge 2026 · [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/create-health-monitoring-software-for-astronauts-on-space-missions/) · Team AstroBone, Barisal, Bangladesh

| Team member | Role |
| --- | --- |
| Mysunat Islam | Team lead, software developer (biomedical engineer) |
| Redwan Ahamed Tamim | Lead data analyst (industrial & production engineer) |
| Mashyiat Islam Borno | UI/UX designer, video editor |

## The Problem

On a Mars transit a message to Earth can take up to 22 minutes one way, and there is no flight surgeon on board. Radiation, isolation, altered gravity and a closed environment change the immune system, bones and muscles, the heart and behavior. The challenge asks for software that **gathers health indicators** and **helps astronauts evaluate and act** on them.

## What AstroBone Does

| Step | How |
| --- | --- |
| **Gather** | A 5-minute daily self-check: seated knee-extension movement test with on-device pose AI, 3-minute reaction test (PVT-B), sleep, fatigue (Samn-Perelli), mood, stress, immune symptom checklist, resting heart rate and radiation dose. |
| **Evaluate** | A quality check first: a poor camera capture is refused and repeated, never reported as a decline. Each indicator is then compared with the astronaut's own baseline (after 3 usable checks) across four domains: bone & muscle, cardiovascular, behavioral health and immune. Red-flag symptoms override everything. |
| **Act** | A bounded next step with a due time: contact the medical officer now, repeat a measurement, or re-check in 24 h and log it for medical review. AstroBone never diagnoses or prescribes. |

The **digital twin** (home page) shows the astronaut's systems on 3D anatomy: skeleton, muscles, heart and vessels, across the mission timeline. Affected systems are highlighted after a self-check. **Live Capture** is the camera workspace: real-time pose tracking from a webcam or video, a musculoskeletal model that follows the tracked joints, and knee angle, range of motion and left-right difference with a quality gate.

## NASA Data Drives the Checks

Five datasets from the NASA Open Science Data Repository / Ames Life Sciences Data Archive, about 1,400 records, each source file verified by SHA-256. Every number below is computed from the data when the app loads ([`src/nasaWatch.js`](src/nasaWatch.js), tested in [`src/nasaWatch.test.js`](src/nasaWatch.test.js)).

| NASA study | What the data shows | What AstroBone does |
| --- | --- | --- |
| [OSD-804](https://osdr.nasa.gov/bio/repo/data/studies/OSD-804) · LSDS-130, spaceflight bone micro-CT (mice) | 54.5 % lower bone volume in the distal femur (just above the knee) after 37 days in space; 27.4 % at the hip, 8.3 % in the spine | The knee movement test comes first in every daily check |
| [OSD-656](https://osdr.nasa.gov/bio/repo/data/studies/OSD-656) · LSDS-64 and [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) · LSDS-7, Inspiration4 crew | Immune protein VCAM1 stayed above pre-flight for 45 days after return, back by day 82; white blood cells fell the day after return | Immune checklist every day for 45 days after any return to gravity |
| [OSD-435](https://osdr.nasa.gov/bio/repo/data/studies/OSD-435) · LSDS-22 (mice) and [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) · LSDS-8, Inspiration4 crew | No consistent change in heart ejection fraction after 0.1–3 Gy; CRP already varied 1.9–19.9 mg/L before launch | No radiation alarm; dose is logged beside heart rate for the medical reviewer |

The data sets priority and timing only. It never sets a personal threshold: mice and a four-person, three-day flight cannot calibrate one astronaut. Raw files, reproducible summaries and rules: [NASA data pipeline](docs/nasa-data-pipeline.md).

## Try It in 3 Minutes

1. Open the [live app](https://mysunatislam.github.io/astrobone-space-apps-2026/). Mission Control shows Commander Elena Torres, a fictional astronaut on Day 147 of a Mars transit.
2. Select **Self-Check**. The first step lists today's checks and the NASA evidence behind each. With **Elena · synthetic demo**, step through using the demo capture buttons: a poorly framed capture is refused and the repeat is accepted; then the reaction test, sleep and mood, and body. **Evaluate** shows which domains moved outside her own range and her next step; the twin highlights them.
3. Select **You · this device** to do the check yourself: the camera measures your knee extension, and the reaction test runs for 3 minutes.
4. Open **Live Capture** and start your camera or upload a video. The 3D musculoskeletal model follows your movement; joint angles and tracking quality update live.
5. **Impact Lab**, **Physiology** and **Evidence** show the impact physics model, the cardiovascular and radiation context, and every NASA source with its hash.
6. Offline: after one visit, turn on airplane mode and reload. Everything still works.

## Run Locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # 262 automated tests
npm run build      # production build in dist/
```

Rebuild the NASA summaries from NASA's servers (Python 3.10+): `npm run data:osdr`, `npm run data:mission`, `npm run data:mission:extended`.

## How It Is Built

- **Frontend:** JavaScript (ES modules), Vite, three.js / WebGL; a service worker for offline use.
- **On-device AI:** Google MediaPipe Pose Landmarker (WebAssembly + GPU) in a Web Worker; EfficientDet-Lite0 object detection in Live Capture.
- **Anatomy:** Z-Anatomy / BodyParts3D musculoskeletal and cardiovascular models, rigged for movement.
- **Models:** personal-baseline review (2 × SD with a minimum change), PVT-B reaction metrics, Euler–Bernoulli bending stress and a seeded 10,000-run Monte Carlo for the Impact Lab, checked against a stored Simulink reference.
- **Data:** Python scripts that download unrestricted NASA OSDR files and record their hashes.
- **Optional, off by default:** an Android app (Capacitor), and local services on the user's own computer for a whole-body mesh (YOLOX, RTMW, InstantHMR, MHR) and a Llama 3.2 review assistant. See [Android](docs/android-app.md) and [local companion](docs/local-companion-architecture.md).

| Path | Contents |
| --- | --- |
| `index.html`, `src/twin*.js` | Digital twin (home page) |
| `src/selfCheck*.js`, `src/nasaWatch.js` | Daily self-check, review rules, NASA-informed checks |
| `lab.html`, `src/main.js`, `src/poseDetection.worker.js` | Live Capture and on-device pose tracking |
| `public/data/` | NASA summaries used by the app |
| `public/models/` | Anatomy models and the pose model |
| `scripts/` | NASA data builders and test tools |
| `docs/` | Methods, validation protocols and data notes |

## Validation and Limits

- **Tested:** 262 automated tests cover the review rules, quality gates, NASA rules, pose analysis and models. The Monte Carlo reproduces a stored Simulink reference.
- **Not yet validated:** camera joint angles have not yet been compared with a reference measurement (motion capture or a goniometer); the [validation protocol](docs/functional-camera-validation-protocol.md) is written and is our next step. No astronaut or analog-crew user study has been run.
- **Data boundaries:** Elena and all her values are synthetic. The NASA cohorts are mice and a four-person, three-day flight; they inform what to watch, never a diagnosis or a personal threshold.
- AstroBone is a research prototype, not a medical device.

## Credits and Licenses

- Code: [MIT](LICENSE), © 2026 Mysunat Islam.
- NASA OSDR / ALSDA data: public, CC0. Z-Anatomy / BodyParts3D: CC BY-SA 4.0. MediaPipe: Apache 2.0. three.js: MIT.
- All third-party data, models and assets: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). AI tools used in development and in the app: [AI_USE_DISCLOSURE.md](AI_USE_DISCLOSURE.md).
