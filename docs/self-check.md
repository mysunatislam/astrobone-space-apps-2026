# Daily Self-Check

Added 2026-10-04. Open the app (home page) and select **Self-Check**, or go straight to `/#selfcheck`. Code: `src/selfCheck.js` (model), `src/selfCheckPanel.js` (UI), `src/selfCheckCamera.js` (camera), `src/elenaSelfCheck.js` (synthetic demo history). Tests: `src/selfCheck.test.js`.

## Why It Exists

The 2026 challenge asks for software that **gathers health indicators** and **enables astronauts to evaluate and act** on their health, across immune changes, bone loss, cardiovascular events and behavioral health. The self-check is that loop. It takes about 6 minutes with the full 3-minute reaction test.

## Gather

| Domain | Indicator | How it is gathered | Source label |
| --- | --- | --- | --- |
| Safety | Chest pain, fainting, severe breathlessness, sudden neurological symptoms, thoughts of self-harm | Checklist, always first | Self-report |
| Bone & muscle | Knee extension (95th-percentile interior angle) and knee range of motion (5th–95th percentile spread) | 10-second seated knee extension on the device camera; MediaPipe pose with the Movement capture filter. Each knee is gated on its own hip, knee and ankle tracking. Facing the camera with both legs visible compares the worse knee and records asymmetry; sitting side-on measures the near knee. Bilateral and single-side results are separate protocols and are never compared with each other | Camera |
| Behavioral health | Reaction speed and lapses | PVT-B: 3 minutes, 1–4 s from a response to the next stimulus including 1 s of feedback, 355 ms lapse threshold, Basner performance score (Basner, Mollicone & Dinges, Acta Astronautica 2011, 69:949–959); stimulus onset timed to the frame that draws it, 3D view paused during the test; 1-minute practice is labeled and never compared with 3-minute runs | Test |
| Behavioral health | Sleep hours, fatigue, mood, stress | Sleep entry; Samn–Perelli 7-point fatigue checklist; 0–10 mood and stress ratings | Self-report |
| Immune | New fever or chills, respiratory symptoms, rash or cold sores, slow-healing wounds, unusual tiredness | Checklist | Self-report |
| Cardiovascular | Resting heart rate | Entered from a wearable, pulse oximeter or manual count, or measured from the face camera; the source is recorded | Device / self-report |
| Cardiovascular | Blood pressure (systolic, diastolic) | Typed from a cuff; up to two readings a minute apart are averaged; a reading without 5 minutes' seated rest fails quality and is repeated | Device |
| Cardiovascular | Oxygen saturation | Typed from a finger clip | Device |
| Metabolic | Blood sugar | Typed from a finger-prick meter in mg/dL or mmol/L (stored as mg/dL); fasting and non-fasting are separate protocols | Device |
| Immune | Body temperature | Typed in °C or °F (stored as °C); each thermometer site (mouth, ear, forehead, armpit) is its own protocol | Device |
| Context | Cumulative personal dosimeter reading | Optional entry | Context only, never a health status |

Video never leaves the device; only summary angles are kept.

## Evaluate

- **Quality first.** A movement capture needs tracking quality ≥ 0.70 and ≥ 12 usable samples. A reaction test needs to be complete, with enough valid responses and ≤ 10 early taps. A failed result is shown as **REPEAT** and is not compared. A worse-looking number from a poor capture is never treated as a health change.
- **Personal baseline.** Each indicator is compared with the person's own last ≤ 5 usable results of the same protocol. Comparison starts after 3 usable checks; until then the status is **BASELINE**.
- **Review trigger.** A result is **REVIEW** when it moves in the worsening direction by more than 2× the person's own spread, or by a minimum change (for example 5° knee extension, 8 bpm, 3 lapses, 1.5 h sleep), whichever is larger. These are engineering defaults for prompting a re-check, **not clinical thresholds**.
- **Slow drift.** A rolling baseline follows a slow decline, which is how bone and muscle are lost in flight, so a steady loss never leaves it. Each indicator therefore also keeps a **locked baseline** (its first 5 usable checks) and runs a one-sided CUSUM (Page, 1954) of worsening against it, with k = 1 SD and h = 6 SD. A result that crosses it is **REVIEW · gradual drift**. In a 1,000-run simulation with 2° daily noise, a 4°/month knee-extension decline was confirmed on two consecutive checks in 99.8% of runs (median 36 days after onset) versus 1.0% with the rolling rule alone, for 0.7% versus 0.3% confirmed false alarms in stable runs over 180 days. See `core-analysis-2026-10-25.md`.
- **Trigger tied to measured accuracy.** Once the camera accuracy check has at least 20 pairs from 3 or more people, the knee review trigger is raised to the measured detectable change (MDC95) if that is larger than 5°. It is never lowered.
- **Fixed safety limits** apply to the vital signs from the first reading, before any baseline exists, because a dangerous value is dangerous without one. **URGENT** (contact now) or **CONTACT TODAY** (tell the crew medical officer today):

  | Indicator | Urgent | Contact today | Source |
  | --- | --- | --- | --- |
  | Blood pressure | above 180 / 120 mmHg | 140 / 90 or higher; below 90 / 60 | AHA categories and low blood pressure |
  | Blood sugar | below 54 or above 240 mg/dL | 200 mg/dL or higher | ADA (clinically significant low; check ketones above 240; random-glucose threshold) |
  | Body temperature | 39.4 °C or higher; below 35 °C | 37.8 °C or higher | Mayo Clinic fever and hypothermia |
  | Oxygen saturation | 92 % or less | 93–94 % | NHS England pulse oximetry guidance |

  The ADA's 70 mg/dL alert level is for people treated for diabetes. Replayed on the real Inspiration4 crew glucose (OSD-575, 28 draws), it fired on 4 of 12 healthy pre-flight draws, so it is not used; with 54 mg/dL the limit fires only on the three R+45 draws that the crew replay already treats as a handling suspect, and the personal baseline flags the same three (`scripts/replay-i4-glucose-limits.mjs`). Every limit action asks for a repeat first (5 minutes' rest for blood pressure, a fresh finger prick in 15 minutes for blood sugar) and points to the mission's own procedure, never a dose. A flight surgeon can set their own limits.
