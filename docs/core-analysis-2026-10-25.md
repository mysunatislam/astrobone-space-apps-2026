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

No source found gives separate numbers for side-on and frontal views. These results describe other setups; AstroBone's own accuracy check (camera vs goniometer, Bland–Altman) measures this device.

## The Reaction Test and the Mission Context

- AstroBone's 3-minute reaction test is the **PVT-B** (Basner, Mollicone & Dinges, *Acta Astronautica* 2011). PVT-B is the test inside NASA's **Reaction Self Test**, used by 24 astronauts on 6-month ISS missions (University of Pennsylvania Unit for Experimental Psychiatry; NASA NTRS 20090029851).
- NASA's **Earth-Independent Medical Operations** work describes a Mars two-way communication delay of up to 40 minutes and calls for decision support that can "passively monitor the crew for early signs of behavioral or medical anomalies" (Levin et al., *IEEE Open Journal of Engineering in Medicine and Biology* 2023, PMC10810302). NASA-STD-3001 Level of Care 5 (missions over 210 days) is "autonomous advanced care".

## Tests

- `summarizeKneeCapture`: bilateral (worse knee, asymmetry, protocol), side-only, insufficient.
- Drift: a slow decline inside the day tolerance is flagged as drift; ordinary noise is not; drift needs a locked baseline and ignores improvement.
- `calibratedFloors`: raises the floor only for ≥ 20 pairs from ≥ 3 people, never lowers it.
- Trend line (`sparklineSvg`): needs two values, plots history then today, escapes its label.
- Full suite: 287 tests pass. The Elena Day 147 result is unchanged.
