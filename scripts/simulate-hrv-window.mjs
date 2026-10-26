// How far do short-window HRV numbers sit from the 5-minute value they stand in for?
// Synthetic beat-interval series (72 bpm, breathing-linked swing plus AR(1) noise) at three HRV levels;
// each short window is the start of a 360-beat (5-minute) record. Run: node scripts/simulate-hrv-window.mjs
import { baevskyStressIndex } from "../src/rppg.js";

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const rmssd = ms => Math.sqrt(mean(ms.slice(1).map((v, i) => (v - ms[i]) ** 2)));
const label = x => (x < 150 ? "low" : x < 500 ? "elevated" : "high");
const quantile = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
function series(n, swing, noise) {
  const out = []; let ar = 0;
  for (let i = 0; i < n; i++) { ar = 0.6 * ar + noise * gauss(); out.push(833 + swing * Math.sin(2 * Math.PI * i * 0.25 * 0.833) + ar); }
  return out;
}

const runs = 2000, windows = [35, 70, 150, 300];
console.log("HRV level | beats (time) | SI label agrees with 5 min | SI ratio p5-p95 | RMSSD ratio p5-p95");
for (const [name, swing, noise] of [["high", 40, 25], ["medium", 20, 12], ["low", 8, 5]]) {
  const records = Array.from({ length: runs }, () => series(360, swing, noise));
  for (const beats of windows) {
    let agree = 0; const si = [], rm = [];
    for (const long of records) {
      const short = long.slice(0, beats), siLong = baevskyStressIndex(long), siShort = baevskyStressIndex(short);
      if (label(siShort) === label(siLong)) agree++;
      si.push(siShort / siLong); rm.push(rmssd(short) / rmssd(long));
    }
    console.log(`${name} | ${beats} (${Math.round(beats * 0.833)} s) | ${(agree / runs * 100).toFixed(1)}% | ${quantile(si, .05).toFixed(2)}-${quantile(si, .95).toFixed(2)} | ${quantile(rm, .05).toFixed(2)}-${quantile(rm, .95).toFixed(2)}`);
  }
}
