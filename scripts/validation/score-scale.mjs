// Scale-up camera pulse validation (MCD-rPPG, every camera, at rest and after squats), scored with the app's own
// JavaScript: the self-check hybrid (src/cameraPulse.js fusedPulseFromSamples as shipped), ME-rPPG alone, and the
// Live Capture colour pulse (colourPulseFromSamples: the shipped gate, LIVE_PULSE, and the earlier 0.3). Also the Live Capture heart-rate variability
// (src/rppg.js estimateStress, RMSSD) on the first 60 s against the finger PPG's RMSSD over the same 60 s.
// Usage: node scripts/validation/score-scale.mjs <signals dir> <out.json>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fusedPulseFromSamples, colourPulseFromSamples } from "../../src/cameraPulse.js";
import { estimateStress } from "../../src/rppg.js";

const [dir, outFile] = process.argv.slice(2);
const windows = [], videos = [];
for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const frames = d.rgb.map((rgb, i) => ({ t: i * 1000 / d.fps, rgb: rgb && rgb.every(v => v !== null) ? rgb : null, bvp: d.me[i], motion: d.motion[i] ?? 1 }));
  for (const w of d.windows) {
    const seg = frames.filter(f => f.t >= w.t0 * 1000 && f.t < w.t1 * 1000);
    const opts = { windowSeconds: w.t1 - w.t0 + 1 };
    const hybrid = fusedPulseFromSamples(seg, opts);
    const meOnly = fusedPulseFromSamples(seg, { ...opts, weights: { me: 1, pos: 0, chrom: 0 } });
    const ungated = fusedPulseFromSamples(seg, { ...opts, minQuality: 0 });
    const live = colourPulseFromSamples(seg, opts);
    const liveOld = colourPulseFromSamples(seg, { ...opts, minQuality: 0.3 });
    const liveAll = colourPulseFromSamples(seg, { ...opts, minQuality: 0 });
    const est = r => (r.status === "estimated" ? r.bpmExact ?? r.bpm : null);
    windows.push({ id: d.id, person: d.person, camera: d.camera, state: d.state, t0: w.t0, gt: w.gt, gtQ: w.gt_q,
      hybrid: est(hybrid), hybridQ: hybrid.quality ?? 0, hybrid0: est(ungated), me: est(meOnly), live: est(live), liveOld: est(liveOld), live0: est(liveAll), liveQ: liveAll.quality ?? 0, liveReason: live.status === "estimated" ? null : live.reason });
  }
  // Live Capture's variability as it runs there: colour samples, the POS pulse rate, then estimateStress.
  const colour = frames.filter(f => f.rgb).map(f => ({ t: f.t, rgb: f.rgb, motion: f.motion }));
  const pulse = colourPulseFromSamples(colour, { windowSeconds: 61, minQuality: 0 });
  const stress = pulse.status === "estimated" ? estimateStress(colour, pulse.bpmExact ?? pulse.bpm) : { status: "insufficient", reason: pulse.reason };
  videos.push({ id: d.id, person: d.person, camera: d.camera, state: d.state, ita: d.ita, ref: d.ref,
    rmssd: stress.status === "estimated" ? stress.rmssdMs : null, rmssdReason: stress.status === "estimated" ? null : stress.reason });
}
writeFileSync(outFile, JSON.stringify({ windows, videos }));
console.log(`${videos.length} videos, ${windows.length} windows`);
