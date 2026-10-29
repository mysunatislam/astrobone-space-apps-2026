import { STATUS_MARKS } from "./historyChart.js";

// The self-check as a short plain-text message for the flight surgeon. It reads on any ground terminal
// without AstroBone, it is small enough for a constrained deep-space link, and it always has the same
// order (overall, red flags, what changed, what is stable, actions, quality, context) so a reviewer can
// scan a whole crew quickly. It carries the same results as the JSON export, in words.
export const REPORT_BOUNDARY = "Self-monitoring record. Review triggers are engineering defaults, not clinical thresholds. Not a diagnosis.";

const num = (v, d = 0) => Number(v).toFixed(d);
const unitOf = def => (def.unit === "°" || !def.unit ? def.unit : ` ${def.unit}`);
const value = row => `${num(row.value, row.def.digits ?? 0)}${unitOf(row.def)}`;

// Why a row has its status, in a few words.
export function rowReason(row) {
  const d = row.def.digits ?? 0;
  if (row.limit) return `${row.status === "repeat" ? "quality check failed; " : ""}safety limit: ${row.limit.text}`;
  if (row.status === "repeat") return "quality check failed, not compared";
  if (row.status === "baseline") return `building baseline ${row.ref?.count ?? 0}/${row.ref?.needed ?? 3}`;
  const usual = row.ref?.ready ? `usual ${num(row.ref.mean, d)} ± ${num(row.tolerance, Math.max(d, 1))}` : "";
  if (row.reason === "debt") return `sleep debt ${num(row.debt.debt, 1)} h over the last ${row.debt.nights} nights against usual ${num(row.debt.usual, 1)} h a night, review above ${num(row.debt.limit, 1)} h${usual ? `; ${usual}` : ""}`;
  if (row.reason === "drift") return `steady drift from starting level ${num(row.drift.lockedMean, d)}${usual ? `; ${usual}` : ""}`;
  if (row.status === "recheck") return `outside once, measure again next check; ${usual}`;
  return usual;
}

export function surgeonReport(evaluation, check, { environment = null, profile = "", followUps = null } = {}) {
  const ev = evaluation, rows = ev.domains.flatMap(d => d.indicators.map(row => ({ ...row, domain: d.label }))).filter(r => r.status !== "notChecked");
  const when = Number.isFinite(check.missionDay) ? `Mission day ${check.missionDay}` : new Date(check.at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const lines = [`ASTROBONE SELF-CHECK REPORT · ${profile || check.profileId} · ${when}`];
  if (environment) lines.push(`Where: ${environment.label}, ${environment.place} · message to Earth ${environment.delayText} one way`);
  lines.push(`Overall: ${STATUS_MARKS[ev.overall].word}`);
  lines.push(`Red flags: ${ev.redFlags.length ? ev.redFlags.join("; ") : "none reported"}`);
  const symptoms = ev.domains.find(d => d.key === "immune")?.symptoms ?? [];
  if (symptoms.length) lines.push(`New symptoms: ${symptoms.join(", ")}`);

  const order = ["urgent", "attention", "changed", "recheck", "repeat", "baseline"];
  const flagged = rows.filter(r => order.includes(r.status)).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  if (flagged.length) {
    lines.push("", "NEEDS A LOOK");
    for (const r of flagged) lines.push(`- ${STATUS_MARKS[r.status].word}: ${r.domain}, ${r.def.label} ${value(r)} (${rowReason(r)})`);
  }
  const stable = rows.filter(r => r.status === "stable");
  if (stable.length) lines.push("", `STABLE (within usual range): ${stable.map(r => `${r.def.short ?? r.def.label} ${value(r)}`).join(", ")}`);
  const unchecked = ev.domains.filter(d => d.status === "notChecked").map(d => d.label);
  if (unchecked.length) lines.push(`Not checked: ${unchecked.join(", ")}`);

  const actions = followUps ?? ev.actions.filter(a => a.priority !== "info");
  if (actions.length) {
    lines.push("", followUps ? "ACTIONS THE ASTRONAUT SELECTED" : "WHAT THE ASTRONAUT WAS ADVISED");
    for (const a of actions) lines.push(`- ${a.text}`);
  }
  const failed = Object.entries(check.quality ?? {}).filter(([, ok]) => ok === false).map(([key]) => rows.find(r => r.key === key)?.def.label ?? key);
  const context = [
    check.repeatedAfterFail ? "a capture failed its quality check and was repeated" : null,
    failed.length ? `not compared (quality): ${failed.join(", ")}` : null,
    Number.isFinite(check.dosimeter) ? `dosimeter ${num(check.dosimeter, 1)} mGy cumulative (context only)` : null,
    check.notes ? `note: ${check.notes}` : null,
  ].filter(Boolean);
  if (context.length) lines.push("", `Context: ${context.join("; ")}`);
  lines.push("", REPORT_BOUNDARY);
  return lines.join("\n");
}

export const byteSize = text => new TextEncoder().encode(text).length;
