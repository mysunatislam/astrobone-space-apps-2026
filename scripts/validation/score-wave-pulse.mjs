// Scores the app's own JavaScript pulse estimators on exported real-video signals.
// Usage: node scripts/validation/score-wave-pulse.mjs <windows.json> <signals dir> <out.json>
// windows.json holds the contact-PPG heart rate of every 30 s window (from the offline evaluation);
// each signals/<id>.json holds one video's face colour, motion and pulse-wave signals.
// 'POS (app)' runs src/rppg.js estimatePulse exactly as the browser does; every pulse-wave method runs
// src/wavePulse.js estimateWavePulse. Nothing here is fitted to the reference.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { estimatePulse } from "../../src/rppg.js";
import { estimateWavePulse, estimateFusedPulse, colourWaves } from "../../src/wavePulse.js";
import { fusedPulseFromSamples, colourPulseFromSamples, FUSION_WEIGHTS } from "../../src/cameraPulse.js";

const [windowsFile, signalsDir, outFile] = process.argv.slice(2);
const evaluation = JSON.parse(readFileSync(windowsFile, "utf8"));
const rows = [];
const POS_WEIGHTS = [0, 0.1, 0.25, 0.5, 1];
const HYBRIDS = {
  "Hybrid: ME-rPPG + POS + CHROM": ["ME-rPPG web (ONNX)", "POS (JS)", "CHROM (JS)"],
  "Hybrid: POS + CHROM": ["POS (JS)", "CHROM (JS)"],
  "Hybrid: ME-rPPG + POS": ["ME-rPPG web (ONNX)", "POS (JS)"],
  "Hybrid: ME-rPPG + CHROM": ["ME-rPPG web (ONNX)", "CHROM (JS)"],
};
for (const video of evaluation.videos) {
  const path = `${signalsDir}/${video.id}.json`;
  if (!existsSync(path)) continue;
  const data = JSON.parse(readFileSync(path, "utf8"));
  for (const w of video.windows) {
    if (w.whole) continue;
    const row = { id: video.id, t0: w.t0, t1: w.t1, gt: w.gt, est: {} };
    const a = Math.round(w.t0 * data.fps), b = Math.round(w.t1 * data.fps);
    const colour = [];
    for (let i = a; i < b && i < data.n; i++) {
      const rgb = data.rgb[i];
      if (!rgb || rgb.some(v => v === null)) continue;
      colour.push({ t: i * 1000 / data.fps, rgb, motion: data.motion[i] ?? 1 });
    }
    const app = estimatePulse(colour);
    row.est["POS (app)"] = app.status === "estimated" ? { bpm: app.bpm, q: app.quality } : { bpm: null, q: app.quality ?? 0, reason: app.reason };
    // Live Capture as shipped (src/healthLayers.js): POS wave, validated gate; scored with the gate off for the sweep.
    const live = colourPulseFromSamples(colour, { minQuality: 0, windowSeconds: w.t1 - w.t0 + 1 });
    row.est["POS live (app)"] = { bpm: live.bpmExact ?? null, q: live.quality ?? 0, reason: live.status === "estimated" ? undefined : live.reason };
    for (const [name, signal] of Object.entries(data.signals)) {
      const fs = name.includes(".") ? 30 : data.fps; // open-rppg models emit 30 samples a second
      const samples = [];
      for (let i = Math.round(w.t0 * fs); i < Math.round(w.t1 * fs) && i < signal.length; i++) if (signal[i] !== null) samples.push({ t: i * 1000 / fs, v: signal[i] });
      const r = estimateWavePulse(samples, { windowSeconds: w.t1 - w.t0 + 1, minQuality: 0 });
      row.est[name] = { bpm: r.bpmExact ?? null, q: r.quality ?? 0 };
    }
    // Hybrids: spectral fusion of the browser-deployable waves (all from the same frames).
    const windowOf = name => {
      const signal = data.signals[name]; if (!signal) return null;
      const fs = name.includes(".") ? 30 : data.fps, samples = [];
      for (let i = Math.round(w.t0 * fs); i < Math.round(w.t1 * fs) && i < signal.length; i++) if (signal[i] !== null) samples.push({ t: i * 1000 / fs, v: signal[i] });
      return samples.length ? { name, samples } : null;
    };
    // POS and CHROM recomputed in JavaScript from the skin colour, exactly as the app computes them.
    const cw = colourWaves(colour);
    if (cw) {
      for (const [name, wave] of [["POS (JS)", cw.pos], ["CHROM (JS)", cw.chrom]]) {
        const r = estimateWavePulse(wave, { windowSeconds: w.t1 - w.t0 + 1, minQuality: 0 });
        row.est[name] = { bpm: r.bpmExact ?? null, q: r.quality ?? 0 };
      }
    }
    const jsWave = name => (name === "POS (JS)" ? (cw ? { name, samples: cw.pos } : null) : name === "CHROM (JS)" ? (cw ? { name, samples: cw.chrom } : null) : windowOf(name));
    for (const [label, members] of Object.entries(HYBRIDS)) {
      const waves = members.map(jsWave).filter(Boolean);
      if (waves.length !== members.length) continue;
      const r = estimateFusedPulse(waves, { windowSeconds: w.t1 - w.t0 + 1, minQuality: 0 });
      row.est[label] = { bpm: r.bpmExact ?? null, q: r.quality ?? 0 };
    }
    // The self-check exactly as shipped (src/cameraPulse.js): gates, then ME-rPPG-led fusion with POS.
    // The same code with other weights gives the first design (equal weights), the deep model alone,
    // and the POS-weight family the leave-one-person-out choice below picks from.
    const me = data.signals["ME-rPPG mesh box (app)"];
    if (me) {
      const shipped = [];
      for (let i = a; i < b && i < data.n; i++) {
        const rgb = data.rgb[i];
        shipped.push({ t: i * 1000 / data.fps, bvp: me[i] ?? null, rgb: rgb && rgb.every(v => v !== null) ? rgb : null, motion: data.motion[i] ?? 1 });
      }
      const run = weights => {
        const r = fusedPulseFromSamples(shipped, { weights, windowSeconds: w.t1 - w.t0 + 1, minQuality: 0 });
        return { bpm: r.bpmExact ?? null, q: r.quality ?? 0, reason: r.status === "estimated" ? undefined : r.reason };
      };
      row.est["Hybrid (app self-check)"] = run(FUSION_WEIGHTS);
      row.est["Fusion, equal weights (first design)"] = run({ me: 1, pos: 1, chrom: 1 });
      row.family = Object.fromEntries(POS_WEIGHTS.map(pos => [pos, run({ me: 1, pos, chrom: 0 })]));
      row.est["ME-rPPG + gates (app)"] = row.family[0];
    }
    rows.push(row);
  }
}

