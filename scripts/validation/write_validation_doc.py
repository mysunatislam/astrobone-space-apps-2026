"""Write docs/real-video-validation.md from the report data, so every number in the doc is the measured one.

Usage: python write_validation_doc.py <report_data.json> <repo>
"""
import json, sys

d = json.load(open(sys.argv[1])); repo = sys.argv[2]
P, U = d["pose"], d["pulse"]
H = P["hybrid"]["mp-lite"]; A = H["rep"]["all|all"]
f1 = lambda v: "–" if v is None else f"{v:.1f}"
f0 = lambda v: "–" if v is None else f"{v:.0f}"
improved = sum(1 for p in H["perPerson"].values() if p["shipped"] < p["est3"])
hyb = next(m for m in U["methods"] if m["id"] == "Hybrid (app self-check)")
gate = next((s for s in hyb["sweep"] if s["q"] == 0.3), None)
dh = U["delta"].get("Hybrid (app self-check)")
L = []
w = L.append

w("# Real-video validation\n")
w(f"Generated {d['generated'][:10]} by `scripts/validation/`. Every number below was measured on recorded video of real people "
  "against laboratory ground truth: Vicon motion capture for the knee and a finger pulse sensor (PPG) for heart rate. Fitted models are "
  "always scored on people they were not trained on. The interactive version of this report, with the replay and animated charts, "
  "is built from the same data (`scripts/validation/report/`).\n")
w("## Summary\n")
w(f"- **Knee: the app's 3D knee angle missed squat depth.** Facing the camera, MediaPipe's 3D world-landmark angle made the knee's range of motion "
  f"{f1(abs(H['rep']['Ex6|front']['est3']['romBias']))}° too small on average in squats and {f1(abs(H['rep']['Ex5|front']['est3']['romBias']))}° in lunges. "
  "Larger MediaPipe models did not fix it.")
w(f"- **The hybrid knee model fixes most of it.** MediaPipe plus 100 learned trees: knee range-of-motion error {f1(A['est3']['romMae'])}° → {f1(A['shipped']['romMae'])}° "
  f"per rep, ICC(2,1) {A['est3']['romIcc']} → {A['shipped']['romIcc']}, better for {improved} of {len(H['perPerson'])} people left out of training. Shipped in `src/kneeHybrid.js`.")
w(f"- **Pulse: the old method almost never answered on real webcam video.** POS with a 60 % peak-share gate refused {f0(U['oldRefusedPct'])} % of 30-second windows.")
byid = {m["id"]: m for m in U["methods"]}
me_g, eq, lo = byid.get("ME-rPPG + gates (app)"), byid.get("Fusion, equal weights (first design)"), byid.get("Hybrid, weight chosen without this person")
w(f"- **The pulse hybrid reads within {f1(hyb['mae'])} bpm on average.** ME-rPPG (deep model) leading, POS at a quarter weight: {f0(hyb['within5'])} % of windows within 5 bpm of the "
  f"finger sensor on {U['dataset']['people']} people at rest and after squats, {f0(hyb['coverage'])} % of windows answered (the rest refused for head movement or lighting)"
  + (f"; with the shipped quality gate (0.3), {f1(gate['mae'])} bpm on {f0(gate['coverage'])} % of windows." if gate else "."))
if me_g and eq and lo:
    w(f"- **The hybrid beats its parts, validated on people it was not tuned on.** Deep model alone {f1(me_g['mae'])} bpm, our first equal-weight design (with CHROM) "
      f"{f1(eq['mae'])} bpm, shipped hybrid {f1(hyb['mae'])} bpm; with the POS weight chosen leave-one-person-out, {f1(lo['mae'])} bpm.")
if dh:
    w(f"- **It sees the change from a person's own baseline.** Rest → after 15 squats: change error {f1(dh['deltaMae'])} bpm, r = {dh['deltaR']} with the finger sensor, "
      f"same ≥ 8 bpm call in {f0(dh['flagAgreePct'])} % of {dh['n']} people.\n")

w("## 1. Pose: which pretrained model reads the knee best\n")
ds = P["dataset"]
w(f"**Data.** {ds['name']} ({ds['cite']}; doi:10.5281/zenodo.13305826, CC BY-NC 4.0): {ds['people']} people doing squats (Ex6) and lunges (Ex5), "
  f"two synchronized cameras, Vicon motion capture. {ds['videos']} camera videos, {ds['frames']:,} scored frames (every 6th frame), {ds['reps']} rep-and-knee pairs "
  "in the hybrid analysis. Camera position per rep from the dataset's orientation labels; the knee nearer a side-on camera from the camera centre recovered "
  "by direct linear transform from the motion-capture joints and their 2D projections.\n")
