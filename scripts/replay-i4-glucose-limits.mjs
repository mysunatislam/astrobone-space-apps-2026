// Replays the self-check's fixed blood-sugar safety limits on the real Inspiration4 crew glucose
// (NASA OSDR OSD-575, comprehensive metabolic panel, 4 crew x 7 draws) shipped in public/data.
// Question: how often would a fixed limit fire on real crew draws, and would the personal baseline
// have said the same? Usage: node scripts/replay-i4-glucose-limits.mjs
import { readFileSync } from "node:fs";
import { safetyLimit, evaluateIndicator } from "../src/selfCheck.js";

export function replayGlucoseLimits(data) {
  const rows = [];
  for (const crew of data.crew) {
    const series = data.series[crew].glucose, history = [];
    for (const [visit, value, low, high] of series) {
      const limit = safetyLimit("glucose", value);
      const personal = evaluateIndicator("glucose", value, history, { limits: {} });
      rows.push({ crew, visit, value, labRange: [low, high], limit: limit?.level ?? null, bound: limit?.text ?? null, personal: personal.status });
      history.push({ values: { glucose: value } });
    }
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL("../public/data/i4-crew-blood.json", import.meta.url)));
  const rows = replayGlucoseLimits(data), fired = rows.filter(r => r.limit);
  for (const r of rows) console.log(`${r.crew} ${r.visit.padEnd(6)} ${String(r.value).padStart(4)} mg/dL  limit ${r.limit ?? "-"}${r.bound ? ` (${r.bound})` : ""}  personal ${r.personal}`);
  console.log(`\n${fired.length} of ${rows.length} draws cross a fixed limit: ${fired.map(r => `${r.crew} ${r.visit} ${r.value}`).join(", ")}`);
}
