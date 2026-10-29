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
| **Gather** | A 5-minute daily self-check: seated knee-extension movement test with on-device pose AI and a hybrid knee model, 3-minute reaction test (PVT-B), sleep, fatigue (Samn-Perelli), mood, stress, immune symptom checklist, resting heart rate from the camera (a deep rPPG model cross-checked with a classic colour method) or typed in, typed blood pressure, blood sugar (mg/dL or mmol/L), body temperature and oxygen saturation, and radiation dose. Every indicator explains what it is and why it matters in space. A mission routine shows when each measurement belongs and when the next check is due, with a streak and badges that reward doing the checks, never the values. |
| **Evaluate** | A quality check first: a poor camera capture is refused and repeated, never reported as a decline. Each indicator is then compared with the astronaut's own baseline (after 3 usable checks) across five domains: bone & muscle, cardiovascular, metabolic, behavioral health and immune. One value just outside the usual range asks for a **re-check**; two in a row, or one far outside, is logged for **review** (a laboratory quality-control multirule), which cut false reviews for a healthy astronaut from 31 % to 7 % of daily checks in simulation. Vital signs also have fixed safety limits from public guidance (AHA, ADA, Mayo Clinic, NHS England) that apply from the first reading. A drift rule (CUSUM) also compares it with the astronaut's first checks, so a slow loss is caught even when every single day looks normal. Each result shows its trend, and an **Over time** chart shows any measurement across the whole mission with its usual range, starting level and safety limits; every point is judged as it was on its own day. Every status has a word and a marker shape as well as a colour, and the colours were checked for colour-blind viewers. Red-flag symptoms override everything. |
| **Act** | A bounded next step with a due time: contact the medical officer now, tell them today, repeat a measurement, or re-check in 24 h and log it for the flight surgeon. An escalation ladder words it for where the crew is (space station, Orion, lunar base, rover, Mars transit or Mars base), with the message delay to Earth. "What helps" guidance per domain comes from NASA research. **Report for flight surgeon** turns the result into a 1.6 kB plain-text message (13× smaller than the full JSON record) that reads on any ground terminal over a slow deep-space link. AstroBone never diagnoses or prescribes. |

The **digital twin** (home page) shows the astronaut's systems on 3D anatomy: skeleton, muscles, heart and vessels, across the mission timeline. Affected systems are highlighted after a self-check. Click any highlighted structure for a card with what it does, how spaceflight affects it, its status from the latest self-check, and a button to measure it now. Evidence maps NASA's five hazards of human spaceflight to the indicators that watch for them. **Live Capture** is the camera workspace: real-time pose tracking from a webcam or video, a musculoskeletal model that follows the tracked joints, and knee angle, range of motion and left-right difference with a quality gate. An uploaded video is analysed just ahead of playback, so the 3D model moves with the frame on screen. When a face is visible, an experimental camera pulse (and, with steady frames, heart-rate variability (RMSSD) from beat-to-beat timing) is shown.

## NASA Data Drives the Checks

Five datasets from the NASA Open Science Data Repository / Ames Life Sciences Data Archive, about 1,400 records, each source file verified by SHA-256. Every number below is computed from the data when the app loads ([`src/nasaWatch.js`](src/nasaWatch.js), tested in [`src/nasaWatch.test.js`](src/nasaWatch.test.js)).