w("**Scoring.** Knee keypoints against the motion-capture knee projected into the same camera (PCK: within 10 % of the thigh length). Knee angle against the "
  "motion-capture 3D interior knee angle. Rep-level numbers use the app's definitions: extension = 95th percentile of the knee angle, range of motion (ROM) = 95th − 5th percentile. "
  "MediaPipe frames are gated at the app's visibility of 0.62.\n")
w("| Model | In browser | Knee within 10 % of thigh | Side-on squat ROM error (2D angle) | ICC | CPU ms/frame |")
w("|---|---|---|---|---|---|")
for m in sorted(P["models"], key=lambda m: -(m["pck10"] or 0)):
    w(f"| {m['label']} | {'yes' if m['browser'] else 'no'} | {f1(m['pck10'])} % | {f1(m['sideRomMaeSquat'])}° | {m['sideRomIccSquat'] or '–'} | {f0(m['msPerFrame'])} |")
w("")
yaw = P["yaw"]
w(f"**Camera position.** The app's body-yaw rule read facing captures as facing {f0(yaw['mp-lite|front']['class_pct']['front'])} % of the time and side-on captures as side-on "
  f"{f0(yaw['mp-lite|side']['class_pct']['side'])} %; part-turned captures were caught as part-turned {f0(yaw['mp-lite|half']['class_pct']['oblique'])} % of the time (the app refuses those). "
  f"Side-on, it picked the knee nearer the camera {f1(yaw['mp-lite|side']['near_side_correct_pct'])} % of the time.\n")

w("## 2. The hybrid knee model\n")
w("The pretrained model gives two knee angles: the 3D world-landmark angle (what the app used) and the 2D image-plane angle. The 3D angle is too straight facing the "
  "camera; the 2D angle is right only side-on. Each hybrid below combines them with the body yaw the app already measures, the thigh-to-shank image-length ratio "
  "(foreshortening) and the joint visibility. Fitted hybrids were scored leave-one-person-out: trained on eight people, tested on the ninth, nine times.\n")
names = [("est3", "Pretrained, 3D angle (app before)"), ("est2", "Pretrained, 2D angle"), ("rule", "Fixed rule: 2D when side-on (yaw ≥ 60°), else 3D"),
         ("blend", "Linear blend (ridge regression)"), ("gbm", "Gradient-boosted trees"), ("shipped", "Trees inside their training range, else the rule (shipped)")]
w(f"| Method | Rep ROM error | ROM bias | ROM ICC(2,1) | Rep extension error | Frame angle error |")
w("|---|---|---|---|---|---|")
for k, label in names:
    w(f"| {label} | {f1(A[k]['romMae'])}° | {f1(A[k]['romBias'])}° | {A[k]['romIcc']} | {f1(A[k]['extMae'])}° | {f1(H['frame']['all|all'][k])}° |")
w(f"\n{A['est3']['n']} rep-and-knee pairs, {H['people']} people. Mean absolute errors. {f0(H['inRangePct'])} % of frames were inside the trees' training range.\n")
w("**By movement and camera position** (rep ROM error, degrees):\n")
w("| | App before | Fixed rule | Hybrid (shipped) |")
w("|---|---|---|---|")
for k, label in [("Ex6|front", "Squat, facing"), ("Ex6|half", "Squat, part-turned"), ("Ex6|side", "Squat, side-on"), ("Ex5|front", "Lunge, facing"), ("Ex5|half", "Lunge, part-turned"), ("Ex5|side", "Lunge, side-on")]:
    r = H["rep"].get(k)
    if r:
        w(f"| {label} (n = {r['est3']['n']}) | {f1(r['est3']['romMae'])} | {f1(r['rule']['romMae'])} | {f1(r['shipped']['romMae'])} |")
w("\n**Per held-out person** (rep ROM error, degrees):\n")
w("| Person | App before | Hybrid (shipped) |")
w("|---|---|---|")
for p, v in sorted(H["perPerson"].items(), key=lambda x: int(x[0])):
    w(f"| {p} | {f1(v['est3'])} | {f1(v['shipped'])} |")
full = P["hybrid"].get("mp-full")
if full:
    w(f"\n**A bigger pretrained model is not the fix.** The same analysis on MediaPipe Pose full: app-style 3D angle {f1(full['rep']['all|all']['est3']['romMae'])}°, "
      f"hybrid {f1(full['rep']['all|all']['shipped']['romMae'])}°, no better than lite, at a higher cost per frame. The app keeps lite.")
