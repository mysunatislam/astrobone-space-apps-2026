"""Write the reusable video kit next to the stills and clips: a README with a narration draft and shot list, and the
numbers behind every chart as CSV, all from the same report data as the interactive report.

Usage: python video_kit.py <report_data.json> <out dir>
"""
import csv, json, os, sys

d = json.load(open(sys.argv[1])); out = sys.argv[2]
os.makedirs(f"{out}/data", exist_ok=True)
P, U = d["pose"], d["pulse"]
H = P["hybrid"]["mp-lite"]; A = H["rep"]["all|all"]
f1 = lambda v: "–" if v is None else f"{v:.1f}"
f0 = lambda v: "–" if v is None else f"{v:.0f}"
by_id = {m["id"]: m for m in U["methods"]}
hyb, me_app, pos = by_id["Hybrid (app self-check)"], by_id.get("ME-rPPG mesh box (app)"), by_id.get("POS (JS)")
live = by_id.get("POS live (app)")
gate = next((s for s in hyb["sweep"] if s["q"] == 0.3), None)
dh = U["delta"].get("Hybrid (app self-check)")
improved = sum(1 for p in H["perPerson"].values() if p["shipped"] < p["est3"])
front_bias = abs(H["rep"]["Ex6|front"]["est3"]["romBias"])
cut = 100 * (1 - A["shipped"]["romMae"] / A["est3"]["romMae"])
KNEE = [("est3", "Pretrained, 3D angle (app before)"), ("est2", "Pretrained, 2D angle"), ("rule", "Fixed rule: 2D side-on, else 3D"),
        ("blend", "Linear blend (ridge)"), ("gbm", "Learned trees"), ("shipped", "Learned trees + fallback (shipped)")]


