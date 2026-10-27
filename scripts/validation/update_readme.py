"""Update the README's self-check row and validation bullets with the measured real-video numbers.
Usage: python update_readme.py <report_data.json> <repo>"""
import json, re, sys

d = json.load(open(sys.argv[1])); repo = sys.argv[2]
H = d["pose"]["hybrid"]["mp-lite"]; A = H["rep"]["all|all"]; U = d["pulse"]
hyb = next(m for m in U["methods"] if m["id"] == "Hybrid (app self-check)")
dh = U["delta"]["Hybrid (app self-check)"]
improved = sum(1 for p in H["perPerson"].values() if p["shipped"] < p["est3"])
f1 = lambda v: f"{v:.1f}"
f0 = lambda v: f"{v:.0f}"
p = f"{repo}/README.md"
s = open(p).read()

s = s.replace("seated knee-extension movement test with on-device pose AI,", "seated knee-extension movement test with on-device pose AI and a hybrid knee model,", 1)
s = s.replace("immune symptom checklist, resting heart rate and radiation dose.", "immune symptom checklist, resting heart rate from the camera (a deep rPPG model cross-checked with a classic colour method) or typed in, and radiation dose.", 1)

bullet = (f"- **Validated on real video:** the knee and the camera pulse were scored on recorded video of real people against lab ground truth "
          f"([report](docs/real-video-validation.md)). Knee: MediaPipe's 3D angle under-read squat range of motion by about "
          f"{f0(abs(H['rep']['Ex6|front']['est3']['romBias']))}° facing the camera; AstroBone's hybrid knee model (MediaPipe + learned trees) cut the error per rep from "
          f"{f1(A['est3']['romMae'])}° to {f1(A['shipped']['romMae'])}° and was better for {improved} of {len(H['perPerson'])} people it never saw (motion capture, REHAB24-6). "
          f"Pulse: on {U['dataset']['people']} people at rest and after squats, the old method refused {f0(U['oldRefusedPct'])} % of real webcam windows; the hybrid was within "
          f"{f1(hyb['mae'])} bpm of a finger sensor on average and tracked each person's rise from rest within {f1(dh['deltaMae'])} bpm (MCD-rPPG).\n")
anchor = "- **Reaction test timing:**"
if "**Validated on real video:**" not in s:
    s = s.replace(anchor, bullet + anchor, 1)
s = re.sub(r"- \*\*Tested:\*\* \d+ automated tests", f"- **Tested:** {sys.argv[3] if len(sys.argv) > 3 else 'all'} automated tests", s, count=1)
s = s.replace("- **Not yet validated:** camera joint angles have not yet been compared with a reference measurement. The Self-Check now has",
              "- **Not yet validated:** the seated knee-extension test itself has not been compared with a goniometer (the real-video check used squats and lunges). The Self-Check has", 1)
s = s.replace("A simulation shows side-on reads up to several degrees low near full extension, so positions are never compared",
              "On real video, side-on readings were the most accurate, so the self-check now recommends sitting side-on; positions are never compared", 1)
open(p, "w").write(s)
print("README updated")