- **Red flags override everything** and make the check **URGENT**.

## Act

Actions are bounded: contact the crew medical officer now (red flags or an urgent limit), tell them today (a contact-today limit), repeat a failed measurement, re-check in 24 h and log for the flight surgeon, or keep building the baseline. AstroBone does not diagnose, prescribe exercise or recommend medication; a test enforces that wording. Selected actions are saved with due times. The full record exports as JSON for a reviewer.

### Where You Are: The Escalation Ladder

`src/missionEnvironment.js`. The astronaut picks where they are: space station (ISS), spacecraft (Orion, Earth-Moon transit), lunar base, rover, spacecraft (Earth-Mars transit) or Mars base. Each sets the gravity, the one-way message delay to Earth from light time (under 1 s for the ISS, 1.3 s for the Moon, 3–22 min for Mars), and how far definitive care is. The result shows a four-rung ladder, **self-care → logged for the flight surgeon → crew medical officer today → contact now**, with the active rung explained for that place. On the ISS the flight surgeon can join in real time and Earth is about a day away; on the way to Mars, advice from Earth arrives at least twice the delay later, so the crew decides first. The evaluation itself never changes with place; only who to tell and how.

### What Helps

`src/countermeasures.js`. Each domain has three short points on what supports it (for example, every scheduled resistance session for bone, fluid loading and standing up slowly before a return to gravity, a protected sleep window), each with its source: Smith et al. 2012, Moore et al. 2014, Lee et al. 2020, Hughson et al. 2016, Barger et al. 2014, Crucian et al. 2018 and NASA HRP evidence. The points open automatically for a domain that needs attention. A test rejects any medicine, dose or amount: the crew medical officer decides on treatment.

### Routine, Streak and Badges

`src/routine.js`. The first step shows the mission routine (blood sugar and temperature on waking, blood pressure and pulse after 5 minutes seated, the knee and reaction tests at the same time each day), when the next check is due (24 h after the last), the current and longest daily streak, and six badges: first check, baseline built, full check (every domain measured), quality first (repeated a measurement that failed its quality check instead of skipping it), 7-day and 30-day streaks. Badges reward doing the checks, never a health value, so nobody is nudged to report a better number. Elena's streak comes from an authored, synthetic adherence log.

### Over Time: Charts and Colour

`src/historyChart.js`. Under the results, **Over time** charts one measurement across every saved check plus today's. It opens on the most serious measured indicator; clicking any underlined indicator name in the results charts that one. Each point is re-evaluated against only the checks before it, so the chart shows the status it had on its own day (for Elena, knee extension was already **REVIEW** on Day 120). It draws the usual range that each check was judged against, the locked starting level used for drift, and the safety limits: a limit inside the scale is a labelled dashed line, and limits further away are named above or below the plot instead of squashing the data flat. A failed capture is shown as **REPEAT** and left off the line. **Show as a table** lists every point in words.

