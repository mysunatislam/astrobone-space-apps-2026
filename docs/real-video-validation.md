# Real-video validation

Generated 2026-10-26 by `scripts/validation/`. Every number below was measured on recorded video of real people against laboratory ground truth: Vicon motion capture for the knee and a finger pulse sensor (PPG) for heart rate. Fitted models are always scored on people they were not trained on. The interactive version of this report, with the replay and animated charts, is built from the same data (`scripts/validation/report/`).

## Summary

- **Knee: the app's 3D knee angle missed squat depth.** Facing the camera, MediaPipe's 3D world-landmark angle made the knee's range of motion 29.9° too small on average in squats and 26.9° in lunges. Larger MediaPipe models did not fix it.
- **The hybrid knee model fixes most of it.** MediaPipe plus 100 learned trees: knee range-of-motion error 21.7° → 13.2° per rep, ICC(2,1) 0.549 → 0.769, better for 9 of 9 people left out of training. Shipped in `src/kneeHybrid.js`.
- **Pulse: the old method almost never answered on real webcam video.** POS with a 60 % peak-share gate refused 95 % of 30-second windows.
- **The pulse hybrid reads within 2.1 bpm on average.** ME-rPPG (deep model) leading, POS at a quarter weight: 90 % of windows within 5 bpm of the finger sensor on 40 people at rest and after squats, 96 % of windows answered (the rest refused for head movement or lighting); with the shipped quality gate (0.3), 0.6 bpm on 77 % of windows.
- **The hybrid beats its parts, validated on people it was not tuned on.** Deep model alone 2.4 bpm, our first equal-weight design (with CHROM) 3.1 bpm, shipped hybrid 2.1 bpm; with the POS weight chosen leave-one-person-out, 2.3 bpm.
- **It sees the change from a person's own baseline.** Rest → after 15 squats: change error 4.2 bpm, r = 0.805 with the finger sensor, same ≥ 8 bpm call in 87 % of 38 people.

## 1. Pose: which pretrained model reads the knee best

**Data.** REHAB24-6 (Černek et al., 2024; doi:10.5281/zenodo.13305826, CC BY-NC 4.0): 9 people doing squats (Ex6) and lunges (Ex5), two synchronized cameras, Vicon motion capture. 36 camera videos, 10,124 scored frames (every 6th frame of squats, every 10th of lunges), 928 rep-and-knee pairs in the hybrid analysis. Camera position per rep from the dataset's orientation labels; the knee nearer a side-on camera from the camera centre recovered by direct linear transform from the motion-capture joints and their 2D projections.

**Scoring.** Knee keypoints against the motion-capture knee projected into the same camera (PCK: within 10 % of the thigh length). Knee angle against the motion-capture 3D interior knee angle. Rep-level numbers use the app's definitions: extension = 95th percentile of the knee angle, range of motion (ROM) = 95th − 5th percentile. MediaPipe frames are gated at the app's visibility of 0.62. The slower models ran on every second scored frame, so the table below scores every model on those shared frames only.

| Model | In browser | Knee within 10 % of thigh | Side-on squat ROM error (2D angle) | ICC | CPU ms/frame |
|---|---|---|---|---|---|
| MediaPipe Pose heavy | yes | 63.1 % | 5.6° | 0.919 | 80 |
| MediaPipe Pose full | yes | 55.9 % | 4.9° | 0.933 | 29 |
| MediaPipe Pose lite | yes | 53.8 % | 5.9° | 0.917 | 24 |

**Camera position.** The app's body-yaw rule read facing captures as facing 100 % of the time and side-on captures as side-on 100 %; part-turned captures were caught as part-turned 55 % of the time (the app refuses those). Side-on, it picked the knee nearer the camera 99.3 % of the time.

## 2. The hybrid knee model

The pretrained model gives two knee angles: the 3D world-landmark angle (what the app used) and the 2D image-plane angle. The 3D angle is too straight facing the camera; the 2D angle is right only side-on. Each hybrid below combines them with the body yaw the app already measures, the thigh-to-shank image-length ratio (foreshortening) and the joint visibility. Fitted hybrids were scored leave-one-person-out: trained on eight people, tested on the ninth, nine times.