// The POS weight chosen without each person: picked on the other people's windows (lowest mean
// absolute error), then scored on that person's windows only, so the reported accuracy of the tuned
// hybrid is never measured on people it was tuned on.
const mcdRows = rows.filter(r => r.id.startsWith("mcd_") && r.family);
const personOf = r => r.id.split("_")[1];
const familyMae = (rs, pos) => { const e = rs.map(r => r.family[pos]).flatMap((x, i) => (Number.isFinite(x.bpm) ? [Math.abs(x.bpm - rs[i].gt)] : [])); return e.reduce((s, v) => s + v, 0) / e.length; };
const fusion = { posWeights: POS_WEIGHTS, shipped: FUSION_WEIGHTS, maeByPosWeight: Object.fromEntries(POS_WEIGHTS.map(pos => [pos, Number(familyMae(mcdRows, pos).toFixed(2))])), picks: {} };
for (const person of new Set(mcdRows.map(personOf))) {
  const others = mcdRows.filter(r => personOf(r) !== person);
  const best = POS_WEIGHTS.reduce((a, b) => (familyMae(others, b) < familyMae(others, a) ? b : a));
  fusion.picks[best] = (fusion.picks[best] ?? 0) + 1;
  for (const r of mcdRows) if (personOf(r) === person) r.est["Hybrid, weight chosen without this person"] = r.family[best];
}
for (const r of rows) delete r.family;

