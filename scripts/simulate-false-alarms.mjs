// How often does a healthy, unchanging astronaut get told something changed? Simulates daily self-checks
// of every indicator for stable astronauts (each with their own usual level and Gaussian day-to-day
// spread) and runs the app's own evaluateSelfCheck on them. A real step change is then added to one
// indicator to see whether the rules still catch it.
// --single runs the original single-value rule instead, for comparison.
// --assumed-knee uses the knee spreads assumed before they were measured on real video, and
// --previous-spreads the heart rate, blood pressure, sleep and temperature spreads guessed before the published ones.
// --change=key:shift adds a step change on day 31 to the detection list (e.g. --change=sleepHours:-1).
// --seed=N runs a different set of simulated astronauts (0 is the set the app's numbers come from), to see
// how much the figures move by chance.
// --sd=key:value sets one reading's day-to-day spread (for attention lapses, a spread above Poisson's makes the
// count overdispersed), and --sensitivity reruns the figures with the spreads that are still assumed halved,
// doubled and at the reaction test's published upper bound, to show how much the figures hang on them.
// Usage: node scripts/simulate-false-alarms.mjs [--runs=1000] [--days=60] [--spread=1] [--single] [--assumed-knee] [--previous-spreads] [--change=key:shift] [--seed=N] [--sd=key:value] [--sensitivity] [--json]
import { evaluateSelfCheck, INDICATORS, KNEE_REPEAT_NOISE } from "../src/selfCheck.js";

const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? Number(hit.split("=")[1]) : fallback; };
const RUNS = arg("runs", 1000), DAYS = arg("days", 60), SPREAD = arg("spread", 1), SEED = arg("seed", 0);
export const singleValueRule = (check, history) => evaluateSelfCheck(check, history, { multirule: false });

// Usual level and day-to-day spread (1 SD) of a healthy astronaut, stated so they can be argued with.
// Measured or published:
// - knee: the camera's repeat noise on real video (KNEE_REPEAT_NOISE; ASSUMED_KNEE_SD was assumed before);
// - heart rate and blood pressure: within-person SD of one seated home reading each morning, Ohasama study
//   (Kikuya et al., Hypertension 2008;52:1045-50, 2,455 adults): systolic 8.6 and diastolic 6.4 mmHg (means),
//   heart rate 5.4 bpm (the middle cut-off of its Figure 1). The app averages two readings, so these are cautious;
//   wearables read resting heart rate steadier (about 3 bpm, Quer et al., PLoS ONE 2020;15:e0227709);
// - sleep: night-to-night SD of diary sleep duration, 85.8 min (Messman et al., J Sleep Res 2022;31:e13680,
//   8 studies, 2,404 people);
// - glucose: the EFLM within-person CV of 4.9 % plus about 4 % for a home meter;
// - temperature: SD of seven morning home oral readings over two weeks, 0.31 °C (Diamond et al., PLoS ONE
//   2021;16:e0245257, 96 adults; a later correction notice, e0259428, could not be read here).
// Oxygen saturation is an assumption that fits the 1.2 % change needed to show a real change in 10 healthy
// adults at rest (Wagener and Hendricker, Chest 1987;92:1047-9). The reaction test's usual levels are the
// PVT-B means of 45 adults from a "high performing astronaut surrogate population" who took it 16 times
// (Basner et al., Sleep 2018;41:zsx187, Table 2: response speed 4.52/s, 0.98 lapses), with no systematic change
// in either over the 16 tests. Its within-person spread is still an assumption: that paper's SDs (0.41/s, 1.61
// lapses) are across all its tests and people together, and lapses are taken as Poisson. The ratings are
// assumptions too: the pooled daily-life studies checked (Scott et al., Assessment 2020; Kraft et al., Emotion
// 2026) give shares of variance or within-day spreads, not a day-to-day spread in scale points.
// PREVIOUS_SPREADS are the guesses these replaced (--previous-spreads). `round` mimics how each value is entered.
export const ASSUMED_KNEE_SD = Object.freeze({ kneeExtension: 3, kneeRom: 4 });
export const PREVIOUS_SPREADS = Object.freeze({ restingHr: 4, systolicBp: 6, diastolicBp: 4.5, sleepHours: 0.9, bodyTemp: 0.25 });
export const STABLE_PERSON = Object.freeze({
  kneeExtension: { mean: 165, sd: KNEE_REPEAT_NOISE.kneeExtension.sd, round: 1 },
  kneeRom: { mean: 65, sd: KNEE_REPEAT_NOISE.kneeRom.sd, round: 1 },
  restingHr: { mean: 62, sd: 5.4, round: 1 },
  systolicBp: { mean: 116, sd: 8.6, round: 1 },
  diastolicBp: { mean: 75, sd: 6.4, round: 1 },
  spo2: { mean: 98, sd: 0.8, round: 1, max: 100 },
  glucose: { mean: 90, sd: 5.7, round: 1 },
  bodyTemp: { mean: 36.7, sd: 0.31, round: 0.1 },
  pvtSpeed: { mean: 4.52, sd: 0.15, round: 0.01 },
  pvtLapses: { poisson: 0.98 },
  sleepHours: { mean: 6.8, sd: 85.8 / 60, round: 0.5, min: 0 },
  fatigue: { mean: 3, sd: 0.8, round: 1, min: 1, max: 7 },
  mood: { mean: 7, sd: 1, round: 1, min: 0, max: 10 },
  stress: { mean: 4, sd: 1.2, round: 1, min: 0, max: 10 },
});

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gaussian = random => { let u = 0; while (!u) u = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()); };
const poisson = (random, lambda) => { let k = 0, p = 1; const l = Math.exp(-lambda); do { k++; p *= random(); } while (p > l); return k - 1; };
// Gamma(shape, 1) by Marsaglia and Tsang (ACM TOMS 2000), with the shape < 1 boost.
function gamma(random, shape) {
  if (shape < 1) return gamma(random, shape + 1) * random() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gaussian(random); v = 1 + c * x; } while (v <= 0);
    v = v ** 3; const u = random();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