| Method | Rep ROM error | ROM bias | ROM ICC(2,1) | Rep extension error | Frame angle error |
|---|---|---|---|---|---|
| Pretrained, 3D angle (app before) | 21.7° | -19.6° | 0.549 | 8.2° | 14.4° |
| Pretrained, 2D angle | 27.6° | -24.1° | 0.393 | 12.0° | 26.4° |
| Fixed rule: 2D when side-on (yaw ≥ 60°), else 3D | 20.0° | -17.1° | 0.584 | 8.5° | 13.6° |
| Linear blend (ridge regression) | 16.3° | -12.8° | 0.671 | 11.6° | 11.3° |
| Gradient-boosted trees | 12.4° | -8.1° | 0.795 | 8.0° | 10.1° |
| Trees inside their training range, else the rule (shipped) | 13.2° | -8.9° | 0.769 | 8.0° | 10.4° |

928 rep-and-knee pairs, 9 people. Mean absolute errors. 93 % of frames were inside the trees' training range.

**By movement and camera position** (rep ROM error, degrees):

| | App before | Fixed rule | Hybrid (shipped) |
|---|---|---|---|
| Squat, facing (n = 196) | 29.9 | 29.9 | 16.8 |
| Squat, part-turned (n = 186) | 23.2 | 22.1 | 13.1 |
| Squat, side-on (n = 98) | 18.8 | 6.1 | 6.5 |
| Lunge, facing (n = 176) | 27.3 | 27.3 | 15.5 |
| Lunge, part-turned (n = 181) | 13.3 | 13.7 | 13.1 |
| Lunge, side-on (n = 91) | 9.8 | 7.8 | 8.7 |

Side-on, the fixed rule (the 2D angle) was slightly better than the trees: 6.1° against 6.5° in squats and 7.8° against 8.7° in lunges. The gap is under 1°, and facing the camera the trees are far better, so the trees are used in every position.

**Per held-out person** (rep ROM error, degrees):

| Person | App before | Hybrid (shipped) |
|---|---|---|
| 1 | 23.2 | 12.7 |
| 2 | 28.1 | 17.0 |
| 3 | 17.5 | 12.2 |
| 4 | 13.5 | 9.4 |
| 5 | 24.3 | 14.2 |
| 6 | 23.2 | 16.1 |
| 7 | 22.4 | 12.9 |
| 8 | 20.1 | 13.3 |
| 9 | 22.7 | 10.9 |

**A bigger pretrained model is not the fix.** The same analysis on MediaPipe Pose full: app-style 3D angle 21.7°, hybrid 13.2°, no better than lite, at a higher cost per frame. The app keeps lite.

**Model size.** 100 trees of at most 15 leaves (2,900 nodes, 52 KB of JavaScript). In the size sweep, 60 trees of 8 leaves scored 12.8° and 400 trees of 31 leaves 12.1°, so the result does not depend on a lucky setting.

**What shipped.** `src/kneeHybrid.js` computes the features from each frame's world and image landmarks (image coordinates corrected for the frame's aspect ratio), evaluates the trees from `src/kneeHybridModel.js`, and falls back to the fixed rule when any feature is outside the 0.5–99.5 percentile range seen in training. `src/kneeHybrid.test.js` checks that the JavaScript port reproduces scikit-learn's predictions on 40 real frames to 0.001°. A capture measured with the hybrid gets protocol `self-check-seated-knee-extension-v3-*`, so it is never compared with an older 3D-angle baseline. The self-check now recommends sitting side-on.

## 3. Pulse from the face

**Data.** MCD-rPPG (Egorov et al., arXiv 2508.17924; CC BY 4.0): 40 people, 640 × 480 webcam at 30 fps, the first 60 s of a recording at rest and one right after 15 squats, finger PPG as truth. 320 windows of 30 s every 10 s; a window's true rate is the PPG spectral peak over the same 30 s.

**Scoring.** Every method's pulse wave goes through the app's own JavaScript estimator (`src/wavePulse.js`: band-pass 0.7–3 Hz, Hann-windowed spectrum, peak) via `scripts/validation/score-wave-pulse.mjs`, so the differences come from the methods. 'Hybrid (app self-check)' is `src/cameraPulse.js` exactly as shipped (`fusedPulseFromSamples` with `FUSION_WEIGHTS`), including its movement and lighting gates. Deep models run offline with published weights (open-rppg); ME-rPPG also runs through the browser's ONNX file, with the official detector crop and with the app's face-mesh crop.

