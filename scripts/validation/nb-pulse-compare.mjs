// NeuroBridge VitalSense pulse vs the AstroBone self-check pulse, on the same real webcam frames.
// Usage: node scripts/validation/nb-pulse-compare.mjs <export.json> [out.json]
// export.json comes from nb_pulse_export.py (MCD-rPPG, 40 people, rest and after 15 squats, first 60 s).
// NeuroBridge: app/vitalsense.js copied unchanged into scripts/validation/neurobridge/ (repo
// mysunatislam/neurobridge-asha-unified-app, commit a145b2c), fed frame by frame as its perception.js does,
// one instance per video; its reading is taken at 30, 40, 50 and 60 s and scored against the finger PPG
// over the 12 s it analyses. AstroBone: src/cameraPulse.js fusedPulseFromSamples, as shipped, on the
// 30 s before the same instants (and on 12 s for a like-for-like check). Nothing is fitted here.
import { readFileSync, writeFileSync } from "node:fs";
import { VitalSense } from "./neurobridge/vitalsense.js";
import { fusedPulseFromSamples, FUSION_WEIGHTS } from "../../src/cameraPulse.js";
import { breathingFromHead } from "../../src/faceCues.js";

const [file, outFile] = process.argv.slice(2);
const { videos } = JSON.parse(readFileSync(file, "utf8"));
const rows = [], breath = [];
for (const v of videos) {
  const nb = new VitalSense(), at = new Map(v.windows.map(w => [w.T, w]));
  const samples = [];
  for (let i = 0; i < v.n; i++) {
    const t = i * 1000 / v.fps;
    const rgb = v.nb_rgb[i];
    let value;
    if (!rgb || rgb.some(x => x === null)) value = nb.invalidate("Position your face in frame, centered and well-lit", t);
    else value = nb.add({ t, rgb, headY: v.nb_headY[i], motion: v.nb_motion[i] ?? 0, roiCount: v.nb_roi[i] });
    const ab = v.ab_rgb[i];
    samples.push({ t, bvp: v.me[i] ?? null, rgb: ab && ab.every(x => x !== null) ? ab : null, motion: v.ab_motion[i] ?? 1 });
    if (i === v.n - 1 && Number.isFinite(v.respiratory)) {
      const head = []; for (let k = 0; k < v.n; k++) if (Number.isFinite(v.nb_headY[k])) head.push({ t: k * 1000 / v.fps, headY: v.nb_headY[k] });
      const ab = breathingFromHead(head);
      breath.push({ id: v.id, gt: v.respiratory, nb: value.breathingBpm ?? null, ab: ab.status === "estimated" ? ab.rate : null, abq: ab.quality });
    }
    const T = Math.round((i + 1) / v.fps * 1000) / 1000;
    const w = [...at.values()].find(x => Math.abs(x.T - T) < 0.5 / v.fps);
    if (!w || w.done) continue;
    w.done = true;
    const ab30 = fusedPulseFromSamples(samples, { minQuality: 0 });
    const ab12 = fusedPulseFromSamples(samples, { minQuality: 0, windowSeconds: 12, minSeconds: 11 });
    rows.push({ id: v.id, T: w.T, gt12: w.gt12, gt30: w.gt30,
      nb: value.bpm, nbStatus: value.status, nbReason: value.bpm == null ? value.reason : undefined, nbSnrQuality: value.quality,
      ab30: ab30.bpmExact ?? null, ab30q: ab30.quality ?? 0, ab30Reason: ab30.status === "estimated" ? undefined : ab30.reason,
      ab12: ab12.bpmExact ?? null, ab12q: ab12.quality ?? 0 });
  }
}

function metrics(pairs) {
  const ok = pairs.filter(([g, e]) => Number.isFinite(g) && Number.isFinite(e));
  const total = pairs.filter(([g]) => Number.isFinite(g)).length;
  if (ok.length < 2) return { n: ok.length, answeredPct: total ? Math.round(1000 * ok.length / total) / 10 : 0 };
  const err = ok.map(([g, e]) => e - g), n = err.length, r1 = v => Math.round(v * 100) / 100;
  return { n, answeredPct: Math.round(1000 * n / total) / 10, mae: r1(err.reduce((s, x) => s + Math.abs(x), 0) / n),
    rmse: r1(Math.sqrt(err.reduce((s, x) => s + x * x, 0) / n)), within5Pct: Math.round(1000 * err.filter(x => Math.abs(x) <= 5).length / n) / 10,
    bias: r1(err.reduce((s, x) => s + x, 0) / n) };
}
const summary = {
  windows: rows.length, people: new Set(rows.map(r => r.id.split("_")[1])).size, fusionWeights: FUSION_WEIGHTS,
  "NeuroBridge VitalSense (as shipped; vs PPG over its 12 s)": metrics(rows.map(r => [r.gt12, r.nb])),
  "NeuroBridge VitalSense, only 'good' readings": metrics(rows.map(r => [r.gt12, r.nbStatus === "good" ? r.nb : null])),
  "AstroBone hybrid, 30 s (as shipped, no gate)": metrics(rows.map(r => [r.gt30, r.ab30])),
  "AstroBone hybrid, 30 s, quality gate 0.3": metrics(rows.map(r => [r.gt30, r.ab30q >= 0.3 ? r.ab30 : null])),
  "AstroBone hybrid, 12 s (like for like)": metrics(rows.map(r => [r.gt12, r.ab12])),
  "Both answered: NeuroBridge": metrics(rows.filter(r => r.nb != null && r.ab12 != null).map(r => [r.gt12, r.nb])),
  "Both answered: AstroBone 12 s": metrics(rows.filter(r => r.nb != null && r.ab12 != null).map(r => [r.gt12, r.ab12])),
};
for (const step of ["before", "after"]) {
  const rs = rows.filter(r => r.id.endsWith(step));
  summary[`${step === "before" ? "Rest" : "After squats"}: NeuroBridge`] = metrics(rs.map(r => [r.gt12, r.nb]));
  summary[`${step === "before" ? "Rest" : "After squats"}: AstroBone 30 s`] = metrics(rs.map(r => [r.gt30, r.ab30]));
}
const meanGt = breath.reduce((s, b) => s + b.gt, 0) / (breath.length || 1);
summary.breathing = { recordings: breath.length, truth: "MCD-rPPG respiratory rate recorded once per session (method not stated in the dataset card)",
  "NeuroBridge head-motion breathing (last 30 s)": metrics(breath.map(b => [b.gt, b.nb])),
  "AstroBone breathingFromHead (60 s)": metrics(breath.map(b => [b.gt, b.ab])),
  "Guessing the dataset mean every time": metrics(breath.map(b => [b.gt, meanGt])) };
const reasons = {};
for (const r of rows) if (r.nb == null) reasons[r.nbReason] = (reasons[r.nbReason] ?? 0) + 1;
summary.neuroBridgeRefusals = reasons;
console.log(JSON.stringify(summary, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, rows, breath }, null, 1));
