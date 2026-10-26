# Daily Self-Check

Added 2026-10-04. Open the app (home page) and select **Self-Check**, or go straight to `/#selfcheck`. Code: `src/selfCheck.js` (model), `src/selfCheckPanel.js` (UI), `src/selfCheckCamera.js` (camera), `src/elenaSelfCheck.js` (synthetic demo history). Tests: `src/selfCheck.test.js`.

## Why It Exists

The 2026 challenge asks for software that **gathers health indicators** and **enables astronauts to evaluate and act** on their health, across immune changes, bone loss, cardiovascular events and behavioral health. The self-check is that loop. It takes about 6 minutes with the full 3-minute reaction test.

## Gather

| Domain | Indicator | How it is gathered | Source label |
| --- | --- | --- | --- |
| Safety | Chest pain, fainting, severe breathlessness, sudden neurological symptoms, thoughts of self-harm | Checklist, always first | Self-report |
| Bone & muscle | Knee extension (95th-percentile interior angle) and knee range of motion (5th–95th percentile spread) | 10-second seated knee extension on the device camera; MediaPipe pose with the Movement capture filter. Each knee is gated on its own hip, knee and ankle tracking. Facing the camera with both legs visible compares the worse knee and records asymmetry; sitting side-on measures the near knee. Bilateral and single-side results are separate protocols and are never compared with each other | Camera |
| Behavioral health | Reaction speed and lapses | PVT-B: 3 minutes, 2–5 s intervals, 355 ms lapse threshold (Basner, Mollicone & Dinges, Acta Astronautica 2011); 1-minute practice is labeled and never compared with 3-minute runs | Test |
| Behavioral health | Sleep hours, fatigue, mood, stress | Sleep entry; Samn–Perelli 7-point fatigue checklist; 0–10 mood and stress ratings | Self-report |
| Immune | New fever or chills, respiratory symptoms, rash or cold sores, slow-healing wounds, unusual tiredness | Checklist | Self-report |
| Cardiovascular | Resting heart rate | Entered from a wearable, pulse oximeter or manual count; the source is recorded | Device / self-report |
| Context | Cumulative personal dosimeter reading | Optional entry | Context only, never a health status |

Video never leaves the device; only summary angles are kept.

## Evaluate

- **Quality first.** A movement capture needs tracking quality ≥ 0.70 and ≥ 12 usable samples. A reaction test needs to be complete, with enough valid responses and ≤ 10 early taps. A failed result is shown as **REPEAT** and is not compared. A worse-looking number from a poor capture is never treated as a health change.
- **Personal baseline.** Each indicator is compared with the person's own last ≤ 5 usable results of the same protocol. Comparison starts after 3 usable checks; until then the status is **BASELINE**.
- **Review trigger.** A result is **REVIEW** when it moves in the worsening direction by more than 2× the person's own spread, or by a minimum change (for example 5° knee extension, 8 bpm, 3 lapses, 1.5 h sleep), whichever is larger. These are engineering defaults for prompting a re-check, **not clinical thresholds**.
- **Slow drift.** A rolling baseline follows a slow decline, which is how bone and muscle are lost in flight, so a steady loss never leaves it. Each indicator therefore also keeps a **locked baseline** (its first 5 usable checks) and runs a one-sided CUSUM (Page, 1954) of worsening against it, with k = 1 SD and h = 6 SD. A result that crosses it is **REVIEW · gradual drift**. In a 1,000-run simulation with 2° daily noise, a 4°/month knee-extension decline was confirmed on two consecutive checks in 99.8% of runs (median 36 days after onset) versus 1.0% with the rolling rule alone, for 0.7% versus 0.3% confirmed false alarms in stable runs over 180 days. See `core-analysis-2026-10-25.md`.
- **Trigger tied to measured accuracy.** Once the camera accuracy check has at least 20 pairs from 3 or more people, the knee review trigger is raised to the measured detectable change (MDC95) if that is larger than 5°. It is never lowered.
- **Red flags override everything** and make the check **URGENT**.

## Act

Actions are bounded: contact the crew medical officer now (red flags), repeat a failed measurement, re-check in 24 h and log for medical review at the next communication window, or keep building the baseline. AstroBone does not diagnose, prescribe exercise or recommend medication; a test enforces that wording. Selected actions are saved with due times. The full record exports as JSON for a reviewer.

## Storage And Privacy

Checks stay in memory unless the astronaut ticks **Save my checks on this device**, which uses browser local storage on that device only. Nothing is sent to a server. Elena's demo records are never stored.

## Demo Profile

**Elena · synthetic demo** reuses the knee and heart-rate checkpoint values from `elenaMissionScenario.js` and adds authored sleep, fatigue, mood, stress and reaction-test values for Days 1–120 and Day 147. In the demo, the first movement capture fails its quality gate and is withheld; the repeat is usable. The Day 147 evaluation flags bone & muscle, cardiovascular and behavioral health for review and keeps immune stable. None of these values come from a real person.

## Verified

- 10 unit tests: PVT-B scoring, protocol separation, baseline readiness, direction and floor rules, red-flag priority, immune symptoms, bounded wording, Elena's Day 147 result, poor-capture refusal, consent-gated storage.
- Browser: the full Elena flow, the reaction test with simulated taps (0 false starts, correct latency), and the camera path loading the pose model and detecting a person at 0.97 tracking quality from the project's squat test video.

## Accuracy Check (Camera vs Goniometer)

Added 2026-10-18 in the Movement step for **You · this device** (`src/angleCheck.js`, tests in `src/angleCheck.test.js`). A tester holds one knee still, reads it with a goniometer or phone inclinometer (knee flexion, 0° = straight) and captures a 3-second camera hold of the same knee. A hold is paired only if at least 10 frames tracked that knee and its angle varied by no more than 3° SD. From the pairs the panel shows Bland-Altman bias with 95% limits of agreement, mean absolute difference, and a conservative minimal detectable change (1.96 × √2 × SD of differences) compared with the 5° review trigger. Pairs stay in memory unless saving on this device is ticked, and export as CSV. Results describe that camera, lighting and setup only. Each hold also records the camera position (facing, side-on, from the body's yaw), exported as `camera_view` and `body_yaw_deg`, so accuracy can be reported for each position. The study procedure is in `space-apps-2026-win-plan.md`; why position matters is in [core analysis](core-analysis-2026-10-25.md#camera-position).

## Offline

`npm run build` and `npm run build:github` generate `sw.js` and `offline-manifest.json` (`scripts/write-offline-cache.mjs`). **Save for offline** in the twin's systems rail stores the twin, self-check, anatomy, pose model and data (about 35 MB). Verified in Chromium: after saving, a reload with the network off renders the twin and starts the camera pose model.

## Not Yet Verified

- A complete live 10-second capture on a physical webcam, and the self-check's agreement with a goniometer.
- Usability with astronaut-like users (time to complete, comprehension of the result).
- Reaction-test timing on touch devices (browser timing adds about one display frame).
