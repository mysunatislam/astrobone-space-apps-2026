# Saved real-video validation tables

Derived from REHAB24-6 (Černek et al., 2024, https://doi.org/10.5281/zenodo.13305826, CC BY-NC 4.0) by `scripts/validation/` on
2026-10-26. No video or raw joint file is included. Angles are knee interior angles in degrees (180° = straight).

| File | Rows | What |
|---|---|---|
| `rehab24-knee-reps.csv` | 928 | One row per repetition, camera and knee: camera position (`front` facing, `half` part-turned, `side` side-on), exercise (`Ex6` squat, `Ex5` lunge), range of motion from motion capture, from the app's old 3D angle and from the shipped hybrid. Rows keep the validation's order: repetitions grouped by video. No person or video column. |
| `rehab24-knee-methods.csv` | 42 | Per method and exercise/position: range-of-motion error, bias and ICC(2,1), extension error, number of rep-knee pairs. |
| `rehab24-squat-video.csv` | 344 | One person's squat video (21 squats), every 6th frame: motion capture and hybrid angle for the facing camera (right knee) and the side-on camera (left knee). |

Used by `scripts/validation/knee-repeatability.mjs` (docs/real-video-validation.md, section 5). Same attribution and non-commercial
terms as REHAB24-6.