Colour is never the only cue. Every status has its own word and marker shape (● STABLE, ○ BASELINE, ✕ REPEAT, ▲ REVIEW, ◆ CONTACT TODAY, ■ URGENT), on each result row and in the chart. `scripts/check-status-colours.mjs` simulates protanopia, deuteranopia and tritanopia (Machado et al. 2009) and measures how far apart each pair of status colours is (CIEDE2000). The old palette failed it: under deuteranopia, CONTACT TODAY (orange) and REVIEW were 3.9 apart, close to identical. CONTACT TODAY is now pink and BASELINE/REPEAT soft blue, which leaves no two result statuses closer than 10 for normal, protan or deutan vision. Every status colour has at least 7.5:1 text contrast on the panel (WCAG AA needs 4.5). The remaining close pair is URGENT and CONTACT TODAY under tritanopia (4.7), which is rare; both mean contact the crew medical officer, and their words and shapes differ. A test keeps the colours in `src/twin.css` in step with the ones the check measured.

### Body-Part Cards and NASA's Five Hazards

`src/bodyParts.js`, `src/hazards.js`. Clicking a structure on the 3D twin opens a card: what it does, how spaceflight affects it (cited), today's status from the latest self-check, and **Measure now**, which opens the matching self-check step. A test reads the scene's pickable structures, so a new one cannot be added without a card. Evidence maps NASA's five hazards (Space Radiation, Isolation and Confinement, Distance from Earth, Gravity Fields, Hostile/Closed Environments) to the indicators that watch for them; radiation is logged as context only, and distance sets the escalation ladder.

## Storage And Privacy

Checks stay in memory unless the astronaut ticks **Save my checks on this device**, which uses browser local storage on that device only. Nothing is sent to a server. Elena's demo records are never stored.

## Demo Profile

**Elena · synthetic demo** reuses the knee and heart-rate checkpoint values from `elenaMissionScenario.js` and adds authored sleep, fatigue, mood, stress, reaction-test and vital-sign values for Days 1–120 and Day 147. The vital signs follow the direction of published findings, not their size for any one person: blood pressure a little lower in flight (Norsk et al. 2015), fasting blood sugar creeping up (Hughson et al. 2016), resting temperature rising (Stahn et al. 2017); all stay inside the safety limits and her usual range on Day 147. In the demo, the first movement capture fails its quality gate and is withheld; the repeat is usable. The Day 147 evaluation flags bone & muscle, cardiovascular and behavioral health for review and keeps immune stable. None of these values come from a real person.

## Verified

- 10 unit tests: PVT-B scoring, protocol separation, baseline readiness, direction and floor rules, red-flag priority, immune symptoms, bounded wording, Elena's Day 147 result, poor-capture refusal, consent-gated storage.
- Browser: the full Elena flow, the reaction test with simulated taps (0 false starts, correct latency), and the camera path loading the pose model and detecting a person at 0.97 tracking quality from the project's squat test video.
- Browser (2026-10-28, desktop 1440 px and phone 390 px): the Over time chart opens on knee extension with six points and a REVIEW/BASELINE/STABLE legend; clicking systolic blood pressure charts it with the off-scale limits named; typing 150 mmHg draws the 140 mmHg line and labels today CONTACT TODAY in the tested pink; every result row shows a status word; no console errors.

## Accuracy Check (Camera vs Goniometer)

Added 2026-10-18 in the Movement step for **You · this device** (`src/angleCheck.js`, tests in `src/angleCheck.test.js`). A tester holds one knee still, reads it with a goniometer or phone inclinometer (knee flexion, 0° = straight) and captures a 3-second camera hold of the same knee. A hold is paired only if at least 10 frames tracked that knee and its angle varied by no more than 3° SD. From the pairs the panel shows Bland-Altman bias with 95% limits of agreement, mean absolute difference, and a conservative minimal detectable change (1.96 × √2 × SD of differences) compared with the 5° review trigger. Pairs stay in memory unless saving on this device is ticked, and export as CSV. Results describe that camera, lighting and setup only. Each hold also records the camera position (facing, side-on, from the body's yaw), exported as `camera_view` and `body_yaw_deg`, so accuracy can be reported for each position. The study procedure is in `space-apps-2026-win-plan.md`; why position matters is in [core analysis](core-analysis-2026-10-25.md#camera-position).

## Offline

`npm run build` and `npm run build:github` generate `sw.js` and `offline-manifest.json` (`scripts/write-offline-cache.mjs`). **Save for offline** in the twin's systems rail stores the twin, self-check, anatomy, pose model and data (about 35 MB). Verified in Chromium: after saving, a reload with the network off renders the twin and starts the camera pose model.

## Not Yet Verified

- A complete live 10-second capture on a physical webcam, and the self-check's agreement with a goniometer.
- Usability with astronaut-like users (time to complete, comprehension of the result).
- Reaction-test timing on touch devices (browser timing adds about one display frame).
