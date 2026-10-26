// Monte Carlo check of the self-check review rules on synthetic daily knee-extension series.
// Compares the rolling-baseline rule alone ("day") with the rule plus CUSUM drift against the locked
// baseline ("day + drift"): false alarms on a stable astronaut, and days to detect a gradual decline
// or a step drop. Measurement noise is Gaussian; this tests the rules, not the camera.
// Usage: node scripts/simulate-detection.mjs [--runs=1000] [--noise=2] [--floor=5] [--k=1 --h=6] [--reset]
import { evaluateIndicator, INDICATORS } from "../src/selfCheck.js";

const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? Number(hit.split("=")[1]) : fallback; };
const runs = arg("runs", 1000), noise = arg("noise", 2), floor = arg("floor", INDICATORS.kneeExtension.floor);
const driftParams = process.argv.some(a => a.startsWith("--k=")) ? { k: arg("k"), h: arg("h"), reset: process.argv.includes("--reset") } : undefined;
const DAYS = 180, START = 170, PROTOCOL = "sim";

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gaussian(random) { let u = 0; while (!u) u = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()); }

// Returns the first day each rule flags (null if never), plus flagged-day counts.
function run(trueValue, seed) {
  const random = rng(seed), history = [];
  const first = { day: null, any: null }, flagged = { day: 0, any: 0 }, confirmed = { day: null, any: null }, prev = { day: false, any: false };
  for (let d = 0; d < DAYS; d++) {
    const value = trueValue(d) + noise * gaussian(random);
    const r = evaluateIndicator("kneeExtension", value, history, { protocol: PROTOCOL, floor, drift: driftParams });
    const now = { any: r.status === "changed", day: r.status === "changed" && r.reason === "day" };
    for (const rule of ["day", "any"]) {
      if (now[rule]) { flagged[rule]++; first[rule] ??= d; if (prev[rule]) confirmed[rule] ??= d; }
      prev[rule] = now[rule];
    }
    history.push({ values: { kneeExtension: value }, protocols: { kneeExtension: PROTOCOL }, quality: { kneeExtension: true } });
  }
  return { first, flagged, confirmed };
}

const pct = x => `${(100 * x).toFixed(1)}%`;
const median = xs => { const s = xs.filter(x => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function scenario(name, trueValue, onset = 0) {
  const results = Array.from({ length: runs }, (_, i) => run(trueValue, 1000 + i));
  const summary = {};
  for (const rule of ["day", "any"]) {
    const firsts = results.map(r => r.first[rule]);
    const detected = firsts.filter(d => d !== null && d >= onset);
    summary[rule] = {
      everFlagged: pct(results.filter(r => r.first[rule] !== null).length / runs),
      flaggedBeforeOnset: onset ? pct(results.filter(r => r.first[rule] !== null && r.first[rule] < onset).length / runs) : null,
      detected: pct(detected.length / runs),
      medianDaysToDetect: median(detected.map(d => d - onset)),
      flaggedDays: pct(results.reduce((s, r) => s + r.flagged[rule], 0) / (runs * DAYS)),
      // A flag that is still there on the 24 h re-check.
      confirmedBeforeOnsetOrEver: pct(results.filter(r => r.confirmed[rule] !== null && (!onset || r.confirmed[rule] < onset)).length / runs),
      // Share of runs with a confirmed flag after onset and none before it.
      confirmedDetected: onset ? pct(results.filter(r => r.confirmed[rule] !== null && r.confirmed[rule] >= onset).length / runs) : null,
      medianDaysToConfirmedDetection: median(results.map(r => r.confirmed[rule]).filter(d => d !== null && d >= onset).map(d => d - onset)),
    };
  }
  return { name, ...summary };
}

const ONSET = 30;
const rows = [
  scenario("Stable (no true change)", () => START),
  scenario("Gradual decline 2°/month from day 30", d => START - Math.max(0, d - ONSET) * 2 / 30, ONSET),
  scenario("Gradual decline 4°/month from day 30", d => START - Math.max(0, d - ONSET) * 4 / 30, ONSET),
  scenario("Step drop of 8° on day 30", d => START - (d >= ONSET ? 8 : 0), ONSET),
];
console.log(JSON.stringify({ runs, noiseSdDegrees: noise, days: DAYS, floorDegrees: floor, rules: { day: "rolling baseline only", any: "rolling baseline + CUSUM drift" }, rows }, null, 2));