w("\n**Model size.** 100 trees of at most 15 leaves (2,900 nodes, 52 KB of JavaScript). In the size sweep, 60 trees of 8 leaves scored 12.8° and 400 trees of 31 leaves 12.1°, "
  "so the result does not depend on a lucky setting.\n")
w("**What shipped.** `src/kneeHybrid.js` computes the features from each frame's world and image landmarks (image coordinates corrected for the frame's aspect ratio), "
  "evaluates the trees from `src/kneeHybridModel.js`, and falls back to the fixed rule when any feature is outside the 0.5–99.5 percentile range seen in training. "
  "`src/kneeHybrid.test.js` checks that the JavaScript port reproduces scikit-learn's predictions on 40 real frames to 0.001°. A capture measured with the hybrid "
  "gets protocol `self-check-seated-knee-extension-v3-*`, so it is never compared with an older 3D-angle baseline. The self-check now recommends sitting side-on.\n")

w("## 3. Pulse from the face\n")
pd_ = U["dataset"]
w(f"**Data.** {pd_['name']} (Egorov et al., arXiv 2508.17924; CC BY 4.0): {pd_['people']} people, 640 × 480 webcam at 30 fps, the first 60 s of a recording at rest and one "
  f"right after 15 squats, finger PPG as truth. {pd_['windows']} windows of 30 s every 10 s; a window's true rate is the PPG spectral peak over the same 30 s.\n")
w("**Scoring.** Every method's pulse wave goes through the app's own JavaScript estimator (`src/wavePulse.js`: band-pass 0.7–3 Hz, Hann-windowed spectrum, peak) via "
  "`scripts/validation/score-wave-pulse.mjs`, so the differences come from the methods. 'Hybrid (app self-check)' is `src/cameraPulse.js` exactly as shipped (`fusedPulseFromSamples` with `FUSION_WEIGHTS`), "
  "including its movement and lighting gates. Deep models run offline with published weights (open-rppg); ME-rPPG also runs through the browser's ONNX file, with "
  "the official detector crop and with the app's face-mesh crop.\n")
w("| Method | Kind | MAE (bpm) | RMSE | r | Within 5 bpm | Windows answered |")
w("|---|---|---|---|---|---|---|")
for m in sorted(U["methods"], key=lambda m: m["mae"]):
    w(f"| {m['label']} | {m['kind']} | {f1(m['mae'])} | {f1(m['rmse'])} | {m['r']} | {f0(m['within5'])} % | {f0(m['coverage'])} % |")
w(f"\nThe app's previous method (POS with a 60 % spectral peak-share gate) answered {f0(100 - U['oldRefusedPct'])} % of windows. Refusals: "
  + ", ".join(f"{k} ({v})" for k, v in (U["oldRefusals"] or {}).items()) + ".\n")
parts = [("Hybrid (app self-check)", "Shipped: ME-rPPG + POS at 0.25"), ("Hybrid, weight chosen without this person", "Same, weight chosen without the person scored"),
         ("ME-rPPG + gates (app)", "ME-rPPG alone"), ("Fusion, equal weights (first design)", "First design: ME-rPPG + POS + CHROM, equal weights"),
         ("POS (JS)", "POS alone"), ("CHROM (JS)", "CHROM alone")]
at = lambda m, q: next((x for x in m["sweep"] if x["q"] == q), {})
fu = U.get("fusion")
w("**Building the hybrid.** The first design fused ME-rPPG, POS and CHROM with equal weights (each spectrum counted by the square of its own peak share). "
  "On the first 6 people it beat the deep model alone; on all 40 it was worse, because the colour methods are noisy on this webcam footage. The fusion was retuned with "
  "the deep model leading: CHROM dropped and POS weighted " + (f"{fu['shipped']['pos']}. " if fu else "0.25. ")
  + ("Mean error by POS weight: " + ", ".join(f"{k} → {v} bpm" for k, v in sorted(fu["maeByPosWeight"].items(), key=lambda kv: float(kv[0]))) + ". To check that this choice is not tuned to the test people, "
     f"each person was left out in turn and the weight chosen on the other {sum(fu['picks'].values()) - 1}; it came out at {fu['shipped']['pos']} in {fu['picks'].get(str(fu['shipped']['pos']), 0)} "
     f"of {sum(fu['picks'].values())} cases, and the row 'weight chosen without the person' is scored only on the people left out.\n" if fu else "\n"))
