# Daily Self-Check

Added 2026-10-04. Open the app (home page) and select **Self-Check**, or go straight to `/#selfcheck`. Code: `src/selfCheck.js` (model), `src/selfCheckPanel.js` (UI), `src/selfCheckCamera.js` (camera), `src/elenaSelfCheck.js` (synthetic demo history). Tests: `src/selfCheck.test.js`.

## Why It Exists

The 2026 challenge asks for software that **gathers health indicators** and **enables astronauts to evaluate and act** on their health, across immune changes, bone loss, cardiovascular events and behavioral health. The self-check is that loop. It takes about 6 minutes with the full 3-minute reaction test.

## Gather

| Domain | Indicator | How it is gathered | Source label |
| --- | --- | --- | --- |
| Safety | Chest pain, fainting, severe breathlessness, sudden neurological symptoms, thoughts of self-harm | Checklist, always first | Self-report |
| Bone & muscle | Knee extension (95th-percentile interior angle) and knee range of motion (5th–95th percentile spread) | 10-second seated knee extension on the device camera; MediaPipe pose with the Movement capture filter. Each knee is gated on its own hip, knee and ankle tracking. Facing the camera with both legs visible compares the worse knee and records asymmetry; sitting side-on measures the near knee. Bilateral and single-side results are separate protocols and are never compared with each other | Camera |
| Behavioral health | Reaction speed and lapses | PVT-B: 3 minutes, 1–4 s from a response to the next stimulus including 1 s of feedback, 355 ms lapse threshold, Basner performance score (Basner, Mollicone & Dinges, Acta Astronautica 2011, 69:949–959); stimulus onset timed to the frame that draws it, 3D view paused during the test; 1-minute practice is labeled and never compared with 3-minute runs; each result is stored with how it was answered (touch, mouse, pen or space bar) and the operating system and browser family, and compared only with tests answered the same way on the same kind of device | Test |
| Behavioral health | Sleep hours, fatigue, mood, stress | Sleep entry; Samn–Perelli 7-point fatigue checklist; 0–10 mood and stress ratings | Self-report |
| Immune | New fever or chills, respiratory symptoms, rash or cold sores, slow-healing wounds, unusual tiredness | Checklist | Self-report |
| Cardiovascular | Resting heart rate | Entered from a wearable, pulse oximeter or manual count, or measured from the face camera; the source is recorded | Device / self-report |
| Cardiovascular | Blood pressure (systolic, diastolic) | Typed from a cuff; up to two readings a minute apart are averaged; a reading without 5 minutes' seated rest fails quality and is repeated. An upper-arm and a wrist cuff are separate protocols: the AHA recommends an upper-arm cuff ("Wrist and finger monitors are not recommended. They give less reliable readings."), and a wrist cuff "often gives falsely high readings due to poor positioning" (Mayo Clinic). The same safety limits apply at the wrist, but the re-check asks for the wrist still, unbent and at heart level, or an upper-arm cuff. Readings saved before the cuff was asked count as upper arm | Device |
| Cardiovascular | Oxygen saturation | Typed from a finger clip | Device |
| Metabolic | Blood sugar | Typed from a finger-prick meter in mg/dL or mmol/L (stored as mg/dL); fasting and non-fasting are separate protocols | Device |
| Immune | Body temperature | Typed in °C or °F (stored as °C); each thermometer site (mouth, ear, forehead, armpit) is its own protocol | Device |
| Context | Cumulative personal dosimeter reading | Optional entry | Context only, never a health status |

Video never leaves the device; only summary angles are kept.

## Evaluate

