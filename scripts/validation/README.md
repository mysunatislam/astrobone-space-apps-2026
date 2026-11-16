# Real-video validation scripts

These scripts produced every number in `docs/real-video-validation.md` and the interactive report. They run offline on a
workstation (Python 3.13, 4 CPU cores, no GPU needed); nothing here is part of the app build. All data lives under
`/home/user/data` (change the paths at the top of each script, or symlink that folder). No dataset video is committed.

## Data

| Dataset | Use | Where | Licence |
|---|---|---|---|
| REHAB24-6 (Černek et al., 2024) | knee: video + Vicon motion capture, 9 people, squats (Ex6) and lunges (Ex5) | https://doi.org/10.5281/zenodo.13305826 (`videos.zip`, `2d_joints.zip`, `3d_joints.zip`, `Segmentation.csv`) into `/home/user/data/rehab24` | CC BY-NC 4.0 |
| MCD-rPPG (Egorov et al., 2025) | pulse: webcam video + finger PPG, at rest and after 15 squats | https://huggingface.co/datasets/kyegorov/mcd_rppg (listed in `jobs_mcd.tsv`, fetched by the worker) | CC BY 4.0 |

Python packages: `numpy pandas scipy scikit-learn opencv-python mediapipe onnxruntime ultralytics transformers torch open-rppg`
(open-rppg 0.1.1 for the FacePhys, ME-rPPG chunk, PhysNet and EfficientPhys weights). Set `OMP_NUM_THREADS=1` for the
scikit-learn steps: OpenMP threads stall badly on a loaded machine.

## Pipeline

Pulse (each video: face mesh, skin colour, ME-rPPG through the browser's ONNX file with both crops, four open-rppg models):

```sh
python rppg_worker.py jobs_mcd.tsv /home/user/data/rppg_out 60     # one .npz per video, first 60 s
python eval_rppg.py /home/user/data/eval.json /home/user/data/rppg_out   # 30 s windows vs the finger PPG
python export_signals.py /home/user/data/rppg_out /home/user/data/signals
node score-wave-pulse.mjs /home/user/data/eval.json /home/user/data/signals /home/user/data/js.json   # the app's own JavaScript
```

`score-wave-pulse.mjs` imports `src/wavePulse.js` and `src/cameraPulse.js`, so the pulse numbers are the shipped code's numbers.
`fit_facebox.py` fitted the face-mesh-to-detector box mapping in `src/meRppg.js` (`MESH_TO_BLAZE`).

Knee:

```sh
python make_frames.py                 # which frames to score (every 6th of squats, 10th of lunges)
./pose_driver.sh                      # every pose model over every video (run_pose.py), skips finished outputs
python eval_pose.py                   # keypoints, angles, camera position, rep extension and ROM vs motion capture
python hybrid_pose.py mp-lite mp-full # rule, ridge blend, boosted trees, shipped (guarded) trees; leave-one-person-out
python export_knee_hybrid.py <repo>   # refits on all 9 people, writes src/kneeHybridModel.js and its test fixture
```

Knee repeat noise needs no download: it reads the derived tables committed in `data/validation/` (the per-repetition table, the
per-method summary and one squat video frame by frame, all written by the steps above) through `src/kneeRepeatability.js`:

```sh
node knee-repeatability.mjs           # section 5 of docs/real-video-validation.md; --json for the raw numbers
```

`src/kneeRepeatability.test.js` checks that `KNEE_REPEAT_NOISE` in `src/selfCheck.js` and the doc's section 5 match its output.

Report and doc:

```sh
python report_data.py /home/user/data/eval.json /home/user/data/js.json report/report_data.json
python report/build_report.py report/report_data.json report/astrobone-validation.html
python write_validation_doc.py report/report_data.json <repo>
python update_readme.py report/report_data.json <repo> <test count>   # the README's validation bullet
node report/assets.mjs report/astrobone-validation.html <out>   # video stills and clips (Playwright + ffmpeg)
python report/video_kit.py report/report_data.json <out>         # narration draft, shot list and CSVs for the video
```

`pose_driver.sh` reads the model list from `MODELS` (default: all eight). MoveNet, ViTPose-B and SynthPose-B crop each frame
with the YOLO11m person box, so run `yolo11m` first.

## November 2026 expansion

Claim audit, a second knee dataset and the camera pulse on more people and three cameras (`docs/validation-expansion-2026-11.md`):

```sh
node ../audit-claims.mjs                       # every README headline number, recomputed (--quick, --tests, --json)
python -I sync21_knee.py <dir> <out>           # Zenodo 19720803: unzip 02_markerbased_data.zip and 03_markerless_data.zip into <dir>
python -I mcd_scale_worker.py jobs.txt <npz> 60 <shard> <shards>   # rows "person camera state"; 4 shards ran in parallel
python -I mcd_scale_export.py <npz> <ecg cache> <signals>          # reference rate per window, PPG and ECG RMSSD
node score-scale.mjs <signals> scale.json      # the app's JavaScript on 30 s windows: self-check estimator, Live Capture pulse, estimateStress
python -I summarize_scale.py scale.json <repo> # writes data/validation/mcd-scale-*
python -I mcd_selfcheck_export.py <npz> <repo> <clips>   # 42 s clips cut like the self-check's camera minute
node score-selfcheck.mjs <clips> ../../data/validation/mcd-selfcheck-read.csv   # earlier vs shipped self-check read, gate by halves
python -I write_expansion_doc.py <repo>        # writes docs/validation-expansion-2026-11.md
```

The jobs list was 120 random MCD-rPPG people (Python `random.seed(2026)`, `random.sample` of the sorted ids) x 3 cameras x 2 states; the run stopped
after the people listed in `data/validation/mcd-scale-summary.json`, and people from the first 40 are left out of every number.
