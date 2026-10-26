# Core Analysis Review, 2026-10-25

This is a review of how the Daily Self-Check measures, compares and flags, with the fixes made on branch `self-check-analysis-upgrade`. Every number below comes from code in this repository or a cited source. Nothing here is a clinical claim: AstroBone does not diagnose, and its review triggers are engineering defaults.

## What Was Wrong

| # | Flaw | Effect | Fix |
| --- | --- | --- | --- |
| 1 | Knee extension was the 95th percentile of **both knees pooled** | A loss in one knee was hidden by the other; asymmetry, a common sign of deconditioning or injury, was invisible | Each knee is summarized on its own. With both legs in view the **worse knee** is compared and **asymmetry** is recorded (`summarizeKneeCapture`) |
| 2 | A frame counted only if **both legs** were well tracked | Side-on capture, the standard view for knee goniometry, was rejected, and in a frontal view an occluded far leg could still feed the pooled value | Each side is gated on its own hip, knee and ankle visibility (`sideUsable`). Side-on measures the near knee. Bilateral and single-side results are separate protocols and are never compared |
| 3 | The only review rule used a **rolling baseline** (last 5 usable checks) | A slow decline, which is how bone and muscle are lost in flight, moves the baseline with it and is almost never flagged (see simulation) | Added a CUSUM drift rule against a **locked baseline** (the first 5 usable checks), alongside the day rule |
| 4 | The 5° knee trigger was **fixed**, and the accuracy check filtered frames on whole-body tracking | The trigger could sit below what the camera can resolve; holds of a well-tracked knee could be discarded because the other leg was hidden | Once the accuracy check has ≥ 20 pairs from ≥ 3 people, the trigger is raised to the measured MDC95 if larger (never lowered). Holds use the chosen knee's own tracking |

Range of motion now uses the 5th–95th percentile spread, which tracking jitter inflates far less than max − min. The live angle readout shows only knees the camera can see.

## Drift Detection

**Rule.** For each indicator, the first 5 usable checks of a protocol form a locked baseline (mean μ₀, SD s₀). Each later value x is standardized against it, z = (μ₀ − x) / σ for a measure where lower is worse, and a one-sided CUSUM accumulates S = max(0, S + z − k). A result is **REVIEW · gradual drift** when S ≥ h (Page, *Biometrika* 1954; Montgomery, *Introduction to Statistical Quality Control*).

- σ = max(s₀, floor / 2) × √(1 + 1/n). The floor term stops a suspiciously tight baseline from turning noise into alarms; the √(1 + 1/n) term widens σ for the error in a mean estimated from only n = 5 checks.
- Measures that can worsen both ways (resting heart rate) run two one-sided sums.
- An improvement never raises drift.

**Tuning.** `scripts/simulate-detection.mjs` runs 1,000 synthetic astronauts per scenario for 180 daily checks, true knee extension 170°, Gaussian measurement noise, onset on day 30. A flag is **confirmed** when it is still there on the 24 h re-check that the self-check asks for. The textbook k = 0.5, h = 4 gave confirmed false alarms in 18.8% of stable astronauts; k = 1, h = 6 was chosen as the best balance on the grid tried (k ∈ {0.5, 0.75, 1}, h ∈ {4, 6, 8}).

**Results, noise SD 2°, floor 5°** (`node scripts/simulate-detection.mjs --noise=2`)

| Scenario | Day rule alone: confirmed | Median days to confirm | Day + drift: confirmed | Median days to confirm |
| --- | --- | --- | --- | --- |
| Stable, no change (false alarm in 180 days) | 0.3% | n/a | 0.7% | n/a |
| Decline 2°/month | 0.4% | (too few) | 99.8% | 61 |
| Decline 4°/month | 1.0% | (too few) | 99.8% | 36 |
| Step drop of 8° | 26.0% | 1 | 99.8% | 3 |

**Results, noise SD 3°, floor raised to 8° as if calibrated** (`--noise=3 --floor=8`)

| Scenario | Day rule alone: confirmed | Day + drift: confirmed | Median days to confirm |
| --- | --- | --- | --- |
| Stable, no change | 0.0% | 0.3% | n/a |
| Decline 2°/month | 0.1% | 99.1% | 90 |
| Decline 4°/month | 0.2% | 99.9% | 52 |
| Step drop of 8° | 7.6% | 99.4% | 7 |

Two findings matter for the pitch:

1. The rolling rule alone almost never confirms a gradual decline, and it confirms a real 8° step drop only about a quarter of the time, because the dropped value enters the baseline before the 24 h re-check. The drift rule fixes both.
2. With 3° noise and the default 5° floor, confirmed false alarms rise to 10.7% (day rule) and 15.5% (with drift). Raising the floor to the measured MDC95 brings them back under 1%. That is why the accuracy study and the calibrated floor belong together.

**Limits.** The noise is Gaussian and independent from day to day. Real captures will have day effects (lighting, posture, clothing) that make noise larger and correlated, so these are best-case rates for the rule itself, not for the camera. The decline rates are synthetic; the real rate of change in knee extension during flight is not known.

