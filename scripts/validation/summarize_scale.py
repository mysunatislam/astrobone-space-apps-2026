"""Summarise the scale-up pulse run (score-scale.mjs output) into the committed tables.
Usage: python -I summarize_scale.py <scale.json> <repo>
People already used in the first validation (data/validation/mcd-pulse-rest-vs-squats.csv) are left out, so every
number here is on new people."""
import sys, json, csv
import numpy as np

scale, repo = sys.argv[1], sys.argv[2]
d = json.load(open(scale)); old = {r["person"] for r in csv.DictReader(open(f"{repo}/data/validation/mcd-pulse-rest-vs-squats.csv"))}
W = [w for w in d["windows"] if w["person"] not in old]; V = [v for v in d["videos"] if v["person"] not in old]
CAM = {"FullHDwebcam": "front webcam", "IriunWebcam": "phone camera (Iriun)", "USBVideo": "side USB camera"}
STATE = {"before": "at rest", "after": "after 15 squats"}

def stats(ws, key):
    e = np.array([w[key] - w["gt"] for w in ws if w[key] is not None])
    if not len(e): return dict(answered_pct=0.0, mae_bpm="", within_5_bpm_pct="", bias_bpm="")
    return dict(answered_pct=round(100 * len(e) / len(ws), 1), mae_bpm=round(float(np.abs(e).mean()), 2),
                within_5_bpm_pct=round(float(100 * (np.abs(e) <= 5).mean()), 1), bias_bpm=round(float(e.mean()), 2))

rows = []
for cam in list(CAM) + [None]:
    for st in list(STATE) + [None]:
        ws = [w for w in W if (cam is None or w["camera"] == cam) and (st is None or w["state"] == st)]
        if not ws: continue
        for key, label in (("hybrid", "Self-check hybrid (as shipped, gate 0.3)"), ("me", "ME-rPPG alone (gate 0.3)"), ("liveOld", "Live Capture colour pulse, earlier gate 0.3"), ("live", "Live Capture colour pulse, gate 0.5 (as shipped now)"), ("hybrid0", "Self-check hybrid, gate off")):
            rows.append(dict(camera=CAM.get(cam, "all three"), state=STATE.get(st, "both"), method=label, people=len({w["person"] for w in ws}), windows=len(ws), **stats(ws, key)))
with open(f"{repo}/data/validation/mcd-scale-pulse.csv", "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(rows[0])); wr.writeheader(); wr.writerows(rows)

# Live Capture gate: chosen on half of the people (every other id, sorted), checked on the other half.
people = sorted({w["person"] for w in W}); tune = set(people[0::2]); sweep = []
for g in (0.3, 0.35, 0.4, 0.45, 0.5):
    for half, members in (("choose", tune), ("check", set(people) - tune)):
        for cam in list(CAM) + [None]:
            ws = [w for w in W if w["person"] in members and (cam is None or w["camera"] == cam)]
            ok = [w for w in ws if w["live0"] is not None and w["liveQ"] >= g]; e = np.array([abs(w["live0"] - w["gt"]) for w in ok])
            sweep.append(dict(gate=g, half=half, camera=CAM.get(cam, "all three"), windows=len(ws), answered_pct=round(100 * len(ok) / max(len(ws), 1), 1),
                              mae_bpm=round(float(e.mean()), 2) if len(e) else "", max_error_bpm=round(float(e.max()), 1) if len(e) else ""))
with open(f"{repo}/data/validation/mcd-scale-live-gate.csv", "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(sweep[0])); wr.writeheader(); wr.writerows(sweep)

# Rest -> after squats, first 30 s window, per camera (the personal-baseline use).
chg = []
for cam in CAM:
    pairs = []
    for p in sorted({w["person"] for w in W}):
        b = next((w for w in W if w["person"] == p and w["camera"] == cam and w["state"] == "before" and w["t0"] == 0), None)
        a = next((w for w in W if w["person"] == p and w["camera"] == cam and w["state"] == "after" and w["t0"] == 0), None)
        if b and a: pairs.append((b, a))
    ok = [(b, a) for b, a in pairs if b["hybrid"] is not None and a["hybrid"] is not None]
    if len(ok) >= 3:
        g = np.array([a["gt"] - b["gt"] for b, a in ok]); e = np.array([a["hybrid"] - b["hybrid"] for b, a in ok])
        chg.append(dict(camera=CAM[cam], people=len(pairs), both_answered=len(ok), change_mae_bpm=round(float(np.abs(e - g).mean()), 2), change_r=round(float(np.corrcoef(g, e)[0, 1]), 3),
                        true_rise_bpm=round(float(g.mean()), 1)))
with open(f"{repo}/data/validation/mcd-scale-rest-vs-squats.csv", "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(chg[0])); wr.writeheader(); wr.writerows(chg)

# Live Capture heart-rate variability vs the finger PPG (same 60 s) and the ECG (30 s, not synchronised).
hrv = [dict(camera=CAM[v["camera"]], state=STATE[v["state"]], camera_rmssd_ms=v["rmssd"] if v["rmssd"] is not None else "", refused_reason=v["rmssdReason"] or "",
            finger_ppg_rmssd_ms=round(v["ref"]["rmssdPpg"], 1) if v["ref"]["rmssdPpg"] else "", ecg_rmssd_ms=round(v["ref"]["rmssdEcg"], 1) if v["ref"]["rmssdEcg"] else "") for v in V]
with open(f"{repo}/data/validation/mcd-scale-hrv.csv", "w", newline="") as f:
    wr = csv.DictWriter(f, fieldnames=list(hrv[0])); wr.writeheader(); wr.writerows(hrv)

ans = [h for h in hrv if h["camera_rmssd_ms"] != "" and h["finger_ppg_rmssd_ms"] != ""]
hyb = [abs(w["hybrid"] - w["gt"]) for w in W if w["hybrid"] is not None]
summary = dict(hybrid_worst_bpm=round(float(max(hyb)), 1), people=len({w["person"] for w in W}), videos=len(V), windows=len(W),
               hrv_answered=len([h for h in hrv if h["camera_rmssd_ms"] != ""]),
               hrv_mae_ms=round(float(np.mean([abs(h["camera_rmssd_ms"] - h["finger_ppg_rmssd_ms"]) for h in ans])), 1) if ans else None,
               hrv_ratio=round(float(np.median([h["camera_rmssd_ms"] / h["finger_ppg_rmssd_ms"] for h in ans])), 2) if ans else None)
json.dump(summary, open(f"{repo}/data/validation/mcd-scale-summary.json", "w"), indent=1)
print(json.dumps(summary)); [print(r) for r in rows if r["state"] == "both"]; [print(c) for c in chg]