| Method | Kind | MAE (bpm) | RMSE | r | Within 5 bpm | Windows answered |
|---|---|---|---|---|---|---|
| AstroBone hybrid | hybrid | 2.1 | 6.9 | 0.919 | 90 % | 96 % |
| AstroBone, held out | hybrid | 2.3 | 7.1 | 0.914 | 89 % | 96 % |
| ME-rPPG, app | deep | 2.4 | 7.9 | 0.892 | 89 % | 96 % |
| ME-rPPG, detector crop | deep | 2.9 | 8.8 | 0.862 | 87 % | 100 % |
| First hybrid design | first | 3.1 | 10.5 | 0.825 | 89 % | 96 % |
| FacePhys | deep | 4.8 | 12.7 | 0.755 | 82 % | 99 % |
| ME-rPPG chunk | deep | 5.5 | 14.8 | 0.669 | 84 % | 100 % |
| AstroBone live | hybrid | 6.9 | 17.3 | 0.556 | 79 % | 91 % |
| POS | classic | 7.1 | 17.4 | 0.541 | 77 % | 94 % |
| OMIT | classic | 10.2 | 21.5 | 0.355 | 71 % | 96 % |
| GREEN | classic | 10.2 | 21.5 | 0.393 | 72 % | 90 % |
| LGI | classic | 10.2 | 21.6 | 0.349 | 71 % | 95 % |
| PhysNet | deep | 10.3 | 20.9 | 0.469 | 72 % | 100 % |
| EfficientPhys | deep | 15.9 | 22.9 | 0.117 | 32 % | 100 % |
| CHROM | classic | 18.2 | 28.2 | 0.152 | 47 % | 96 % |

The app's previous method (POS with a 60 % spectral peak-share gate) answered 5 % of windows. Refusals: ambiguous spectrum (292), lighting (12).

**Building the hybrid.** The first design fused ME-rPPG, POS and CHROM with equal weights (each spectrum counted by the square of its own peak share). On the first 6 people it beat the deep model alone; on all 40 it was worse, because the colour methods are noisy on this webcam footage. The fusion was retuned with the deep model leading: CHROM dropped and POS weighted 0.25. Mean error by POS weight: 0 → 2.44 bpm, 0.1 → 2.19 bpm, 0.25 → 2.14 bpm, 0.5 → 2.19 bpm, 1 → 2.37 bpm. To check that this choice is not tuned to the test people, each person was left out in turn and the weight chosen on the other 39; it came out at 0.25 in 38 of 40 cases, and the row 'weight chosen without the person' is scored only on the people left out.

**Is the hybrid better than its parts?** Each part as the app runs it (face-mesh crop, same gates, same estimator), scored on the same windows:

| | MAE, all windows answered | Within 5 bpm | MAE at gate 0.3 | Answered at gate 0.3 | Rest → squats change error |
|---|---|---|---|---|---|
| Shipped: ME-rPPG + POS at 0.25 | 2.1 bpm | 90 % | 0.6 bpm | 77 % | 4.2 bpm |
| Same, weight chosen without the person scored | 2.3 bpm | 89 % | 0.6 bpm | 77 % | 4.7 bpm |
| ME-rPPG alone | 2.4 bpm | 89 % | 0.7 bpm | 79 % | 5.7 bpm |
| First design: ME-rPPG + POS + CHROM, equal weights | 3.1 bpm | 89 % | 0.5 bpm | 71 % | 6.3 bpm |
| POS alone | 7.1 bpm | 77 % | 1.2 bpm | 33 % | 12.4 bpm |
| CHROM alone | 18.2 bpm | 47 % | 4.8 bpm | 16 % | 21.4 bpm |

**Quality gate.** The shipped hybrid refuses a window when the fused spectral peak holds less than 0.3 of the band power:

| Gate | MAE (bpm) | Windows answered |
|---|---|---|
| 0 | 2.1 | 96 % |
| 0.2 | 1.1 | 88 % |
| 0.3 | 0.6 | 77 % |
| 0.4 | 0.4 | 63 % |
| 0.5 | 0.3 | 41 % |
| 0.6 | 0.2 | 26 % |