## Why Knee Extension, and What It Is Not

- Bone mineral density falls about 1–1.5% per month at weight-bearing sites in flight (NASA Human Research Program Evidence Report on bone, 2017, NTRS 20170004597).
- After about 6 months on the ISS, knee extensor peak torque fell 5.8% and femoral neck BMD 1.7% in the NASA Sprint study (English et al., *npj Microgravity* 2020, s41526-020-00111-x). Lower-body muscle size, strength and VO₂peak fall about 10–15% (NASA HRP, 2024).
- **Knee range of motion is not muscle torque or bone density.** AstroBone tracks a movement indicator that the crew can measure daily without equipment, and prompts a re-check or medical review when it changes. It does not estimate strength or bone loss.

## Camera Accuracy, from the Literature

| Study | Comparison | Result |
| --- | --- | --- |
| Spadea et al., *Sensors* 2026, 26:2148 (n = 27) | MediaPipe vs IMU, knee | Extension MAE 2.3–3.1°, flexion MAE 3.2–4.1° |
| Latreche et al. (n = 25) | MediaPipe vs goniometer, knee | Extension limits of agreement −0.6° to 1.0°; flexion −0.98° to 1.78° |

No source found gives separate numbers for pure side-on and frontal views. The closest, Baldinger, Reimer & Senner (*Sensors* 2025, 25:799, n = 16, OpenPose 2D, front lunge), tested only 45° diagonal views: knee RMSE 15.5–29.4° and limits of agreement as wide as −51° to 62°, with back-diagonal views best. These results describe other setups; AstroBone's own accuracy check (camera vs goniometer, Bland–Altman) measures this device.

## Camera Position

AstroBone measures the knee from MediaPipe's 3D world landmarks, which keep the camera's axes, so the camera position decides which joint direction rests on the model's depth estimate, the axis a single camera is least sure of. Each frame now records the body's yaw relative to the camera from the hip and shoulder lines (`bodyYaw` in `src/functionalAssessment.js`): under 35° is facing, 60° or more is side-on.

**Simulation** (`node scripts/simulate-camera-view.mjs`, 20,000 runs per cell). Seated knee, thigh 0.45 m, shank 0.40 m. Each joint gets 1.5 cm Gaussian noise across the picture and k times that in depth. Knee-angle error in degrees, RMSE, bias (95th percentile of the absolute error):

| Depth noise | Knee angle | Facing the camera | Side-on |
| --- | --- | --- | --- |
| 1× | 150° | 4.9, −0.4 (9.5) | 4.9, −0.4 (9.6) |
| 1× | 170° | 4.8, −1.3 (9.2) | 4.7, −1.3 (9.1) |
| 2× | 150° | 5.6, −0.6 (10.8) | 5.2, −1.5 (10.3) |
| 2× | 170° | 4.9, −1.4 (9.4) | 6.6, −3.7 (13.2) |
| 3× | 150° | 6.8, −1.0 (13.3) | 6.6, −3.0 (13.1) |
| 3× | 170° | 5.2, −1.7 (10.3) | 10.2, −6.8 (21.0) |

Near full extension, which is what the self-check reports, side-on is worse whenever depth is noisier than the picture: the unsigned 3D angle can only shrink when a joint is pushed off the leg's plane, and side-on the depth axis points straight off that plane. Facing the camera, depth runs along the straightened leg and barely moves the angle. This is the opposite of the usual advice to film sagittal angles from the side, which holds for 2D angles measured in the image.

Three changes follow:

1. **Facing the camera is the recommended position for extension;** side-on stays allowed for one leg.
2. **Side-on, only the near knee counts.** The far leg is hidden behind the near one, but the model can still report it as visible; before, a guessed far knee could become the "worse knee" and raise a review.
3. **A part-turned capture (35–60°) is refused and repeated,** and the live readout tells the person to face the camera or turn fully side-on. With depth noise 2–3× the image noise, switching from facing to side-on reads 2–5° lower at 170°: a position change alone could look like a loss of extension. Results from different positions are never compared, and accuracy-check holds record the position so the study can report each one separately.

**Limits.** The noise model is independent per joint; MediaPipe's errors are correlated and shaped by learned body proportions. The depth-to-image noise ratio is an assumption, varied from 1× to 3×. The simulation shows which way the position matters and why, not this camera's error, which only the accuracy check can measure.

## Reaction Test Timing

The reaction test had two faults that made a slow device look like a tired astronaut.

1. **Stimulus drawn late.** The stimulus time was taken when the counter was set, but the screen shows it only on the next drawn frame, and the 3D twin kept rendering behind the test. Every frame of delay was added to the reaction time. Now the 3D view pauses for the test and the onset is the start of the frame that draws the stimulus.
2. **Wrong intervals.** The app waited 2–5 s between a response and the next stimulus; PVT-B uses 1–4 s including 1 s of reaction-time feedback (Basner, Mollicone & Dinges, *Acta Astronautica* 2011, 69:949–959, §2.2). Now it matches, and results also carry the paper's performance score (100 % minus lapses and false starts relative to valid stimuli plus false starts). The protocol id is now `pvt-b-3min-v2`, so older results are never compared with new ones.