function metrics(pairs) {
  const ok = pairs.filter(([, e]) => Number.isFinite(e));
  if (ok.length < 2) return null;
  const err = ok.map(([g, e]) => e - g), n = err.length, mean = err.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(err.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const gs = ok.map(([g]) => g), es = ok.map(([, e]) => e), mg = gs.reduce((s, v) => s + v, 0) / n, me = es.reduce((s, v) => s + v, 0) / n;
  const r = gs.reduce((s, g, i) => s + (g - mg) * (es[i] - me), 0) / Math.sqrt(gs.reduce((s, g) => s + (g - mg) ** 2, 0) * es.reduce((s, e) => s + (e - me) ** 2, 0));
  const round = (v, d = 2) => Number(v.toFixed(d));
  return { n, coverage: round(100 * n / pairs.length, 1), mae: round(err.reduce((s, v) => s + Math.abs(v), 0) / n), rmse: round(Math.sqrt(err.reduce((s, v) => s + v * v, 0) / n)),
    bias: round(mean), loa: [round(mean - 1.96 * sd), round(mean + 1.96 * sd)], r: round(r, 3), within5: round(100 * err.filter(v => Math.abs(v) <= 5).length / n, 1) };
}

const datasets = [...new Set(rows.map(r => r.id.split("_")[0]))];
const names = [...new Set(rows.flatMap(r => Object.keys(r.est)))];
const summary = {};
for (const ds of datasets) {
  const rs = rows.filter(r => r.id.startsWith(ds));
  summary[ds] = { windows: rs.length, methods: {} };
  for (const name of names) {
    const all = metrics(rs.map(r => [r.gt, r.est[name]?.bpm]));
    // Quality-gate sweep: accuracy against the share of windows kept.
    const sweep = [0, 0.2, 0.3, 0.4, 0.5, 0.6].map(q => ({ minQuality: q, ...metrics(rs.map(r => [r.gt, (r.est[name]?.q ?? 0) >= q ? r.est[name]?.bpm : null])) }));
    summary[ds].methods[name] = { all, sweep };
  }
}
// Personal baseline (MCD): the same person at rest and right after squats, first 30 s window of each.
// What the app needs is the change against the person's own baseline, so the change is scored too.
const FLOOR = 8; // the app's resting-HR review floor (src/selfCheck.js INDICATORS.restingHr)
const first = new Map(rows.filter(r => r.t0 === 0 && r.id.startsWith("mcd_")).map(r => [r.id, r]));
const subjects = [...new Set([...first.keys()].map(id => id.split("_")[1]))].filter(s => first.has(`mcd_${s}_before`) && first.has(`mcd_${s}_after`));
const delta = {};
for (const name of names) {
  const pairs = subjects.map(s => {
    const b = first.get(`mcd_${s}_before`), a = first.get(`mcd_${s}_after`);
    return { id: s, gtBefore: b.gt, gtAfter: a.gt, estBefore: b.est[name]?.bpm ?? null, estAfter: a.est[name]?.bpm ?? null, qBefore: b.est[name]?.q ?? 0, qAfter: a.est[name]?.q ?? 0 };
  });
  const ok = pairs.filter(p => Number.isFinite(p.estBefore) && Number.isFinite(p.estAfter));
  if (ok.length < 3) continue;
  const gd = ok.map(p => p.gtAfter - p.gtBefore), ed = ok.map(p => p.estAfter - p.estBefore);
  const m = metrics(gd.map((g, i) => [g, ed[i]]));
  delta[name] = { n: ok.length, of: pairs.length, deltaMae: m.mae, deltaR: m.r, deltaBias: m.bias,
    directionAgreePct: Number((100 * gd.filter((g, i) => Math.sign(g) === Math.sign(ed[i])).length / ok.length).toFixed(1)),
    flagAgreePct: Number((100 * gd.filter((g, i) => (g >= FLOOR) === (ed[i] >= FLOOR)).length / ok.length).toFixed(1)), pairs };
}
writeFileSync(outFile, JSON.stringify({ summary, delta, fusion, rows }, null, 1));
console.log("== POS weight in the self-check fusion: MAE by weight", fusion.maeByPosWeight, "chosen without each person:", fusion.picks);
console.log(`== personal baseline: rest vs after squats (${subjects.length} people)`);
for (const [name, d] of Object.entries(delta).sort((a, b) => a[1].deltaMae - b[1].deltaMae)) console.log(`  ${name.padEnd(30)} change MAE ${d.deltaMae}  r ${d.deltaR}  direction ${d.directionAgreePct}%  >=${FLOOR} bpm flag agrees ${d.flagAgreePct}%  n ${d.n}/${d.of}`);
for (const [ds, s] of Object.entries(summary)) {
  console.log(`== ${ds} (${s.windows} windows of 30 s)`);
  for (const [name, m] of Object.entries(s.methods).sort((a, b) => (a[1].all?.mae ?? 1e9) - (b[1].all?.mae ?? 1e9))) {
    if (!m.all) { console.log(`  ${name.padEnd(22)} no estimates`); continue; }
    const g = m.sweep.find(x => x.minQuality === 0.3);
    console.log(`  ${name.padEnd(22)} MAE ${String(m.all.mae).padStart(6)}  r ${String(m.all.r).padStart(6)}  <=5 ${String(m.all.within5).padStart(5)}%  cov ${m.all.coverage}%  | q>=0.3: MAE ${g?.mae} cov ${g?.coverage}%`);
  }
}