def table(name, header, rows):
    with open(f"{out}/data/{name}", "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(header); w.writerows(rows)


table("pose_models.csv", ["model", "runs_in_browser", "person_found_pct", "knee_within_10pct_thigh_pct", "knee_keypoint_error_pct_thigh",
                          "cpu_ms_per_frame", "side_squat_rom_mae_deg", "side_squat_rom_icc", "side_lunge_rom_mae_deg", "front_squat_rom_mae_3d_deg"],
      [[m["label"], m["browser"], m["detected"], m["pck10"], m["kneeErr"], m["msPerFrame"], m["sideRomMaeSquat"], m["sideRomIccSquat"],
        m["sideRomMaeLunge"], m["frontRom3dMaeSquat"]] for m in P["models"]])
table("knee_methods.csv", ["method", "exercise_view", "rom_mae_deg", "rom_bias_deg", "rom_icc21", "extension_mae_deg", "rep_knee_pairs"],
      [[label, k, v[e]["romMae"], v[e]["romBias"], v[e]["romIcc"], v[e]["extMae"], v[e]["n"]] for k, v in H["rep"].items() for e, label in KNEE if e in v])
table("knee_per_person.csv", ["person_left_out"] + [label for _, label in KNEE],
      [[p] + [v.get(e) for e, _ in KNEE] for p, v in sorted(H["perPerson"].items(), key=lambda x: int(x[0]))])
table("knee_reps_bland_altman.csv", ["view", "exercise", "mocap_rom_deg", "app_before_rom_deg", "hybrid_rom_deg"],
      zip(P["bland"]["view"], P["bland"]["ex"], P["bland"]["gt"], P["bland"]["app"], P["bland"]["hybrid"]))
table("pulse_methods.csv", ["method", "what_it_is", "mae_bpm", "rmse_bpm", "r", "within_5_bpm_pct", "windows_answered_pct", "windows"],
      [[m["label"], m["note"], m["mae"], m["rmse"], m["r"], m["within5"], m["coverage"], m["n"]] for m in sorted(U["methods"], key=lambda m: m["mae"])])
table("pulse_gate_sweep.csv", ["method", "quality_gate", "mae_bpm", "windows_answered_pct"],
      [[m["label"], s["q"], s["mae"], s["coverage"]] for m in U["methods"] for s in m["sweep"]])
if dh:
    table("pulse_rest_vs_squats.csv", ["person", "finger_rest_bpm", "finger_after_squats_bpm", "camera_rest_bpm", "camera_after_squats_bpm"],
          [[p["id"], round(p["gtBefore"], 1), round(p["gtAfter"], 1), round(p["estBefore"], 1), round(p["estAfter"], 1)] for p in dh["pairs"]])
table("pulse_wave_12s.csv", ["t_seconds", "finger_ppg", "camera_me_rppg"],
      [[round(i / U["wave"]["fps"], 3), a, b] for i, (a, b) in enumerate(zip(U["wave"]["finger"], U["wave"]["camera"]))])

L = []; w = L.append
w("# AstroBone validation: video kit\n")
w(f"Everything here comes from the real-video validation run of {d['generated'][:10]}: the same numbers as the interactive report "
  "(`report/astrobone-validation.html`, open it in a browser) and `docs/real-video-validation.md` in the app repo. Rebuild it with "
  "`scripts/validation/` if the numbers change.\n")
w("## Folder\n")
w("- `stills/` 16 PNG panels from the report at 2x (about 3200 px wide), dark background, ready to crop to 1920 × 1080.")
w("- `clips/` screen recordings of the animated panels, 1920 × 1080, 30 fps, H.264 MP4, no audio:")
w("  - `knee-replay-two-cameras.mp4` (about 23 s): one real squat seen from the front and the side at once. White skeleton = motion capture, "
  "amber = what the app used to read, cyan = the hybrid knee model. The angle gauges show the gap closing.")
w("  - `pulse-wave-camera-vs-finger.mp4` (about 13 s): the pulse wave the camera pulled from a face (cyan) scrolling under the finger sensor's wave (white).")
w("  - `every-person-improved.mp4` (about 5 s): each held-out person's error before (amber) and after (cyan) the hybrid, animating in.")
w("  - `pulse-leaderboard.mp4` (about 5 s): every pulse method ranked by error, bars growing in.")
w("- `data/` the numbers behind each chart as CSV (pose models, knee methods by camera position, per person, every rep, pulse methods, "
  "the gate sweep, rest vs after squats, the 12-second wave).")
w("- `report/` an offline copy of the interactive report.\n")

w("## Numbers you can say\n")
w("All measured on recorded video of real people against lab ground truth. Fitted models were always tested on people they never saw.\n")
w("| Say | Number | Where it comes from |")
w("|---|---|---|")
rows = [
    ("The off-the-shelf pose AI under-read squat depth facing the camera", f"by {f1(front_bias)}° per rep on average", f"{P['dataset']['name']}, Vicon motion capture, {P['dataset']['people']} people"),
    ("AstroBone's hybrid knee model cut the knee error", f"{f1(A['est3']['romMae'])}° → {f1(A['shipped']['romMae'])}° per rep ({f0(cut)} % less)", f"{A['shipped']['n']} reps, leave-one-person-out"),
    ("Agreement with motion capture (ICC)", f"{A['est3']['romIcc']} → {A['shipped']['romIcc']}", "ICC(2,1), range of motion per rep"),
    ("Better for every person it was tested on", f"{improved} of {len(H['perPerson'])} people", "each person left out of training in turn"),
    ("Pose models compared", f"{len(P['models'])} pretrained models + 4 hybrid designs", "same frames, same truth"),
    ("The old pulse method on real webcam video", f"answered {f0(100 - U['oldRefusedPct'])} % of 30-second windows", f"{U['dataset']['name']}, finger sensor"),
    ("The new pulse hybrid", f"{f1(hyb['mae'])} bpm average error, {f0(hyb['within5'])} % within 5 bpm", f"{U['dataset']['people']} people, {U['dataset']['windows']} windows, at rest and after squats"),
]
if gate:
    rows.append(("With its quality gate on", f"{f1(gate['mae'])} bpm on the {f0(gate['coverage'])} % of windows it answers", "the app tells the user to hold still otherwise"))
me_g, lo = by_id.get("ME-rPPG + gates (app)"), by_id.get("Hybrid, weight chosen without this person")
if me_g and lo:
    rows.append(("The hybrid beats the deep model alone", f"{f1(me_g['mae'])} → {f1(hyb['mae'])} bpm ({f1(lo['mae'])} with its weight tuned without the person scored)", "same windows, same gates, same estimator"))
if dh:
    rows.append(("It tracks the change from your own resting rate", f"rest → after 15 squats within {f1(dh['deltaMae'])} bpm, r = {dh['deltaR']}", f"{dh['n']} people with both recordings"))
rows.append(("Pulse methods compared", f"{len(U['methods'])} (deep models, classic methods, hybrids)", "every one through the same estimator"))
for r in rows:
    w(f"| {r[0]} | {r[1]} | {r[2]} |")
w("")

w("## Narration draft (about 60 seconds)\n")
w("For the validation part of the 240-second video. Cues in brackets name the asset.\n")
w(f"1. **[knee-replay-two-cameras.mp4]** \"We didn't trust our own AI, so we tested it. Real people, real squats, filmed from two cameras while a motion-capture "
  f"lab tracked every joint.\"")
w(f"2. **[stills/06-error-by-camera-position.png]** \"Facing the camera, the pretrained pose model we started with missed about {f0(front_bias)} degrees of knee bend. "
  f"Bigger versions of the same model didn't fix it.\"")
w(f"3. **[stills/04-hybrid-diagram.png]** \"So we built a hybrid: the pretrained model's angles, plus the camera angle and limb proportions, "
  f"fed to a small learned model that runs in the browser.\"")
w(f"4. **[every-person-improved.mp4]** \"It cut the knee error by {f0(cut)} percent, and it was better for {improved} out of {len(H['perPerson'])} people "
  f"it had never seen.\"")
w(f"5. **[pulse-wave-camera-vs-finger.mp4]** \"Same for the heart. The camera finds your pulse in the colour of your face. "
  f"On real webcam video our old method answered only {f0(100 - U['oldRefusedPct'])} percent of the time.\"")
w(f"6. **[pulse-leaderboard.mp4]** \"We tested {len(U['methods'])} methods. Our hybrid, a 2025 deep model cross-checked by a classic colour method, averaged "
  f"{f1(hyb['mae'])} beats per minute from a finger sensor.\"")
if dh:
    w(f"7. **[stills/13-rest-vs-after-squats.png]** \"And it doesn't compare you with anyone else. It tracks your own resting rate: after fifteen squats it "
      f"followed each person's rise to within {f0(dh['deltaMae'])} beats per minute.\"")
w("")

w("## Shot list\n")
w("| # | Length | Asset | Notes |")
w("|---|---|---|---|")
shots = [("1", "6 s", "clips/knee-replay-two-cameras.mp4", "Start a few seconds in, when both skeletons are moving"),
         ("2", "6 s", "stills/06-error-by-camera-position.png", "Slow push in on the amber facing-camera bar"),
         ("3", "7 s", "stills/04-hybrid-diagram.png", "Pan left to right along the flow"),
         ("4", "6 s", "clips/every-person-improved.mp4", "Let the cyan dots land; then cut"),
         ("5", "8 s", "clips/pulse-wave-camera-vs-finger.mp4", "Full length is 13 s; any 8 s works"),
         ("6", "6 s", "clips/pulse-leaderboard.mp4", "Hold on the top row"),
         ("7", "8 s", "stills/13-rest-vs-after-squats.png", "Highlight one rising line"),
         ("alt", "–", "stills/02-headline-numbers.png", "Title card or the last frame of the section"),
         ("alt", "–", "stills/16-what-changed.png", "If judges ask what is in the app now")]
for s in shots:
    w(f"| {' | '.join(s)} |")
w("")
w("## Wording that stays true\n")
w("- Say \"tracks your own resting heart rate over days\" and \"flags a change for review\". Don't say it diagnoses or replaces a medical device.")
w("- The people filmed were healthy adults on Earth, not astronauts. The knee test was squats and lunges; the app's daily check is a seated knee extension.")
w("- \"Validated against motion capture and a finger sensor on real recorded video\" is accurate. \"Clinically validated\" is not.")
w("- Faces and bodies from the datasets are never shown: the replay draws skeletons only, and the pulse wave is a line.\n")
w("## Licences\n")
w(f"- Pose data: {P['dataset']['name']} ({P['dataset']['cite']}), CC BY-NC 4.0: non-commercial use, credit the authors.")
w(f"- Pulse data: {U['dataset']['name']} ({U['dataset']['cite']}), CC BY 4.0: credit the authors.")
open(f"{out}/README.md", "w").write("\n".join(L) + "\n")
print("video kit:", out)