- **Quality first.** A movement capture needs tracking quality ≥ 0.70 and ≥ 12 usable samples. A reaction test needs to be complete, with enough valid responses, ≤ 10 early taps and one way of answering for at least 90 % of responses. A failed result is shown as **REPEAT** and is not compared. A worse-looking number from a poor capture is never treated as a health change.
- **Same input, same device.** A touch screen, a mouse and a keyboard each add a delay to every reaction-test response, and so do the phone or laptop and the browser. NASA Ames filmed touches at 500 frames per second and found that an iPod Touch PVT reported reaction times "80+-20 milliseconds longer than our best estimate of the actual touch time", with the touch registered "an average of 70 milliseconds after the finger first makes contact" (Mulligan, Arsintescu and Flynn-Evans, NASA Technical Reports Server 20160000581). Their touch-screen NASA-PVT was slower than the PVT-192 on mean 1/RT in 10 people kept awake for 24 h (Arsintescu et al., Tenth International Conference on Managing Fatigue; NTRS 20170009855). For web apps, a solenoid pressing four devices measured mean overestimates from 57.6 ms (iOS Safari) to 132.9 ms (macOS Safari), with between-device variation larger than within-device variation (Pronk et al., Behavior Research Methods 2020;52:1371–1382, doi:10.3758/s13428-019-01321-2, Table 4). The timing mega-study concludes that studies "should aim always to make comparisons with a control condition on the same browser/computer ... so that these absolute lags are naturally removed" (Bridges et al., PeerJ 2020, doi:10.7717/peerj.9414). A 75 ms jump at a 300 ms reaction time moves speed from 3.3 to 2.7 per second, about four times the day-to-day spread the simulation assumes. The 355 ms PVT-B lapse threshold was set on PVT-192 hardware and "may depend on PVT hardware" (Basner et al. 2011), so AstroBone's lapse counts are not comparable with published norms, only with the same person's earlier tests. Each result is therefore stored with its input and the operating system and browser family, for example `pvt-b-3min-v2:touch:ios-safari` (only the family is kept, never a version or device model). A test that switches input for more than 10 % of its responses is a **REPEAT**, and a new input, device type or browser starts a new baseline. Results saved before this change keep the plain protocol and are compared only with each other. Two phones of the same family can still differ; the app cannot see that, so the instruction says to use the same device every day.
- **Personal baseline.** Each indicator is compared with the person's own last ≤ 5 usable results of the same protocol. Comparison starts after 3 usable checks; until then the status is **BASELINE**.
- **Usual range.** The mean of the person's last ≤ 5 usable results ± 2× their spread, or a minimum change (for example 5° knee extension, 8 bpm, 3 lapses, 1.5 h sleep), whichever is wider. Only the worsening direction counts. The spread is the SD of those 5 results until there are 10 usable results; from then on it is the moving-range SD of the last 30 (mean day-to-day difference / 1.128). An SD from 5 results is often far too tight by chance, and laboratory quality control sets its limits from 20 or more results (`SPREAD` in `src/selfCheck.js`).
- **Re-check, then review (multirule).** One result outside the usual range is **RE-CHECK**: measure it again at the next check; nothing is logged for review. It is **REVIEW** when it is far outside (more than 1.5× the range, about 3 SD) or when the previous usable check was also outside on the same side, judged against the range from before that check so a rolling range moving towards a real change cannot hide it. This is how laboratories run daily quality control (Westgard et al., Clin Chem 1981;27:493-501: one value past 2 SD warns, one past 3 SD or two in a row past 2 SD rejects). These are engineering defaults, **not clinical thresholds**.
- **Why the multirule: false alarms.** `scripts/simulate-false-alarms.mjs` runs the app's own evaluation on 1,000 simulated healthy astronauts who check all 14 indicators every day for 60 days. Each indicator's day-to-day spread is stated in the script, and the ones that matter most are measured or published:

  | Indicator | Day-to-day SD | Source |
  | --- | --- | --- |
  | Knee extension, range of motion | 4.4°, 5.8° | Camera repeat noise on real video against motion capture (`KNEE_REPEAT_NOISE`, [real-video validation, section 5](real-video-validation.md#5-repeat-noise-what-one-knee-check-can-tell)) |
  | Resting heart rate | 5.4 bpm | Ohasama study, one seated home reading each morning, 2,455 adults (Kikuya et al., Hypertension 2008;52:1045–1050, doi:10.1161/HYPERTENSIONAHA.107.104620); the middle cut-off of its Figure 1. Wearables read steadier, about 3 bpm (Quer et al., PLoS ONE 2020;15:e0227709) |
  | Blood pressure | 8.6 / 6.4 mmHg | Ohasama study, mean within-person SD of a single morning reading; the app averages two readings, so this is cautious |
  | Sleep | 85.8 min | Night-to-night SD of diary sleep duration, 8 studies, 2,404 people (Messman et al., J Sleep Res 2022;31:e13680, doi:10.1111/jsr.13680) |
  | Fasting blood sugar | 5.7 mg/dL | EFLM within-person CV 4.9 % plus about 4 % for a home meter |
  | Body temperature | 0.31 °C | SD of seven morning home oral readings over two weeks, 96 adults (Diamond et al., PLoS ONE 2021;16:e0245257, doi:10.1371/journal.pone.0245257; a correction notice, e0259428, could not be read here) |
  | Oxygen saturation | 0.8 points | Assumption; it fits the 1.2 % change needed to show a real change at rest in 10 healthy adults (Wagener and Hendricker, Chest 1987;92:1047–1049, doi:10.1378/chest.92.6.1047) |
  | Reaction test, ratings | 0.15 /s, Poisson lapses (mean 2), 0.8–1.2 points | Assumptions until measured on volunteers. The PVT-B validation (Basner et al., Acta Astronautica 2011;69:949–959) reports effect sizes of sleep loss but no within-person spread |

  These are studies of adults on Earth, not astronauts. Before they were looked up the script guessed 4 bpm, 6 / 4.5 mmHg, 0.9 h and 0.25 °C, and with those guesses the same rules said REVIEW on 4.9 % of checks (`--assumed-knee --previous-spreads`): the guesses made people look steadier than they are. With the published spreads and the original rule (one value beyond the 5-check range), someone who had not changed was told **REVIEW on 46.3 % of daily checks**. With the multirule, a 5-check spread and a drift baseline locked from 5 checks it was about 20 %. Taking the spread from up to 30 checks brought it to 15.9 %, and locking the drift baseline from 20 checks (below) to **12.2 %**. Of that, 2.4 % of checks cross a fixed safety limit, mostly blood pressure at 140 / 90, which a healthy person with this much day-to-day change does reach. A RE-CHECK prompt appears on 43.5 % of checks; it costs nothing, because the next daily check is the re-check. Real step changes added on day 31 are flagged REVIEW within three checks (original rule in brackets): knee extension −10° 64.5 % (83 %), systolic +20 mmHg 81 % (90.3 %), fasting blood sugar +20 mg/dL 75.5 % (91 %), 6 more attention lapses 95.8 % (97.8 %), 2 hours less sleep 23.5 % (54 %). Within 14 daily checks: 100 % for systolic, blood sugar and lapses, 99.5 % for the knee and **59 % for sleep**. A 10° knee drop is about 2.3 times the camera's repeat noise, and 2 h of sleep only 1.4 times ordinary night-to-night change, so a sleep loss mostly shows as a slow drift over weeks, not in a few nights. The result screen shows these numbers under **How often is this wrong?** (`SIMULATED_RELIABILITY` in `src/selfCheck.js`) and the measured noise beside each knee capture. Run with `--single` for the original rule; `src/falseAlarms.test.js` keeps the claims, and the numbers on screen, in step with the code.
- **Slow drift.** A rolling baseline follows a slow decline, which is how bone and muscle are lost in flight, so a steady loss never leaves it. Each indicator therefore also keeps a **locked baseline** (its first 20 usable checks, or all of them while there are fewer) and runs a one-sided CUSUM (Page, 1954) of worsening against it, with k = 1 SD and h = 6 SD. A result that crosses it is **REVIEW · gradual drift**. The CUSUM's SD is the larger of the locked checks' SD and the moving-range estimate over every usable check (mean day-to-day difference / 1.128, the individuals-chart estimate, which a slow drift barely moves), so lucky-tight first checks cannot set it. The baseline was locked from the first 5 checks until the published day-to-day spreads showed what that cost: its mean was off by enough that **17.4 %** of stable simulated astronauts got a drift alarm within 60 days. Locked from 20 checks, as laboratory quality control sets its limits from 20 or more results, it is **1.6 %**, and real changes are caught more often, because the start level is known better. In 1,000 simulated 180-day knee series with the measured camera noise (4.4°, `scripts/simulate-detection.mjs`), a decline of 2° a month from day 30 was confirmed (REVIEW on two checks in a row) in 92.9 % of runs, median 88 days after onset, against 14.9 % with the rolling rule alone; 4° a month in 93.2 % (median 51 days, 17.1 %). A 4°-a-month decline that starts on day 5, while the baseline is still being collected, is still confirmed in 99.2 % of runs (median 56 days). The cost of the measured noise is plain: over 180 days a stable knee got at least one REVIEW in 83.8 % of runs and two in a row in 19.9 %, so on a long mission a single knee REVIEW is common and is a prompt to look at the trend, not a finding. With the 2° noise assumed before it was measured, those were 11.1 % and 0.5 %.
- **Trigger tied to measured accuracy.** Once the camera accuracy check has at least 20 pairs from 3 or more people, the knee review trigger is raised to the measured detectable change (MDC95) if that is larger than 5°. It is never lowered.
- **Fixed safety limits** apply to the vital signs from the first reading, before any baseline exists, because a dangerous value is dangerous without one. **URGENT** (contact now) or **CONTACT TODAY** (tell the crew medical officer today):

  | Indicator | Urgent | Contact today | Source |
  | --- | --- | --- | --- |
  | Blood pressure | above 180 / 120 mmHg | 140 / 90 or higher; below 90 / 60 | AHA categories and low blood pressure |
  | Blood sugar | below 54 or above 240 mg/dL | 200 mg/dL or higher | ADA (clinically significant low; check ketones above 240; random-glucose threshold) |
  | Body temperature | 39.4 °C or higher; below 35 °C | 37.8 °C or higher by mouth; 37.2 °C or higher in the armpit; 38 °C or higher by ear or forehead | Mayo Clinic fever, fever first aid and hypothermia |
  | Oxygen saturation | 92 % or less | 93–94 % | NHS England pulse oximetry guidance |

  The ADA's 70 mg/dL alert level is for people treated for diabetes. Replayed on the real Inspiration4 crew glucose (OSD-575, 28 draws), it fired on 4 of 12 healthy pre-flight draws, so it is not used; with 54 mg/dL the limit fires only on the three R+45 draws that the crew replay already treats as a handling suspect, and the personal baseline flags the same three: one REVIEW and two RE-CHECK, single draws outside the usual range that were back to usual by R+82 (`scripts/replay-i4-glucose-limits.mjs`). Every limit action asks for a repeat first (5 minutes' rest for blood pressure, a fresh finger prick in 15 minutes for blood sugar) and points to the mission's own procedure, never a dose. A flight surgeon can set their own limits. The fever line follows the thermometer site (added 2026-10-29): an armpit reading runs lower, so before this an armpit fever of 37.2–37.7 °C was missed, and ear and forehead readings were held to the stricter oral line.
- **Red flags override everything** and make the check **URGENT**.

## Act

Actions are bounded: contact the crew medical officer now (red flags or an urgent limit), tell them today (a contact-today limit), repeat a failed measurement, re-check in 24 h and log for the flight surgeon, or keep building the baseline. AstroBone does not diagnose, prescribe exercise or recommend medication; a test enforces that wording. Selected actions are saved with due times. The full record exports as JSON for a reviewer.

### Report for Flight Surgeon

`src/surgeonReport.js`. **Report for flight surgeon** shows the same result as a short plain-text message, with Copy and Download .txt. It always has the same order so a reviewer can scan a whole crew quickly:
1. Who, when and where (with the one-way delay to Earth).
2. The overall status and any red flags.
3. **NEEDS A LOOK**: every non-stable measurement, worst first, with its reason (safety limit, usual range, outside once so measure again, steady drift, building baseline, or quality check failed).
4. One line of everything stable.
5. The advice shown to the astronaut, or the actions they selected once saved.
6. Quality and context (a repeated capture, the dosimeter).

For Elena on Day 147 it is 1.6 kB, 13 times smaller than the JSON record. It needs no app to read and fits a constrained link. Tests check the order, the size, that a failed capture reads as "not compared" and never as a decline, and that the wording never diagnoses or names a treatment.

### Where You Are: The Escalation Ladder

`src/missionEnvironment.js`. The astronaut picks where they are: space station (ISS), spacecraft (Orion, Earth-Moon transit), lunar base, rover, spacecraft (Earth-Mars transit) or Mars base. Each sets the gravity, the one-way message delay to Earth from light time (under 1 s for the ISS, 1.3 s for the Moon, 3–22 min for Mars), and how far definitive care is. The result shows a four-rung ladder, **self-care → logged for the flight surgeon → crew medical officer today → contact now**, with the active rung explained for that place. On the ISS the flight surgeon can join in real time and Earth is about a day away; on the way to Mars, advice from Earth arrives at least twice the delay later, so the crew decides first. The evaluation itself never changes with place; only who to tell and how.

### What Helps

`src/countermeasures.js`. Each domain has three short points on what supports it (for example, every scheduled resistance session for bone, fluid loading and standing up slowly before a return to gravity, a protected sleep window), each with its source: Smith et al. 2012, Moore et al. 2014, Lee et al. 2020, Hughson et al. 2016, Barger et al. 2014, Crucian et al. 2018 and NASA HRP evidence. The points open automatically for a domain that needs attention. A test rejects any medicine, dose or amount: the crew medical officer decides on treatment.

### Routine, Streak and Badges

`src/routine.js`. The first step shows the mission routine (blood sugar and temperature on waking, blood pressure and pulse after 5 minutes seated, the knee and reaction tests at the same time each day), when the next check is due (24 h after the last), the current and longest daily streak, and six badges: first check, baseline built, full check (every domain measured), quality first (repeated a measurement that failed its quality check instead of skipping it), 7-day and 30-day streaks. Badges reward doing the checks, never a health value, so nobody is nudged to report a better number. Elena's streak comes from an authored, synthetic adherence log.

### Over Time: Charts and Colour

`src/historyChart.js`. Under the results, **Over time** charts one measurement across every saved check plus today's. It opens on the most serious measured indicator; clicking any underlined indicator name in the results charts that one. Each point is re-evaluated against only the checks before it, so the chart shows the status it had on its own day (for Elena, knee extension was already **REVIEW** on Day 120). It draws the usual range that each check was judged against, the locked starting level used for drift, and the safety limits: a limit inside the scale is a labelled dashed line, and limits further away are named above or below the plot instead of squashing the data flat. A failed capture is shown as **REPEAT** and left off the line. **Show as a table** lists every point in words.

Colour is never the only cue. Every status has its own word and marker shape (● STABLE, ○ BASELINE, ✕ REPEAT, △ RE-CHECK, ▲ REVIEW, ◆ CONTACT TODAY, ■ URGENT), on each result row and in the chart. RE-CHECK shares REVIEW's amber on purpose, since both mean a possible change; its word and hollow marker tell them apart. `scripts/check-status-colours.mjs` simulates protanopia, deuteranopia and tritanopia (Machado et al. 2009) and measures how far apart each pair of status colours is (CIEDE2000). The old palette failed it: under deuteranopia, CONTACT TODAY (orange) and REVIEW were 3.9 apart, close to identical. CONTACT TODAY is now pink and BASELINE/REPEAT soft blue, which leaves no two result statuses closer than 10 for normal, protan or deutan vision. Every status colour has at least 7.5:1 text contrast on the panel (WCAG AA needs 4.5). The remaining close pair is URGENT and CONTACT TODAY under tritanopia (4.7), which is rare; both mean contact the crew medical officer, and their words and shapes differ. A test keeps the colours in `src/twin.css` in step with the ones the check measured.

### Body-Part Cards and NASA's Five Hazards

`src/bodyParts.js`, `src/hazards.js`. Clicking a structure on the 3D twin opens a card: what it does, how spaceflight affects it (cited), today's status from the latest self-check, and **Measure now**, which opens the matching self-check step. A test reads the scene's pickable structures, so a new one cannot be added without a card. Evidence maps NASA's five hazards (Space Radiation, Isolation and Confinement, Distance from Earth, Gravity Fields, Hostile/Closed Environments) to the indicators that watch for them; radiation is logged as context only, and distance sets the escalation ladder.

## Storage And Privacy

Checks stay in memory unless the astronaut ticks **Save my checks on this device**, which uses browser local storage on that device only. Nothing is sent to a server. Elena's demo records are never stored.

**Passcode (added 2026-10-29).** With saving on, **Add a passcode** encrypts the saved checks on the device, so another person using the same laptop or browser cannot read them (`src/sealedStore.js`, tests in `src/sealedStore.test.js`):

- The browser's Web Crypto turns the passcode (at least 8 characters) into a 256-bit AES-GCM key with PBKDF2-SHA256 and a random 16-byte salt, 600,000 iterations (the OWASP 2023 figure). Every save uses a fresh 12-byte IV. The passcode itself is never stored; the key stays in memory, non-extractable, until **Lock now** or the page closes.
- While locked, the page neither reads nor writes saved checks. The result step asks for the passcode instead of judging today against an empty history, and nothing can overwrite the sealed copy in plain text.
- A wrong passcode, or an edited file, fails AES-GCM's check and is refused. A forgotten passcode cannot be recovered: the only way on is **Forgot it? Delete saved checks**.
- Not covered: the consent setting, the accuracy-check pairs, and files the astronaut downloads (backup, reviewer export, surgeon report) stay unencrypted. Someone who copies the browser's storage can still try passcodes offline, slowed by the 600,000 iterations, so a longer passcode is stronger. This protects against casual reading on a shared device, not against a determined attacker.

## Demo Profile

**Elena · synthetic demo** reuses the knee and heart-rate checkpoint values from `elenaMissionScenario.js` and adds authored sleep, fatigue, mood, stress, reaction-test and vital-sign values for Days 1–120 and Day 147. The vital signs follow the direction of published findings, not their size for any one person: blood pressure a little lower in flight (Norsk et al. 2015), fasting blood sugar creeping up (Hughson et al. 2016), resting temperature rising (Stahn et al. 2017); all stay inside the safety limits and her usual range on Day 147. In the demo, the first movement capture fails its quality gate and is withheld; the repeat is usable. The Day 147 evaluation flags bone & muscle and behavioral health for review, asks her to re-check resting heart rate and sleep (each just outside her usual range, once), and keeps immune stable. None of these values come from a real person.

## Verified

- 10 unit tests: PVT-B scoring, protocol separation, baseline readiness, direction and floor rules, red-flag priority, immune symptoms, bounded wording, Elena's Day 147 result, poor-capture refusal, consent-gated storage.
- Browser: the full Elena flow, the reaction test with simulated taps (0 false starts, correct latency), and the camera path loading the pose model and detecting a person at 0.97 tracking quality from the project's squat test video.
- Browser (2026-10-28, desktop 1440 px and phone 390 px): the Over time chart opens on knee extension with six points and a REVIEW/BASELINE/STABLE legend; clicking systolic blood pressure charts it with the off-scale limits named; typing 150 mmHg draws the 140 mmHg line and labels today CONTACT TODAY in the tested pink; every result row shows a status word; no console errors.
- Browser (2026-10-28, both widths): Report for flight surgeon opens with the header, NEEDS A LOOK list and the repeated capture; Copy puts it on the clipboard; Download saves a .txt; after saving it lists the selected actions. axe-core 4.10 found no WCAG 2.1 A/AA violations on the six self-check steps or the body-part card (colour contrast on gradient panels is checked separately by `scripts/check-status-colours.mjs`).

## Accuracy Check (Camera vs Goniometer)

Added 2026-10-18 in the Movement step for **You · this device** (`src/angleCheck.js`, tests in `src/angleCheck.test.js`). A tester holds one knee still, reads it with a goniometer or phone inclinometer (knee flexion, 0° = straight) and captures a 3-second camera hold of the same knee. A hold is paired only if at least 10 frames tracked that knee and its angle varied by no more than 3° SD. From the pairs the panel shows Bland-Altman bias with 95% limits of agreement, mean absolute difference, and a conservative minimal detectable change (1.96 × √2 × SD of differences) compared with the 5° review trigger. Pairs stay in memory unless saving on this device is ticked, and export as CSV. Results describe that camera, lighting and setup only. Each hold also records the camera position (facing, side-on, from the body's yaw), exported as `camera_view` and `body_yaw_deg`, so accuracy can be reported for each position. The study procedure is in `space-apps-2026-win-plan.md`; why position matters is in [core analysis](core-analysis-2026-10-25.md#camera-position).

## Offline

The service worker (`public/sw.js`) installs the offline pack on the first online visit, with nothing to press. It starts once the page has what it needs (the twin's 3D anatomy, or Live Capture's rigged model) and the browser is idle, then reuses those downloads, so the pack never competes with the first view (`registerOffline` in `src/offline.js`). The pack holds:
- both pages (the twin and Live Capture) and their bundles;
- the anatomy models;
- the pose, face and camera-pulse models and the one MediaPipe runtime the vision workers load (the module build; the other two builds in `public/mediapipe` are never requested);
- every NASA data file, including the Inspiration4 crew blood data behind the "tested on real crew" card.

That is 31 files, 50 MB measured in Chromium (35 files and 73 MB before the unused runtimes were dropped). Three optional Live Capture extras load on demand and are cached once used: the hand and object models and the clothed body (26 MB). `src/offlinePack.test.js` checks that every file in `public/data` is in the pack, that every listed file exists, and that the page and the service worker use the same cache name. Before 2026-10-28 the crew data was missing from the pack, and the page looked in an old cache name.

First load on a phone link, measured 2026-10-28 on the Pages build through a server limited to 9 Mbit/s with a 60 ms round trip (`scripts/throttled-server.mjs` and `scripts/qa-first-load.mjs`), two runs each, 390 px phone view:

| Build | 3D twin ready | Offline pack complete |
| --- | --- | --- |
| Before: pack installs at once | 61 s | 80 s, 73 MB |
| After: pack waits for the twin | 14 s | 60 s, 50 MB |
| Either build, service worker blocked | 14 s | none |

The self-check itself appeared after 1.4 s in every run. The test also checks that every vision worker asks for the module build, so the pack cannot silently miss the runtime the camera uses.

Verified 2026-10-28 on the same build GitHub Pages deploys, served under `/astrobone-space-apps-2026/`, at laptop (1366 px) and phone (390 px) sizes. After one online visit, with the network off, the self-check ran the whole Elena demo with no script errors: the chart, the flight surgeon report, saving with the streak, and the body-part card.

## Not Yet Verified

- A complete live 10-second capture on a physical webcam, and the self-check's agreement with a goniometer.
- Usability with astronaut-like users (time to complete, comprehension of the result).
- Reaction-test timing on touch devices (browser timing adds about one display frame).
