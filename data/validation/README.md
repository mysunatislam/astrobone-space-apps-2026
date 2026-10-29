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

Used by `scripts/validation/knee-repeatability.mjs` (docs/real-video-validation.md, section 5) and `src/realDataValidation.js` (the
Evidence view's "Tested on real data"). Each file keeps its dataset's attribution and licence terms.