// A count with mean `mean` and SD `sd`: Poisson when sd is at most sqrt(mean), otherwise a gamma-Poisson
// (negative binomial) mixture with that variance.
const count = (random, mean, sd) => {
  if (!(sd ** 2 > mean)) return poisson(random, mean);
  const shape = mean ** 2 / (sd ** 2 - mean);
  return poisson(random, gamma(random, shape) * mean / shape);
};

function sample(spec, random, spread, shift = 0) {
  if (spec.poisson) return spec.sd ? count(random, spec.poisson + shift, spec.sd) : poisson(random, spec.poisson + shift);
  let v = spec.mean + shift + spec.sd * spread * gaussian(random);
  v = Math.round(v / spec.round) * spec.round;
  if (spec.min !== undefined) v = Math.max(spec.min, v);
  if (spec.max !== undefined) v = Math.min(spec.max, v);
  return Number(v.toFixed(2));
}

// One astronaut's daily checks. `change` = { key, day, shift } adds a real step change from that day.
// Each indicator draws from its own random stream, so changing how one indicator is simulated does not
// reshuffle the values of the others.
export function simulateAstronaut(seed, { days = DAYS, spread = SPREAD, change = null, evaluate = evaluateSelfCheck, person = STABLE_PERSON } = {}) {
  const streams = Object.fromEntries(Object.keys(person).map((key, j) => [key, rng(seed * 64 + j + 1)])), history = [], out = [];
  for (let day = 1; day <= days; day++) {
    const values = {};
    for (const [key, spec] of Object.entries(person)) values[key] = sample(spec, streams[key], spread, change && key === change.key && day >= change.day ? change.shift : 0);
    const keys = Object.keys(values);
    const check = { id: `sim-${seed}-${day}`, missionDay: day, at: `day ${day}`, values, protocols: Object.fromEntries(keys.map(k => [k, "sim"])), quality: Object.fromEntries(keys.map(k => [k, true])), redFlags: {}, symptoms: {} };
    const ev = evaluate(check, history);
    out.push({ day, ev });
    history.push(check);
  }
  return out;
}

const rows = ev => ev.domains.flatMap(d => d.indicators);
const REVIEW_OR_WORSE = new Set(["changed", "attention", "urgent"]);
const RECHECK_OR_WORSE = new Set(["recheck", ...REVIEW_OR_WORSE]);

