import { KNEE_PER_PERSON, PULSE_METHODS, REAL_DATA_VALIDATION } from "./realDataValidation.js";
import { SIMULATED_RELIABILITY } from "./selfCheck.js";

// "Proof at a glance" on the Evidence view: three small SVG charts drawn from the same saved results the
// text lines quote, so a judge can see the evidence before reading it. Plain strings so they can be
// tested without a DOM. Every mark has a <title> (hover tooltip and screen-reader text) and every chart
// has a table version under it. Colours are classes styled in twin.css: "ours" is cyan, the comparison
// is grey, and the text stays in the ink colours.

const W = 400;
// Short bar labels for the simulated changes; the tooltip and table keep the full wording.
const SHORT = { kneeExtension: "Knee 10° lower", pvtLapses: "6 more lapses", systolicBp: "Systolic +20 mmHg", glucose: "Fasting sugar +20 mg/dL", sleepHours: "2 h less sleep" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const svg = (height, label, body) => `<svg class="ev-chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}">${body}</svg>`;
const fmt = (v, d = 1) => Number(v).toFixed(d);

// Grid lines and tick labels along the x axis.
function axis(x, ticks, top, bottom, unit) {
  return ticks.map(t => `<line class="ev-grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${bottom}"/><text class="ev-tick" x="${x(t)}" y="${bottom + 13}" text-anchor="middle">${t}${unit}</text>`).join("");
}

// Knee: each person's range-of-motion error before (grey) and after (cyan) the hybrid knee model.
export function kneeDumbbell(rows = KNEE_PER_PERSON) {
  const left = 34, right = W - 44, top = 22, step = 20, bottom = top + rows.length * step;
  const x = v => left + (v / 30) * (right - left);
  const marks = rows.map((r, i) => {
    const y = top + i * step + step / 2;
    return `<g class="ev-row"><title>Person ${r.person}: ${fmt(r.before)}° before, ${fmt(r.after)}° after</title>`
      + `<rect class="ev-hit" x="0" y="${y - step / 2}" width="${W}" height="${step}"/>`
      + `<text class="ev-label" x="${left - 8}" y="${y + 4}" text-anchor="end">P${r.person}</text>`
      + `<line class="ev-link" x1="${x(r.after)}" x2="${x(r.before)}" y1="${y}" y2="${y}"/>`
      + `<circle class="ev-before" cx="${x(r.before)}" cy="${y}" r="5"/><circle class="ev-ours" cx="${x(r.after)}" cy="${y}" r="5"/>`
      + `<text class="ev-value" x="${x(r.after) - 9}" y="${y + 4}" text-anchor="end">${fmt(r.after)}</text>`
      + `<text class="ev-value ev-dim" x="${x(r.before) + 9}" y="${y + 4}">${fmt(r.before)}</text></g>`;
  }).join("");
  const legend = `<circle class="ev-before" cx="${left}" cy="9" r="4.5"/><text class="ev-label" x="${left + 9}" y="13">Before (pose model alone)</text>`
    + `<circle class="ev-ours" cx="${left + 178}" cy="9" r="4.5"/><text class="ev-label" x="${left + 187}" y="13">AstroBone hybrid</text>`;
  const k = REAL_DATA_VALIDATION.knee;
  return svg(bottom + 20, `Knee range-of-motion error for each of ${rows.length} people: ${k.romErrorBefore}° on average before, ${k.romErrorAfter}° with the hybrid model; lower for all ${k.improvedPeople}.`,
    legend + axis(x, [0, 10, 20, 30], top, bottom, "°") + marks);
}

// Camera pulse: average error by method, lower is better; AstroBone's rows in cyan.
export function pulseBars(rows = PULSE_METHODS) {
  const left = 168, right = W - 40, top = 6, step = 22, bottom = top + rows.length * step;
  const x = v => left + (v / 20) * (right - left);
  const marks = rows.map((r, i) => {
    const y = top + i * step;
    return `<g class="ev-row"><title>${esc(r.label)}: ${fmt(r.mae, 2)} bpm average error</title>`
      + `<rect class="ev-hit" x="0" y="${y}" width="${W}" height="${step}"/>`
      + `<text class="ev-label${r.ours ? " ev-strong" : ""}" x="${left - 8}" y="${y + 15}" text-anchor="end">${esc(r.label)}</text>`
      + `<rect class="${r.ours ? "ev-ours" : "ev-before"}" x="${left}" y="${y + 4}" width="${Math.max(2, x(r.mae) - left)}" height="${step - 8}" rx="3"/>`
      + `<text class="ev-value" x="${x(r.mae) + 6}" y="${y + 15}">${fmt(r.mae, 1)}</text></g>`;
  }).join("");
  const p = REAL_DATA_VALIDATION.pulse;
  return svg(bottom + 20, `Camera pulse average error by method on ${p.people} people, beats per minute, lower is better: AstroBone ${fmt(rows[0].mae, 1)}, the best of ${rows.length} shown.`,
    axis(x, [0, 5, 10, 15, 20], top, bottom, "") + marks);
}

// False alarms and detection, from the 1,000-astronaut simulation.
export function alarmBars(sim = SIMULATED_RELIABILITY) {
  const left = 168, right = W - 44, step = 22;
  const x = v => left + (v / 100) * (right - left);
  const bar = (y, label, value, cls, title) => `<g class="ev-row"><title>${esc(title)}</title><rect class="ev-hit" x="0" y="${y}" width="${W}" height="${step}"/>`
    + `<text class="ev-label${cls === "ev-ours" ? " ev-strong" : ""}" x="${left - 8}" y="${y + 15}" text-anchor="end">${esc(label)}</text>`
    + `<rect class="${cls}" x="${left}" y="${y + 4}" width="${Math.max(2, x(value) - left)}" height="${step - 8}" rx="3"/>`
    + `<text class="ev-value" x="${x(value) + 6}" y="${y + 15}">${fmt(value, 1)} %</text></g>`;
  const grid = (top, bottom) => [0, 50, 100].map(t => `<line class="ev-grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${bottom}"/>`).join("");
  const ticks = y => [0, 50, 100].map(t => `<text class="ev-tick" x="${x(t)}" y="${y}" text-anchor="middle">${t}%</text>`).join("");
  const first = 18;
  let body = `<text class="ev-sub" x="0" y="12">Healthy days flagged REVIEW (lower is better)</text>` + grid(first, first + 2 * step);
  body += bar(first, "One-reading rule", sim.singleRuleReviewPct, "ev-before", `A single reading outside 2 spreads: REVIEW on ${sim.singleRuleReviewPct} % of healthy days`);
  body += bar(first + step, "AstroBone rules", sim.reviewPct, "ev-ours", `Personal-baseline rules with RE-CHECK first: REVIEW on ${sim.reviewPct} % of healthy days`);
  const second = first + 2 * step + 30;
  body += `<text class="ev-sub" x="0" y="${second - 8}">Real changes flagged within 14 checks (higher is better)</text>` + grid(second, second + sim.detected.length * step);
  sim.detected.forEach((d, i) => { body += bar(second + i * step, SHORT[d.key] ?? d.label, d.withinTwoWeeks, "ev-ours", `${d.label}: flagged within 3 checks in ${d.withinThree} % of runs, within 14 in ${d.withinTwoWeeks} %`); });
  const bottom = second + sim.detected.length * step;
  return svg(bottom + 20, `Simulated ${sim.astronauts.toLocaleString("en")} healthy astronauts: REVIEW on ${sim.singleRuleReviewPct} % of days with a one-reading rule, ${sim.reviewPct} % with AstroBone's rules; real changes flagged within 14 checks in ${sim.detected.map(d => d.withinTwoWeeks).join(", ")} % of runs.`,
    body + ticks(bottom + 13));
}

// The table version of each chart, for screen readers, print and anyone who prefers numbers.
export function evidenceTables(sim = SIMULATED_RELIABILITY) {
  return {
    knee: { head: ["Person", "Before (°)", "AstroBone (°)"], rows: KNEE_PER_PERSON.map(r => [`P${r.person}`, fmt(r.before), fmt(r.after)]) },
    pulse: { head: ["Method", "Average error (bpm)"], rows: PULSE_METHODS.map(r => [r.label, fmt(r.mae, 2)]) },
    alarms: { head: ["Measure", "Within 3 checks", "Within 14 checks"], rows: [
      ["Healthy days REVIEW, one-reading rule", `${sim.singleRuleReviewPct} %`, ""], ["Healthy days REVIEW, AstroBone", `${sim.reviewPct} %`, ""],
      ...sim.detected.map(d => [d.label, `${d.withinThree} %`, `${d.withinTwoWeeks} %`])] },
  };
}
