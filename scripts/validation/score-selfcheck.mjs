// The self-check's camera minute on new people, scored with the app's own JavaScript: clips cut like the self-check
// (mcd_selfcheck_export.py: 42 s after a 3 s settle), read the earlier way (the last 30 s, gate 0.3, any light out of
// range refused) and the shipped way (SELF_CHECK_READ: all 42 s, gate 0.25, light named only when the pulse is unclear),
// each against the finger PPG over the span it read. The gate is chosen on half of the people (every other id, sorted)
// and checked on the other half.
// Usage: node scripts/validation/score-selfcheck.mjs <clips dir> <out.csv>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fusedPulseFromSamples, SELF_CHECK_READ } from "../../src/cameraPulse.js";

const [dir, outFile] = process.argv.slice(2);
const clips = [];
for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const frames = d.rgb.map((rgb, i) => ({ t: i * 1000 / d.fps, rgb: rgb && rgb.every(v => v !== null) ? rgb : null, bvp: d.me[i], motion: d.motion[i] ?? 1 }));
  for (const c of d.clips) {
    const seg = frames.filter(f => f.t >= c.t0 * 1000 && f.t < c.t1 * 1000);
    const est = r => (r.status === "estimated" ? r.bpmExact : null);
    const open = fusedPulseFromSamples(seg, { ...SELF_CHECK_READ, minQuality: 0 });
    clips.push({ person: d.person, camera: d.camera, earlier: est(fusedPulseFromSamples(seg)), earlierRef: c.gt30,
      shipped: est(fusedPulseFromSamples(seg, SELF_CHECK_READ)), open: est(open), openQ: open.quality ?? 0, ref: c.gt });
  }
}
const people = [...new Set(clips.map(c => c.person))].sort(), choose = new Set(people.filter((_, i) => i % 2 === 0));
const CAM = { FullHDwebcam: "front webcam", IriunWebcam: "phone camera (Iriun)", USBVideo: "side USB camera" };
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
function row(half, camera, read, gate, set, pick) {
  const e = set.map(pick).filter(p => p && p[0] !== null).map(([v, ref]) => Math.abs(v - ref));
  return { half, camera, read, gate, people: new Set(set.map(c => c.person)).size, clips: set.length, answered_pct: r1(100 * e.length / Math.max(1, set.length)),
    mae_bpm: e.length ? r2(e.reduce((a, b) => a + b, 0) / e.length) : "", within_5_bpm_pct: e.length ? r1(100 * e.filter(x => x <= 5).length / e.length) : "",
    over_10_bpm: e.filter(x => x > 10).length, max_error_bpm: e.length ? r1(Math.max(...e)) : "" };
}
const rows = [];
for (const [half, inHalf] of [["choose", c => choose.has(c.person)], ["check", c => !choose.has(c.person)], ["all", () => true]]) {
  for (const cam of [...Object.keys(CAM), null]) {
    const set = clips.filter(c => inHalf(c) && (cam === null || c.camera === cam)), camera = cam ? CAM[cam] : "all three";
    rows.push(row(half, camera, "earlier: last 30 s", 0.3, set, c => [c.earlier, c.earlierRef]));
    rows.push(row(half, camera, "shipped: all 42 s", SELF_CHECK_READ.minQuality, set, c => [c.shipped, c.ref]));
    for (const g of [0, 0.2, 0.22, 0.25, 0.27, 0.3]) rows.push(row(half, camera, "sweep: all 42 s", g, set, c => [c.openQ >= g ? c.open : null, c.ref]));
  }
}
const cols = Object.keys(rows[0]);
writeFileSync(outFile, [cols.join(","), ...rows.map(r => cols.map(k => r[k]).join(","))].join("\n") + "\n");
console.log(`${people.length} people, ${clips.length} clips`);
for (const r of rows.filter(r => r.camera === "all three" && !r.read.startsWith("sweep"))) console.log(r);