export function falseAlarmSummary({ runs = RUNS, days = DAYS, spread = SPREAD, evaluate, person, seed = SEED } = {}) {
  let checks = 0, review = 0, recheck = 0, changedRows = 0, limitChecks = 0, driftRuns = 0, debtRuns = 0;
  const byKey = Object.fromEntries(Object.keys(INDICATORS).map(k => [k, 0]));
  for (let i = 0; i < runs; i++) {
    let drifted = false, indebted = false;
    for (const { day, ev } of simulateAstronaut(1000 + 10000 * seed + i, { days, spread, evaluate, person })) {
      if (day <= 5) continue; // baselines are still being built
      checks++;
      if (REVIEW_OR_WORSE.has(ev.overall)) review++;
      if (RECHECK_OR_WORSE.has(ev.overall)) recheck++;
      if (rows(ev).some(r => r.limit)) limitChecks++;
      for (const r of rows(ev)) if (r.status === "changed") { changedRows++; byKey[r.key]++; if (r.reason === "drift") drifted = true; if (r.reason === "debt") indebted = true; }
    }
    if (drifted) driftRuns++;
    if (indebted) debtRuns++;
  }
  const pct = x => Number((100 * x).toFixed(1));
  return {
    runs, days, spread, checksJudged: checks,
    reviewOrWorsePct: pct(review / checks),
    recheckOrWorsePct: pct(recheck / checks),
    changedRowsPerCheck: Number((changedRows / checks).toFixed(2)),
    fixedLimitPct: pct(limitChecks / checks),
    astronautsWithDriftAlarmPct: pct(driftRuns / runs),
    astronautsWithSleepDebtReviewPct: pct(debtRuns / runs),
    changedPctByIndicator: Object.fromEntries(Object.entries(byKey).map(([k, n]) => [k, pct(n / checks)])),
  };
}

// Share of astronauts whose changed indicator is flagged on the first check after a real step change,
// within the first three checks, and within two weeks of daily checks.
export function detectionSummary(change, { runs = RUNS, days = DAYS, spread = SPREAD, evaluate, person, seed = SEED } = {}) {
  let first = 0, within3 = 0, within14 = 0;
  for (let i = 0; i < runs; i++) {
    const flagged = simulateAstronaut(5000 + 10000 * seed + i, { days, spread, change, evaluate, person })
      .filter(({ day }) => day >= change.day && day < change.day + 14)
      .map(({ ev }) => rows(ev).find(r => r.key === change.key)?.status)
      .map(s => REVIEW_OR_WORSE.has(s));
    if (flagged[0]) first++;
    if (flagged.slice(0, 3).some(Boolean)) within3++;
    if (flagged.some(Boolean)) within14++;
  }
  const pct = n => Number((100 * n / runs).toFixed(1));
  return { ...change, firstCheckPct: pct(first), withinThreeChecksPct: pct(within3), withinTwoWeeksPct: pct(within14) };
}

export const STEP_CHANGES = Object.freeze([
  { key: "kneeExtension", day: 31, shift: -10, label: "knee extension 10° lower" },
  { key: "systolicBp", day: 31, shift: 20, label: "systolic 20 mmHg higher" },
  { key: "glucose", day: 31, shift: 20, label: "fasting blood sugar 20 mg/dL higher" },
  { key: "sleepHours", day: 31, shift: -2, label: "2 hours less sleep" },
  { key: "pvtLapses", day: 31, shift: 6, label: "6 more attention lapses" },
]);