| NASA study | What the data shows | What AstroBone does |
| --- | --- | --- |
| [OSD-804](https://osdr.nasa.gov/bio/repo/data/studies/OSD-804) · LSDS-130, spaceflight bone micro-CT (mice) | After 37 days in space, bone structure moved toward loss above the knee (distal femur, p = 0.004) and at the hip (p = 0.007), corrected across 5 sites; bone volume fraction above the knee −55 % (95% CI −68 to −30 %). No clear change in the spine | The knee movement test comes first in every daily check |
| [OSD-656](https://osdr.nasa.gov/bio/repo/data/studies/OSD-656) · LSDS-64 and [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) · LSDS-7, Inspiration4 crew | Urine immune protein VCAM1 stayed above every pre-flight visit for 45 days after return, back by day 82 (group medians of 4 people); white blood cells stayed within the pre-flight range | Immune checklist every day for 45 days after any return to gravity |
| [OSD-435](https://osdr.nasa.gov/bio/repo/data/studies/OSD-435) · LSDS-22 (mice) and [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) · LSDS-8, Inspiration4 crew | No consistent change in heart ejection fraction after 0.1–3 Gy; CRP already varied 1.9–19.9 mg/L before launch | No radiation alarm; dose is logged beside heart rate for the medical reviewer |
| [NASA DONKI](https://ccmc.gsfc.nasa.gov/DONKI/) solar energetic particle events, Oct 2023 to Oct 2026 | 40 measured solar particle events (218 DONKI rows, one per instrument channel; 87 model-forecast rows left out); 31 seen near Earth, 9 with >100 MeV protons at GOES | The radiation panel lists the latest real events with their DONKI links, as context beside the crew's dose. It never turns an event into a dose |

**The rule itself, tested on real astronauts.** AstroBone's own personal-baseline and drift code, unchanged, was replayed on the four Inspiration4 crew members' raw blood results ([OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) and [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575), 27 clinical measures, each person against their own three pre-flight draws, review floor from the EFLM biological variation database). It found mean cell volume down in all four crew the day after landing (−3.4 to −5.2 %, all inside the lab's population range), recognised a one-draw glucose drop at R+45 as a sample-handling suspect, and 23 of its 31 flags were changes the population range would have missed. The same glucose draws also set the blood-sugar safety limit: the ADA's 70 mg/dL alert level, meant for people treated for diabetes, fired on 4 of 12 healthy pre-flight draws, so the app uses 54 mg/dL ([`scripts/replay-i4-glucose-limits.mjs`](scripts/replay-i4-glucose-limits.mjs)). Method and full results: [crew replay](docs/crew-replay.md) ([`src/crewReplay.js`](src/crewReplay.js)); the Self-Check shows it as a "Tested" card.

The data sets priority and timing only. It never sets a personal threshold: mice and a four-person, three-day flight cannot calibrate one astronaut. Raw files, reproducible summaries and rules: [NASA data pipeline](docs/nasa-data-pipeline.md).

## Try It in 3 Minutes

1. Open the [live app](https://mysunatislam.github.io/astrobone-space-apps-2026/). Mission Control shows Commander Elena Torres, a fictional astronaut on Day 147 of a Mars transit. Her synthetic dosimeter accrues at 0.458 mGy/day, the absorbed dose rate the RAD instrument measured inside NASA's Curiosity cruise stage on the way to Mars ([Guo et al. 2015](https://doi.org/10.1051/0004-6361/201525680)).
2. Select **Self-Check**. The first step lists today's checks and the NASA evidence behind each. With **Elena · synthetic demo**, step through using the demo capture buttons: a poorly framed capture is refused and the repeat is accepted; then the reaction test, sleep and mood, and body. **Evaluate** shows which domains moved outside her own range and her next step; the twin highlights them.
3. Select **You · this device** to do the check yourself: the camera measures your knee extension, and the reaction test runs for 3 minutes.
4. Open **Live Capture** and start your camera or upload a video. The 3D musculoskeletal model follows your movement; joint angles and tracking quality update live. With a clearly visible, still face, the pulse appears after about 12 s.
5. **Impact Lab**, **Physiology** and **Evidence** show the impact physics model, the cardiovascular and radiation context, and every NASA source with its hash.
6. Offline: after one visit, turn on airplane mode and reload. Everything still works.

## Run Locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # 409 automated tests
npm run build      # production build in dist/
```

Rebuild the NASA summaries from NASA's servers (Python 3.10+): `npm run data:osdr`, `npm run data:mission`, `npm run data:mission:extended`, `npm run data:dosimetry`, `npm run data:donki`.

## How It Is Built

- **Frontend:** JavaScript (ES modules), Vite, three.js / WebGL; a service worker for offline use.
- **On-device AI:** Google MediaPipe Pose Landmarker (WebAssembly + GPU) in a Web Worker; EfficientDet-Lite0 object detection in Live Capture.
- **Anatomy:** Z-Anatomy / BodyParts3D musculoskeletal and cardiovascular models, rigged for movement.
- **Models:** personal-baseline review (2 × SD with a minimum change), CUSUM drift against a locked starting baseline (tuned by simulation, [results](docs/core-analysis-2026-10-25.md)), PVT-B reaction metrics, Euler–Bernoulli bending stress and a seeded 10,000-run Monte Carlo for the Impact Lab, checked against a stored Simulink reference.
- **Data:** Python scripts that download unrestricted NASA OSDR files and record their hashes.
- **Privacy:** checks stay on the device and are saved only with consent; an optional passcode encrypts them with AES-256-GCM (Web Crypto, PBKDF2 key) for shared laptops ([details](docs/self-check.md#storage-and-privacy)).
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

- **Tested:** 409 automated tests cover the review rules, quality gates, NASA rules, pose analysis, video synchronization, the camera pulse and the models. The Monte Carlo reproduces a stored Simulink reference. Video sync and the camera pulse were measured in the browser ([method and results](docs/video-sync-and-camera-pulse.md)). An axe-core scan of every view at desktop and phone width finds no WCAG 2.1 A/AA violations (`scripts/qa-a11y.mjs`).
- **Validated on real video:** the knee and the camera pulse were scored on recorded video of real people against lab ground truth ([report](docs/real-video-validation.md)). Knee: MediaPipe's 3D angle under-read squat range of motion by about 30° facing the camera; AstroBone's hybrid knee model (MediaPipe + learned trees) cut the error per rep from 21.7° to 13.2° and was better for 9 of 9 people it never saw (motion capture, REHAB24-6). Pulse: on 40 people at rest and after squats, the old method refused 95 % of real webcam windows; the hybrid was within 2.1 bpm of a finger sensor on average and tracked each person's rise from rest within 4.2 bpm (MCD-rPPG). Knee repeat noise, from the same saved data: side-on, the reading moved ±5.8° (range of motion) and about ±4.4° (extension) between repetitions with no change in the knee, so the false-alarm simulation and the result screen now use those measured figures instead of a guess ([section 5](docs/real-video-validation.md#5-repeat-noise-what-one-knee-check-can-tell)). The twin's Evidence view lists what was tested on real data and what was not, from the same tables.
- **Reaction test timing:** the stimulus onset is timed to the frame that draws it and the 3D view pauses during the test. A browser check with a simulated 300 ms responder scores 300 ms; before, a software-rendered browser scored it 665 ms on average and turned 7 of 9 responses into lapses ([details](docs/core-analysis-2026-10-25.md#reaction-test-timing)).
- **Camera position:** each frame records whether the person faces the camera or sits side-on. Side-on, only the near knee counts; a part-turned capture is refused. On real video, side-on readings were the most accurate, so the self-check now recommends sitting side-on; positions are never compared ([why](docs/core-analysis-2026-10-25.md#camera-position)).
- **Not yet validated:** the seated knee-extension test itself has not been compared with a goniometer (the real-video check used squats and lunges). The Self-Check has a built-in **accuracy check** (camera vs goniometer, Bland–Altman bias, limits of agreement and detectable change); once 20+ pairs from 3+ people are recorded, the knee review trigger is raised to match the measured error. The [validation protocol](docs/functional-camera-validation-protocol.md) is written. No astronaut or analog-crew user study has been run.
- **Data boundaries:** Elena and all her values are synthetic. The NASA cohorts are mice and a four-person, three-day flight; they inform what to watch, never a diagnosis or a personal threshold.
- AstroBone is a research prototype, not a medical device.

## Credits and Licenses

- Code: [MIT](LICENSE), © 2026 Mysunat Islam.
- NASA OSDR / ALSDA data: public, CC0. Z-Anatomy / BodyParts3D: CC BY-SA 4.0. MediaPipe: Apache 2.0. three.js: MIT.
- All third-party data, models and assets: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). AI tools used in development and in the app: [AI_USE_DISCLOSURE.md](AI_USE_DISCLOSURE.md).
