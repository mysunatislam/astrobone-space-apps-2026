# AstroBone

**Health monitoring software for astronauts on long missions.** A short daily self-check gathers health indicators on the device, compares each one with the astronaut's own baseline, and gives a safe next step. A 3D digital twin shows the result on the body. NASA life-science data decides what the check asks for and when. It runs in the browser, works offline, and no health data leaves the device.

**Live app:** https://mysunatislam.github.io/astrobone-space-apps-2026/

NASA Space Apps Challenge 2026 · [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/) · Team AstroBone, Barisal, Bangladesh

> **Local Champion, NASA Space Apps 2026 Barisal, Bangladesh.**

**Judges:** please review the code as submitted, commit [`524852f`](https://github.com/mysunatislam/astrobone-space-apps-2026/tree/524852f387b09f8ea3cd2c2c20de8aca9d0f8847) (Nov 11, 2026), the last commit before the Nov 14 deadline. Later commits change documentation only; the app code is frozen until judging ends.

**Contents:** [The problem](#the-problem) · [What AstroBone does](#what-astrobone-does) · [NASA data](#nasa-data-drives-the-checks) · [Try it in 3 minutes](#try-it-in-3-minutes) · [Validation and limits](#validation-and-limits) · [Run locally](#run-locally) · [How it is built](#how-it-is-built) · [Team](#team) · [Project history](#project-history) · [Credits and licenses](#credits-and-licenses)

## The Problem

On a Mars transit a message to Earth can take up to 22 minutes one way, and there is no flight surgeon on board. Radiation, isolation, altered gravity and a closed environment change the immune system, bones and muscles, the heart and behavior. The challenge asks for software that **gathers health indicators** and **helps astronauts evaluate and act** on them.

## What AstroBone Does

### Gather

A 5-minute daily self-check:

- a seated knee-extension movement test, measured by on-device pose AI and a hybrid knee model;
- a 3-minute reaction test (PVT-B);
- sleep, fatigue (Samn-Perelli), mood, stress and an immune symptom checklist;
- resting heart rate from the camera (a deep rPPG model cross-checked with a classic colour method) or typed in;
- typed blood pressure, blood sugar (mg/dL or mmol/L), body temperature and oxygen saturation;
- radiation dose.

Every indicator explains what it is and why it matters in space. A mission routine shows when each measurement belongs and when the next check is due, with a streak and badges that reward doing the checks, never the values.

### Evaluate

- **Quality first.** A poor camera capture is refused and repeated, never reported as a decline.
- **Against the astronaut's own baseline** (after 3 usable checks), across five domains: bone & muscle, cardiovascular, metabolic, behavioral health and immune.
- **Re-check before review.** One value just outside the usual range asks for a re-check; two in a row, or one far outside, is logged for review (a laboratory quality-control multirule). In a simulation of 1,000 healthy astronauts over 60 days, using published day-to-day spreads, this cut the share of days flagged for review from 44.8 % (one-value rule) to 11.4 % ([`scripts/simulate-false-alarms.mjs`](scripts/simulate-false-alarms.mjs)). The reaction test's, oxygen's and the ratings' spreads are still assumed; halving or doubling them gives 10.9 % to 19.2 % ([how much the assumptions matter](docs/self-check.md)).
- **Fixed safety limits** for vital signs from public guidance (AHA, ADA, Mayo Clinic, NHS England) apply from the first reading.
- **Slow drift.** A CUSUM rule compares each value with the astronaut's first checks, so a slow loss is caught even when every single day looks normal.
- **Trends.** Each result shows its trend, and an **Over time** chart shows any measurement across the mission with its usual range, starting level and safety limits; every point is judged as it was on its own day.
- **Accessible.** Every status has a word and a marker shape as well as a colour, and the colours were checked for colour-blind viewers.
- Red-flag symptoms override everything.

### Act

- A bounded next step with a due time: contact the medical officer now, tell them today, repeat a measurement, or re-check in 24 h and log it for the flight surgeon.
- An escalation ladder words it for where the crew is (space station, Orion, lunar base, rover, Mars transit or Mars base), with the message delay to Earth.
- "What helps" guidance per domain comes from NASA research.
- **Report for flight surgeon** turns the result into a 1.6 kB plain-text message (13× smaller than the full JSON record) that reads on any ground terminal over a slow deep-space link.
- AstroBone never diagnoses or prescribes.

### The views

| View | What it shows |
| --- | --- |
| **Digital twin** (home page) | The astronaut's systems on 3D anatomy (skeleton, muscles, heart and vessels) across the mission timeline. Affected systems are highlighted after a self-check. Click a highlighted structure for what it does, how spaceflight affects it, its latest status and a button to measure it now. |
| **My Health** | The astronaut's own dashboard: today's status and who to tell, the five body systems, every indicator as a tile with value, status, usual range, change since the first check and a mission-long trend, the next steps, the flight-surgeon report, radiation dose and a calendar of checks done and missed. It shows the self-check's own judgement, so the two never disagree. |
| **Crew** | All four crew members of the demo mission for the crew medical officer and flight surgeon, most serious first, each judged by the same rules against their own earlier checks, with a 1.3 kB plain-text crew summary for a slow link. |
| **Crewmate check** | The challenge's scenario of a crewmate with sudden chest pain or pain elsewhere. Tap where it hurts and how it feels, tick the warning signs public guidance lists (heart: AHA; stroke: BE-FAST; blood clot: NHLBI; kidney stone: NIDDK), then take a camera minute (camera pulse plus face cues against the crewmate's own earlier checks) and a 20-second reading of the Rainbow Passage. The result is how fast to involve the medical officer and flight surgeon, the systems lit on the twin, the reasons and a summary to send. It never names a condition or a medicine. |
| **Live Capture** | Real-time pose tracking from a webcam or video, a musculoskeletal model that follows the tracked joints, and knee angle, range of motion and left-right difference with a quality gate. An uploaded video is analysed just ahead of playback, so the 3D model moves with the frame on screen. With a visible face, an experimental camera pulse; it says why when the signal is unclear. Heart-rate variability from the camera is not shown: it failed on real video. |
| **Evidence** | NASA's five hazards of human spaceflight mapped to the indicators that watch for them, every NASA source with its hash, and what was and was not tested on real data. |
| **Impact Lab**, **Physiology** | The impact physics model (Euler–Bernoulli bending stress, seeded Monte Carlo) and the cardiovascular and radiation context. |

**X-ray bones on the camera.** While the camera or an uploaded exercise video is tracked, the app's rigged 3D skeleton is drawn over the picture in the twin's X-ray style and moves with the person. In Live Capture the skull follows the face mesh and every finger bone follows the hand landmarks. It is on by default in the Self-Check movement step and in Live Capture (`lab.html?xray=0` starts with it off). It is the reference atlas skeleton placed on the tracked landmarks, not imaging and not the person's own bones.

**Experimental breathing check.** Live Capture → Respiratory motion is a 45-second check from pose-guided chest and abdomen optical flow, with camera and body motion rejection, a waveform, signal quality and local history. A normal webcam does not measure depth; RGB-D support imports timestamped region distances only. It is **not validated against a reference belt**, and synthetic signals cannot enter saved history ([module and protocol](docs/respiratory-module.md)).

## NASA Data Drives the Checks

Every source file is downloaded from NASA by a script in [`scripts/`](scripts/) and verified by SHA-256. The numbers in the first rows are computed from the data when the app loads ([`src/nasaWatch.js`](src/nasaWatch.js), tested in [`src/nasaWatch.test.js`](src/nasaWatch.test.js)).

| NASA source | What the data shows | What AstroBone does with it |
| --- | --- | --- |
| [OSD-804](https://osdr.nasa.gov/bio/repo/data/studies/OSD-804) · LSDS-130, Rodent Research-1 bone micro-CT (mice) | After 37 days in space, bone structure moved toward loss above the knee (distal femur, p = 0.004) and at the hip (p = 0.007), corrected across 5 sites; bone volume fraction above the knee −55 % (95% CI −68 to −30 %). No clear change in the spine | The knee movement test comes first in every daily check |
| [OSD-656](https://osdr.nasa.gov/bio/repo/data/studies/OSD-656) · LSDS-64 and [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) · LSDS-7, Inspiration4 crew | Urine immune protein VCAM1 stayed above every pre-flight visit for 45 days after return, back by day 82 (group medians of 4 people); white blood cells stayed within the pre-flight range | Immune checklist every day for 45 days after any return to gravity |
| [OSD-435](https://osdr.nasa.gov/bio/repo/data/studies/OSD-435) · LSDS-22 (mice) and [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) · LSDS-8, Inspiration4 crew | No consistent change in heart ejection fraction after 0.1–3 Gy; CRP already varied 1.9–19.9 mg/L before launch | No radiation alarm; dose is logged beside heart rate for the medical reviewer |
| ISS area dosimeters, recorded in 32 [NASA OSDR](https://osdr.nasa.gov/bio/repo/) flight studies (SpaceX-2 to SpaceX-21, 2013–2020) | Absorbed dose rates of 0.204–0.355 mGy/day (median 0.294) inside the station | A crew dosimeter rate is shown against the rates measured aboard the ISS, as context only ([`src/issDosimetry.js`](src/issDosimetry.js)) |
| Curiosity MSL/RAD, Mars cruise ([Guo et al. 2015](https://doi.org/10.1051/0004-6361/201525680)) | 0.458 mGy/day absorbed dose rate inside the cruise stage on the way to Mars | The demo astronaut's synthetic dosimeter accrues at this rate |
| [NASA DONKI](https://ccmc.gsfc.nasa.gov/DONKI/) solar energetic particle events, Oct 2023 to Oct 2026 | 40 measured solar particle events (218 DONKI rows, one per instrument channel; 87 model-forecast rows left out); 31 seen near Earth, 9 with >100 MeV protons at GOES | The radiation panel lists the latest real events with their DONKI links beside the crew's dose. It never turns an event into a dose |
| [OSD-489](https://osdr.nasa.gov/bio/repo/data/studies/OSD-489) and [OSD-654](https://osdr.nasa.gov/bio/repo/data/studies/OSD-654), bone micro-CT (animals) | 62 source rows with reproducible summaries and missing-value accounting | Bone-research context in the searchable evidence browser |

**The rule itself, tested on real astronauts.** AstroBone's own personal-baseline and drift code, unchanged, was replayed on the four Inspiration4 crew members' raw blood results ([OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) and [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575), 27 clinical measures, each person against their own three pre-flight draws, review floor from the EFLM biological variation database). It found mean cell volume down in all four crew the day after landing (−3.4 to −5.2 %, all inside the lab's population range), recognised a one-draw glucose drop at R+45 as a sample-handling suspect, and 23 of its 31 flags were changes the population range would have missed. The same draws set the blood-sugar safety limit: the ADA's 70 mg/dL alert level, meant for people treated for diabetes, fired on 4 of 12 healthy pre-flight draws, so the app uses 54 mg/dL ([`scripts/replay-i4-glucose-limits.mjs`](scripts/replay-i4-glucose-limits.mjs)). Method and full results: [crew replay](docs/crew-replay.md) ([`src/crewReplay.js`](src/crewReplay.js)); the Self-Check shows it as a "Tested" card.

The data sets priority and timing only. It never sets a personal threshold: mice and a four-person, three-day flight cannot calibrate one astronaut. Raw files, reproducible summaries and rules: [NASA data pipeline](docs/nasa-data-pipeline.md).

## Try It in 3 Minutes

1. Open the [live app](https://mysunatislam.github.io/astrobone-space-apps-2026/). Mission Control shows Commander Elena Torres, a fictional astronaut on Day 147 of a Mars transit.
2. Select **My Health** for Elena's dashboard: every indicator on one screen, three body systems flagged, and the next step. Tap the knee extension tile for its chart.
3. Select **Self-Check**. The first step lists today's checks and the NASA evidence behind each. With **Elena · synthetic demo**, step through using the demo capture buttons: a poorly framed capture is refused and the repeat is accepted; then the reaction test, sleep and mood, and body. **Evaluate** shows which domains moved outside her own range and her next step; the twin highlights them.
4. Select **You · this device** to do the check yourself: the camera measures your knee extension, and the reaction test runs for 3 minutes.
5. Open **Live Capture** and start your camera or upload a video. The 3D musculoskeletal model follows your movement; joint angles and tracking quality update live. With a clearly visible, still face and steady light, the pulse appears after about 12 s; otherwise the app says what to change.
6. **Crewmate**, **Impact Lab**, **Physiology** and **Evidence** show the emergency check, the impact physics model, the cardiovascular and radiation context, and every NASA source with its hash.
7. Offline: after one visit, turn on airplane mode and reload. Everything still works.

## Validation and Limits

**Validated on real video** ([full report](docs/real-video-validation.md)), against laboratory ground truth, with fitted models always scored on people they were not trained on:

| What | Data | Result |
| --- | --- | --- |
| Knee range of motion | REHAB24-6: 9 people, squats and lunges, Vicon motion capture | MediaPipe's 3D angle under-read squat range of motion by about 30° facing the camera. AstroBone's hybrid knee model (MediaPipe + learned trees) cut the error per rep from 21.7° to 13.2° (ICC 0.549 → 0.769) and was better for 9 of 9 people it never saw |
| Knee repeat noise | Same data, consecutive reps | Side-on, ±5.8° (range of motion) and about ±4.4° (extension) with no change in the knee. The false-alarm simulation and the result screen use these measured figures ([section 5](docs/real-video-validation.md#5-repeat-noise-what-one-knee-check-can-tell)) |
| Camera pulse | MCD-rPPG: 40 people at rest and after squats, finger PPG | The old method refused 95 % of webcam windows. The hybrid was within 2.1 bpm on average (90 % of windows within 5 bpm, 96 % answered, quality gate off); as shipped, with its quality gate, 0.6 bpm on the 77 % of windows it answers. It tracked each person's rise from rest within 4.2 bpm |
| Camera pulse on three cameras | MCD-rPPG, 26 new people, front webcam, phone camera and side camera filmed at once, finger PPG | As shipped it answered 82 % of windows on the front webcam, 43 % on the phone and 36 % on the side camera, within 0.7 bpm when it answered. With the gate off it would have been 5.4 bpm off (9.44 on the phone): the gate refuses the bad windows ([November 2026](docs/validation-expansion-2026-11.md)) |
| Second knee lab | Zenodo 19720803: 19 people, 1080 squats, OptiTrack against smartphone keypoints | Side-on, the knee angle the app falls back on was 7.8° off per squat (repeat noise ±3.6°); facing the camera, 52.1°. Confirms why the check asks you to sit side-on |
| Live Capture heart-rate variability | The same 152 recordings, finger PPG RMSSD | Answered 5 of 152, about 47 ms off when it did, so the app no longer shows it |
| Camera pulse vs an alternative | Same 40 people | AstroBone's pulse 2.2 bpm vs 6.4 bpm for the colour-only VitalSense pulse from the author's NeuroBridge Asha app, so AstroBone's was kept ([section 3b](docs/real-video-validation.md#3b-astrobones-camera-pulse-vs-neurobridge-ashas-vitalsense-2026-11-02)) |
| Breathing from head movement | Same recordings | Lost to a fixed guess, so the app shows no camera breathing number; the crew counts breaths instead |

**Engineering checks**

- Claim audit: `node scripts/audit-claims.mjs` recomputes this README's headline numbers (NASA counts and statistics, the crew replay, report size, the false-alarm simulation, knee and pulse results) from the shipped code and data; every one reproduces, and a test keeps it so.
- 521 automated tests (`npm test`) cover the review rules, quality gates, NASA rules, pose analysis, the bone overlay's placement, video synchronization, camera pulse, respiratory engineering and reference comparison, the shared health record and the models. The Monte Carlo reproduces a stored Simulink reference.
- Reaction test timing: the stimulus onset is timed to the frame that draws it and the 3D view pauses during the test. A simulated 300 ms responder scores 300 ms; before, a software-rendered browser scored it 665 ms on average ([details](docs/core-analysis-2026-10-25.md#reaction-test-timing)).
- Camera position: each frame records whether the person faces the camera or sits side-on. Side-on, only the near knee counts; a part-turned capture is refused. Side-on readings were the most accurate on real video, so the self-check recommends sitting side-on ([why](docs/core-analysis-2026-10-25.md#camera-position)).
- An axe-core scan of every view at desktop and phone width finds no WCAG 2.1 A/AA violations (`scripts/qa-a11y.mjs`). Browser checks cover the health record and encryption, the guided demo and breathing capture (`scripts/qa-*.mjs`).

**Not yet validated, stated plainly**

- The seated knee-extension test itself has not been compared with a goniometer; the real-video check used squats and lunges. The Self-Check has a built-in **accuracy check** (camera vs goniometer, Bland–Altman bias, limits of agreement and detectable change); once 20+ pairs from 3+ people are recorded, the knee review trigger is raised to match the measured error. The [validation protocol](docs/functional-camera-validation-protocol.md) is written.
- Knee data come from healthy adults in two labs (9 people on video, 19 more as phone keypoints), and pulse data from healthy adults on Earth. Recorded phone and side-camera video has now been tested (accurate when it answers, but it answers less often); darker skin tones, moving subjects, dim light and a live phone next to a pulse oximeter still need their own tests.
- The breathing check is not validated against a reference belt (no open video dataset with a published belt signal was found).
- Bluetooth import is tested against the Bluetooth SIG packet formats, not yet with a real cuff, finger clip or thermometer.
- No astronaut or analog-crew user study has been run.
- Elena, the other three crew members and all their values are synthetic. The NASA cohorts are mice and a four-person, three-day flight; they inform what to watch, never a diagnosis or a personal threshold.
- AstroBone is a research prototype, not a medical device.

## Run Locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # 521 automated tests (node --test)
npm run build      # production build in dist/
```

Rebuild the NASA summaries from NASA's servers (Python 3.10+): `npm run data:osdr`, `npm run data:crew`, `npm run data:mission`, `npm run data:mission:extended`, `npm run data:dosimetry`, `npm run data:donki`, `npm run data:research:expansion`.

Rerun the real-video validation: see [`scripts/validation/README.md`](scripts/validation/README.md). The knee repeat-noise section needs no download: `node scripts/validation/knee-repeatability.mjs`.

## How It Is Built

- **Frontend:** JavaScript (ES modules), Vite, three.js / WebGL; a service worker for offline use.
- **On-device AI:** Google MediaPipe Pose Landmarker (WebAssembly + GPU) in a Web Worker; ME-rPPG camera pulse (ONNX Runtime Web); Silero VAD for speech pauses; EfficientDet-Lite0 object detection in Live Capture.
- **Anatomy:** Z-Anatomy / BodyParts3D musculoskeletal and cardiovascular models, rigged for movement.
- **Models:** personal-baseline review (2 × SD with a minimum change), CUSUM drift against a locked starting baseline (tuned by simulation, [results](docs/core-analysis-2026-10-25.md)), PVT-B reaction metrics, a hybrid knee model (100 gradient-boosted trees, [`src/kneeHybrid.js`](src/kneeHybrid.js)), Euler–Bernoulli bending stress and a seeded 10,000-run Monte Carlo for the Impact Lab.
- **Data:** Python scripts that download unrestricted NASA OSDR and DONKI files and record their hashes.
- **Privacy:** checks stay on the device and are saved only with consent; an optional passcode encrypts them with AES-256-GCM (Web Crypto, PBKDF2 key) for shared laptops ([details](docs/self-check.md#storage-and-privacy)).
- **Optional, off by default:** an Android app (Capacitor), and local services on the user's own computer for a whole-body mesh and a Llama 3.2 review assistant. See [Android](docs/android-app.md) and [local companion](docs/local-companion-architecture.md).

| Path | Contents |
| --- | --- |
| `index.html`, `src/twin*.js` | Digital twin (home page) |
| `src/selfCheck*.js`, `src/nasaWatch.js` | Daily self-check, review rules, NASA-informed checks |
| `lab.html`, `src/main.js`, `src/poseDetection.worker.js` | Live Capture and on-device pose tracking |
| `public/data/` | NASA summaries used by the app |
| `public/models/` | Anatomy models and the pose model |
| `scripts/` | NASA data builders, simulations and test tools |
| `scripts/validation/`, `data/validation/` | Real-video validation pipeline and results |
| `docs/` | Methods, validation protocols and data notes |

## Team

| Team member | Role |
| --- | --- |
| Mysunat Islam | Team lead, software developer (biomedical engineer) |
| Redwan Ahamed Tamim | Lead data analyst (industrial & production engineer) |
| Mashyiat Islam Borno | UI/UX designer, video editor |
| Sifat Bin Jibon | Developer |
| Hasibul Hasan Rahim | Developer |

## Project History

AstroBone is earlier open-source work by the team lead, published under the MIT license and extended for Space Apps 2026. The first digital twin page and Daily Self-Check date from October 3–4, 2026, before the hackathon weekend; the complete history is public in this repository's commits and pull requests. AI coding assistants were used throughout and are disclosed in [AI_USE_DISCLOSURE.md](AI_USE_DISCLOSURE.md).

## Credits and Licenses

- Code: [MIT](LICENSE), © 2026 Mysunat Islam.
- NASA OSDR / ALSDA data: public, CC0. NASA DONKI: public.
- Z-Anatomy / BodyParts3D: CC BY-SA 4.0. MediaPipe: Apache 2.0. three.js: MIT. ME-rPPG, Silero VAD, ONNX Runtime Web: MIT.
- Validation data: REHAB24-6 (Černek et al. 2024, CC BY-NC 4.0, so the fitted knee trees are for non-commercial use) and MCD-rPPG (Egorov et al. 2025, CC BY 4.0).
- Video music: "Inspired" by Kevin MacLeod ([incompetech.com](https://incompetech.com/)), licensed under [Creative Commons: By Attribution 4.0](http://creativecommons.org/licenses/by/4.0/).
- All third-party data, models and assets: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). AI tools used in development and in the app: [AI_USE_DISCLOSURE.md](AI_USE_DISCLOSURE.md).