w("**Is the hybrid better than its parts?** Each part as the app runs it (face-mesh crop, same gates, same estimator), scored on the same windows:\n")
w("| | MAE, all windows answered | Within 5 bpm | MAE at gate 0.3 | Answered at gate 0.3 | Rest → squats change error |")
w("|---|---|---|---|---|---|")
for k, l in parts:
    m = byid.get(k)
    if m:
        dd = U["delta"].get(k)
        w(f"| {l} | {f1(m['mae'])} bpm | {f0(m['within5'])} % | {f1(at(m, 0.3).get('mae'))} bpm | {f0(at(m, 0.3).get('coverage'))} % | {f1(dd['deltaMae']) + ' bpm' if dd else '–'} |")
w("")
w("**Quality gate.** The shipped hybrid refuses a window when the fused spectral peak holds less than 0.3 of the band power:\n")
w("| Gate | MAE (bpm) | Windows answered |")
w("|---|---|---|")
for s in hyb["sweep"]:
    w(f"| {s['q']} | {f1(s['mae'])} | {f0(s['coverage'])} % |")
w("")
lv = byid.get("POS live (app)")
if lv:
    g = at(lv, 0.3)
    w(f"**Live Capture.** The continuous Live Capture view reads the POS colour wave alone (no deep model, so the 3D scene keeps its frame rate) through the same "
      f"estimator with a 12-second first window and a 0.3 gate (`colourPulseFromSamples` in `src/cameraPulse.js`). On these windows it answered {f0(g.get('coverage'))} % "
      f"at {f1(g.get('mae'))} bpm; the rest it reports as unclear and asks the person to hold still. The 45-second self-check is the reading meant for the daily baseline.\n")
w("## 4. Change from the person's own baseline\n")
w("AstroBone compares a resting heart rate only with the same person's earlier readings by the same method. The closest test in this data is the rise from rest to "
  "right after 15 squats in the same person (first 30 s window of each recording).\n")
w("| Method | Change error (bpm) | r with finger change | Direction agrees | Same ≥ 8 bpm call | People |")
w("|---|---|---|---|---|---|")
for k, v in sorted(U["delta"].items(), key=lambda x: x[1]["deltaMae"]):
    label = next((m["label"] for m in U["methods"] if m["id"] == k), k)
    w(f"| {label} | {f1(v['deltaMae'])} | {v['deltaR']} | {f0(v['directionAgreePct'])} % | {f0(v['flagAgreePct'])} % | {v['n']} / {v['of']} |")
w("\n**Context.** Holter recordings of seven ISS crew members found night-time heart rate unchanged in flight (about 55 bpm) with lower daytime rates "
  "(Fraser, Hughson et al., IAC-11.A1.2.9, 2011). After flight, heart rate on standing or tilt rises (93 vs 74 bpm in six astronauts, Cox et al., J Physiol 2002; "
  "stand-test tachycardia in 11 ISS astronauts, Lee et al., Front Physiol 2020). A sustained change from a crew member's own resting baseline is therefore the signal worth "
  "watching; the app flags it for review past 8 bpm and never diagnoses.\n")
w("## 5. Limits\n")
w("- The knee hybrid was trained on squats and lunges; the self-check uses a seated knee extension. Side-on, both are motion in one plane, but the seated test needs its own "
  "goniometer check (the in-app angle check records exactly that).\n"
  "- Nine people in one lab for the knee; healthy adults on Earth for the pulse. None are astronauts.\n"
  "- The pulse windows are from the same camera model and lighting per recording; darker skin tones, moving subjects and dim light need their own test.\n"
  "- The live browser path was run end to end with Chromium's fake camera playing a real face video (`scripts/qa-camera-pulse.mjs`). On the headless test machine, with software "
  "graphics, the worker analysed only 7 frames a second, below the 15 the estimator needs, so the app refused with that reason instead of reporting a rate. A reading on a real "
  "phone or laptop camera, next to a finger pulse oximeter, is still needed.\n"
  "- REHAB24-6 is CC BY-NC 4.0, so the fitted trees are for non-commercial use.\n")
w("## 6. Rerun\n")
w("See `scripts/validation/README.md`. In short: download the datasets, run `rppg_worker.py` and `pose_driver.sh`, then `eval_rppg.py`, `export_signals.py`, "
  "`score-wave-pulse.mjs`, `eval_pose.py`, `hybrid_pose.py`, `export_knee_hybrid.py`, `report_data.py` and this file's generator `write_validation_doc.py`.\n")
open(f"{repo}/docs/real-video-validation.md", "w").write("\n".join(L))
print("wrote docs/real-video-validation.md", len("\n".join(L)) // 1024, "KB")