**Measured** (`node scripts/qa-pvt-timing.mjs <url>`): a simulated person responds exactly 300 ms after the stimulus is drawn, during a 45 s practice run in a software-rendered browser (no GPU, the worst case for drawing delay).

| Build | Responses | Scored reaction time | Lapses (≥ 355 ms) | Mean wait for the stimulus to be drawn |
| --- | --- | --- | --- | --- |
| Before (main) | 9 | mean 665 ms, max 1,085 ms | 7 of 9 | 365 ms |
| After | 14 | 300 ms every time | 0 of 14 | 49 ms, now excluded from the score |

On a device with a GPU the drawing delay is far smaller (one frame is 17 ms at 60 fps), but it was still added to every response and grows on a weak laptop or phone. Basner notes the 355 ms threshold "may depend on PVT hardware": a phone's touch latency still adds to every response. AstroBone compares each person with their own baseline on the same device, which cancels a constant delay; the lapse count, an absolute threshold, does not cancel it.

## The Reaction Test and the Mission Context

- AstroBone's 3-minute reaction test is the **PVT-B** (Basner, Mollicone & Dinges, *Acta Astronautica* 2011). PVT-B is the test inside NASA's **Reaction Self Test**, used by 24 astronauts on 6-month ISS missions (University of Pennsylvania Unit for Experimental Psychiatry; NASA NTRS 20090029851).
- NASA's **Earth-Independent Medical Operations** work describes a Mars two-way communication delay of up to 40 minutes and calls for decision support that can "passively monitor the crew for early signs of behavioral or medical anomalies" (Levin et al., *IEEE Open Journal of Engineering in Medicine and Biology* 2023, PMC10810302). NASA-STD-3001 Level of Care 5 (missions over 210 days) is "autonomous advanced care".

## NASA Data Analysis

**What was wrong.** The NASA rules used group means or medians with no measure of spread, so a noisy number could drive a claim.

- The bone rule ranked skeletal sites by the single largest percent change. One femoral head measure read +756 %, which is meaningless: its ground-control values straddle zero (−7 to +5.6). The README also said "8.3 % in the spine" without noting that the spine change is indistinguishable from zero.
- The immune text compared post-flight values with the lowest pre-flight visit. It said white blood cells "fell from 8.5 to 6.25", but 6.25 lies inside the crew's own pre-flight range (5.95–8.5).
- The OSD-804 file fingerprint did not match the CSV in the repository: git stores it with LF line endings, while NASA serves CRLF.

**What it does now** (`scripts/build_osdr_summary.py`, reproducible byte for byte from `data/`):

| Per comparison (29) | Per site (5) |
| --- | --- |
| Flight and control SD; 95% bootstrap interval for the percent change; Hedges g with a 95% interval; Welch t-test; Benjamini–Hochberg q-value; the direction that means bone loss (Bouxsein et al., *J Bone Miner Res* 2010); percent marked unreliable when control values straddle zero | Loss score = mean loss-signed Hedges g; one-sided permutation test (20,000 seeded shuffles of whole animals, keeping the correlation between measures from the same bone); Holm correction across sites |

**Results (OSD-804, 37 days, female mice).**

| Site | Loss score | p (Holm) | Supported |
| --- | --- | --- | --- |
| Femoral head (hip) | 1.82 | 0.007 | Yes |
| Distal femur (above the knee) | 1.11 | 0.004 | Yes |
| Femoral neck | 0.71 | 0.19 | No |
| Femoral shaft (cortical) | 0.60 | 0.19 | No |
| Spine | 0.34 | 0.19 | No |

Bone volume fraction above the knee was −55 % (95% CI −68 to −30 %). All 10 measures with p < 0.05 point toward bone loss, but none survives correction for 29 tests on its own (4–10 mice per group), so the site-level test is the claim the app makes. The knee-first rule now rests on a corrected test rather than one large percent.

**Immune timing (OSD-656, 4 crew).** A post-flight value counts as raised only above every pre-flight visit median. VCAM1 stays raised through day 45 under that strict rule and under the median rule, so the 45-day checklist window does not depend on the choice. White blood cells are no longer cited as a change.

**Not changed.** The heart rule already concludes "no consistent effect" from OSD-435 group medians. The raw data needed for a dose-response test is not in the repository.

## Tests

- `summarizeKneeCapture`: bilateral (worse knee, asymmetry, protocol), side-only, insufficient.
- Drift: a slow decline inside the day tolerance is flagged as drift; ordinary noise is not; drift needs a locked baseline and ignores improvement.
- `calibratedFloors`: raises the floor only for ≥ 20 pairs from ≥ 3 people, never lowers it.
- Trend line (`sparklineSvg`): needs two values, plots history then today, escapes its label.
- NASA statistics: q ≥ p, intervals contain their estimates, percent intervals are dropped when unreliable, and site tests are Holm-consistent; the bone rule names the supported sites and says the spine is unclear; the immune window is the same under both baselines.
- Full suite: 288 tests pass. The Elena Day 147 result is unchanged.
