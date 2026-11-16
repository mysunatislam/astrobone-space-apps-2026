# Saved real-video validation tables

Derived by `scripts/validation/` on 2026-10-26 from REHAB24-6 (Černek et al., 2024, https://doi.org/10.5281/zenodo.13305826,
CC BY-NC 4.0; the `rehab24-*` files) and MCD-rPPG (Egorov et al., 2025, https://huggingface.co/datasets/kyegorov/mcd_rppg, CC BY 4.0;
the `mcd-*` files). No video or raw joint file is included. Angles are knee interior angles in degrees (180° = straight).

| File | Rows | What |
|---|---|---|
| `rehab24-knee-reps.csv` | 928 | One row per repetition, camera and knee: camera position (`front` facing, `half` part-turned, `side` side-on), exercise (`Ex6` squat, `Ex5` lunge), range of motion from motion capture, from the app's old 3D angle and from the shipped hybrid. Rows keep the validation's order: repetitions grouped by video. No person or video column. |
| `rehab24-knee-methods.csv` | 42 | Per method and exercise/position: range-of-motion error, bias and ICC(2,1), extension error, number of rep-knee pairs. |
| `rehab24-knee-per-person.csv` | 9 | Range-of-motion error per person left out of training, per method. |
| `mcd-pulse-methods.csv` | 15 | Per pulse method: error, RMSE, r, share within 5 bpm, share of 30-second windows answered. |
| `mcd-pulse-gate-sweep.csv` | 90 | Error and windows answered at each quality gate, per method. |
| `mcd-pulse-rest-vs-squats.csv` | 40 | Per person: finger sensor and camera hybrid heart rate at rest and right after 15 squats (first 30-second window). |
| `rehab24-squat-video.csv` | 344 | One person's squat video (21 squats), every 6th frame: motion capture and hybrid angle for the facing camera (right knee) and the side-on camera (left knee). |

Added in November 2026 (`docs/validation-expansion-2026-11.md`, written by `scripts/validation/write_expansion_doc.py`):

| File | What |
|---|---|
| `sync21-knee-summary.csv` | Zenodo 19720803 (CC BY 4.0): per movement and camera position, range-of-motion and extension error, bias, repeat noise and MDC95 of the 2D knee angle against OptiTrack. |
| `sync21-knee-trials.csv` | Per trial and knee: alignment (frame rate, correlation), frame-level error. |
| `sync21-knee-reps.csv` | Per repetition and knee: extension and range of motion from motion capture and from the phone keypoints. |
| `mcd-scale-pulse.csv` | MCD-rPPG, new people, three cameras: answered share and error per camera, state and method (self-check estimator on 30 s windows, gate off, ME-rPPG alone, Live Capture at 0.3 and 0.4). |
| `mcd-scale-rest-vs-squats.csv` | Per camera: change from rest to after squats, camera against finger sensor. |
| `mcd-scale-hrv.csv` | Per recording: Live Capture's camera RMSSD or its refusal reason, finger-PPG RMSSD over the same 60 s, ECG RMSSD (separate 30 s strip). |
| `mcd-selfcheck-read.csv` | Same new people, clips cut like the self-check's camera minute (42 s after a 3 s settle): the earlier read (last 30 s, gate 0.3) and the shipped read (`SELF_CHECK_READ`, all 42 s, gate 0.25), plus the gate sweep, per camera and per half (choose / check / all). |
| `mcd-scale-summary.json` | Counts behind the Evidence view and the Live Capture panel. |

Used by `scripts/validation/knee-repeatability.mjs` (docs/real-video-validation.md, section 5) and `src/realDataValidation.js` (the
Evidence view's "Tested on real data"). Each file keeps its dataset's attribution and licence terms.