// The readings whose day-to-day spread is still an assumption (docs/self-check.md). For the reaction test there
// is an upper bound: Basner et al. 2018 (Table 2) give SDs of 0.41/s for speed and 1.61 for lapses across all 16
// tests of all 45 people. Those SDs hold the differences between people as well as each person's own day-to-day
// change, so one person's spread should not be larger, apart from chance.
export const ASSUMED_SPREADS = Object.freeze(["spo2", "pvtSpeed", "pvtLapses", "fatigue", "mood", "stress"]);
export const PVT_POOLED_SD = Object.freeze({ pvtSpeed: 0.41, pvtLapses: 1.61 });
export const SENSITIVITY_SCENARIOS = Object.freeze([
  { name: "as shipped" },
  { name: "assumed spreads halved (lapses stay Poisson)", factor: 0.5 },
  { name: "assumed spreads doubled (lapses at their upper bound)", factor: 2 },
  { name: "reaction test at its published upper bound", sds: PVT_POOLED_SD },
]);
// A stable person with the assumed spreads scaled by `factor` and/or set by `sds` ({ key: sd }).
export function personWithSpreads({ factor = 1, sds = {} } = {}, base = STABLE_PERSON) {
  const person = { ...base };
  if (factor !== 1) for (const key of ASSUMED_SPREADS) {
    const spec = base[key];
    person[key] = spec.poisson ? (factor > 1 ? { ...spec, sd: PVT_POOLED_SD.pvtLapses } : spec) : { ...spec, sd: Number((spec.sd * factor).toFixed(3)) };
  }
  for (const [key, sd] of Object.entries(sds)) person[key] = { ...person[key], sd };
  return person;
}
const spreadOf = spec => spec.sd ?? Number(Math.sqrt(spec.poisson).toFixed(2));
// How much the shown figures hang on the spreads that are still assumed. Only the attention-lapse change among
// the shown detection figures uses an assumed spread; each reading has its own random stream, so the others
// do not move at all.
export function assumptionSensitivity({ runs = RUNS, detectionRuns = Math.min(RUNS, 400), seed = SEED, scenarios = SENSITIVITY_SCENARIOS } = {}) {
  const lapses = STEP_CHANGES.find(c => c.key === "pvtLapses");
  return scenarios.map(scenario => {
    const person = personWithSpreads(scenario), stable = falseAlarmSummary({ runs, person, seed }), found = detectionSummary(lapses, { runs: detectionRuns, person, seed });
    return {
      name: scenario.name, spreads: Object.fromEntries(ASSUMED_SPREADS.map(k => [k, spreadOf(person[k])])),
      reviewPct: stable.reviewOrWorsePct, recheckPct: stable.recheckOrWorsePct, fixedLimitPct: stable.fixedLimitPct,
      assumedChangedPct: Object.fromEntries(ASSUMED_SPREADS.map(k => [k, stable.changedPctByIndicator[k]])),
      lapsesWithinThree: found.withinThreeChecksPct, lapsesWithinTwoWeeks: found.withinTwoWeeksPct,
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const evaluate = process.argv.includes("--single") ? singleValueRule : evaluateSelfCheck;
  const withSpreads = spreads => Object.fromEntries(Object.entries(spreads).map(([k, sd]) => [k, { ...STABLE_PERSON[k], sd }]));
  const setSds = Object.fromEntries(process.argv.filter(a => a.startsWith("--sd=")).map(a => { const [key, sd] = a.slice(5).split(":"); return [key, Number(sd)]; }));
  const person = personWithSpreads({ sds: setSds }, { ...STABLE_PERSON, ...(process.argv.includes("--assumed-knee") ? withSpreads(ASSUMED_KNEE_SD) : {}), ...(process.argv.includes("--previous-spreads") ? withSpreads(PREVIOUS_SPREADS) : {}) });
  if (process.argv.includes("--sensitivity")) {
    const rows = assumptionSensitivity();
    if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) {
      console.log(`${r.name}: ${Object.entries(r.spreads).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      console.log(`  REVIEW or worse ${r.reviewPct}% of checks, RE-CHECK or worse ${r.recheckPct}%, fixed limit ${r.fixedLimitPct}%; changed rows (% of checks): ${Object.entries(r.assumedChangedPct).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      console.log(`  6 more attention lapses flagged within 3 checks ${r.lapsesWithinThree}%, within 14 ${r.lapsesWithinTwoWeeks}%`);
    }
    process.exit(0);
  }
  const changed = Object.keys(person).filter(k => person[k] !== STABLE_PERSON[k]);
  const extra = process.argv.filter(a => a.startsWith("--change=")).map(a => { const [key, shift] = a.slice(9).split(":"); return { key, day: 31, shift: Number(shift), label: `${key} ${shift}` }; });
  const result = { rule: evaluate === singleValueRule ? "single value" : "multirule", stable: falseAlarmSummary({ evaluate, person }), detection: [...STEP_CHANGES, ...extra].map(c => detectionSummary(c, { runs: Math.min(RUNS, 400), evaluate, person })) };
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    const s = result.stable;
    console.log(`Rule: ${result.rule}${changed.length ? `, earlier guessed spreads for ${changed.join(", ")}` : ""}. Stable astronauts: ${s.runs} x ${s.days} days, spread x${s.spread}, ${s.checksJudged} checks judged after the first 5`);
    console.log(`  REVIEW or worse: ${s.reviewOrWorsePct}% of checks (RE-CHECK or worse ${s.recheckOrWorsePct}%); ${s.changedRowsPerCheck} changed rows per check; fixed limit crossed on ${s.fixedLimitPct}%; drift alarm in ${s.astronautsWithDriftAlarmPct}% of astronauts; sleep-debt review in ${s.astronautsWithSleepDebtReviewPct}%`);
    console.log(`  Changed rows by indicator (% of checks): ${Object.entries(s.changedPctByIndicator).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const d of result.detection) console.log(`  Real change, ${d.label}: flagged on the first check ${d.firstCheckPct}%, within 3 checks ${d.withinThreeChecksPct}%, within 14 ${d.withinTwoWeeksPct}%`);
  }
}