**Live Capture.** The continuous Live Capture view reads the POS colour wave alone (no deep model, so the 3D scene keeps its frame rate) through the same estimator with a 12-second first window and a 0.3 gate (`colourPulseFromSamples` in `src/cameraPulse.js`). On these windows it answered 33 % at 1.2 bpm; the rest it reports as unclear and asks the person to hold still. The 45-second self-check is the reading meant for the daily baseline.

## 4. Change from the person's own baseline

AstroBone compares a resting heart rate only with the same person's earlier readings by the same method. The closest test in this data is the rise from rest to right after 15 squats in the same person (first 30 s window of each recording).

| Method | Change error (bpm) | r with finger change | Direction agrees | Same ≥ 8 bpm call | People |
|---|---|---|---|---|---|
| FacePhys | 4.1 | 0.763 | 95 % | 82 % | 38 / 40 |
| AstroBone hybrid | 4.2 | 0.805 | 92 % | 87 % | 38 / 40 |
| AstroBone, held out | 4.7 | 0.783 | 90 % | 84 % | 38 / 40 |
| ME-rPPG chunk | 4.9 | 0.71 | 88 % | 85 % | 40 / 40 |
| ME-rPPG, app | 5.7 | 0.643 | 92 % | 84 % | 38 / 40 |
| First hybrid design | 6.3 | 0.545 | 92 % | 84 % | 38 / 40 |
| ME-rPPG, detector crop | 6.8 | 0.467 | 80 % | 72 % | 40 / 40 |
| PhysNet | 11.4 | -0.046 | 75 % | 68 % | 40 / 40 |
| GREEN | 12.2 | 0.276 | 76 % | 64 % | 33 / 40 |
| POS | 12.4 | 0.145 | 76 % | 73 % | 37 / 40 |
| AstroBone live | 12.9 | 0.107 | 74 % | 71 % | 35 / 40 |
| OMIT | 13.9 | 0.124 | 76 % | 65 % | 37 / 40 |
| LGI | 14.3 | 0.124 | 75 % | 64 % | 36 / 40 |
| EfficientPhys | 15.8 | -0.004 | 42 % | 50 % | 40 / 40 |
| CHROM | 21.4 | 0.159 | 63 % | 57 % | 35 / 40 |

**Context.** Holter recordings of seven ISS crew members found night-time heart rate unchanged in flight (about 55 bpm) with lower daytime rates (Fraser, Hughson et al., IAC-11.A1.2.9, 2011). After flight, heart rate on standing or tilt rises (93 vs 74 bpm in six astronauts, Cox et al., J Physiol 2002; stand-test tachycardia in 11 ISS astronauts, Lee et al., Front Physiol 2020). A sustained change from a crew member's own resting baseline is therefore the signal worth watching; the app flags it for review past 8 bpm and never diagnoses.

## 5. Limits

- The knee hybrid was trained on squats and lunges; the self-check uses a seated knee extension. Side-on, both are motion in one plane, but the seated test needs its own goniometer check (the in-app angle check records exactly that).
- Nine people in one lab for the knee; healthy adults on Earth for the pulse. None are astronauts.
- The pulse windows are from the same camera model and lighting per recording; darker skin tones, moving subjects and dim light need their own test.
- The live browser path was run end to end with Chromium's fake camera playing a real face video (`scripts/qa-camera-pulse.mjs`). On the headless test machine, with software graphics, the worker analysed only 7 frames a second, below the 15 the estimator needs, so the app refused with that reason instead of reporting a rate. A reading on a real phone or laptop camera, next to a finger pulse oximeter, is still needed.
- REHAB24-6 is CC BY-NC 4.0, so the fitted trees are for non-commercial use.

## 6. Rerun

See `scripts/validation/README.md`. In short: download the datasets, run `rppg_worker.py` and `pose_driver.sh`, then `eval_rppg.py`, `export_signals.py`, `score-wave-pulse.mjs`, `eval_pose.py`, `hybrid_pose.py`, `export_knee_hybrid.py`, `report_data.py` and this file's generator `write_validation_doc.py`.
