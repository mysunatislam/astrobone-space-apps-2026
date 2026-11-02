import { INDICATORS, DOMAINS, STATUS_RANK, evaluateSelfCheck } from "./selfCheck.js";
import { STATUS_MARKS, indicatorHistory } from "./historyChart.js";
import { escalationPlan } from "./missionEnvironment.js";

// My Health: one screen that answers "how am I today?" for one astronaut. Every indicator is a tile with
// today's value, its status (a word and a marker shape as well as a colour), the whole mission as a small
// line with the usual range, and the change since the first check. The model is plain data so it can be
// tested without a DOM; dashboardPanel.js draws it. Nothing here makes a new judgement: every status is
// the self-check's own (evaluateSelfCheck), and every point is judged as it was on its own day
// (indicatorHistory), so the dashboard can never disagree with the self-check result screen.

const FLAGGED = new Set(["urgent", "attention", "changed", "recheck"]);
const round = (value, digits = 0) => Number(Number(value).toFixed(digits));
export const formatValue = (value, def) => (Number.isFinite(value) ? Number(value).toFixed(def.digits ?? 0) : "--");
export const unitText = def => (!def.unit ? "" : def.unit === "°" ? "°" : ` ${def.unit}`);

// records: saved checks, oldest first. current: today's check if it is not among them (or null).
// evaluation: the self-check's evaluation of today's check (or null: evaluate the newest record).
export function dashboardModel({ records = [], current = null, evaluation = null, environment = null, routine = null, floors = {} } = {}) {
  const all = [...records.filter(r => !current || r.id !== current.id), ...(current ? [current] : [])];
  if (!all.length) return { empty: true, routine };
  const today = current ?? all.at(-1);
  const ev = evaluation ?? evaluateSelfCheck(today, all.slice(0, -1), { floors, environment });
  const rows = ev.domains.flatMap(d => d.indicators);

  const tiles = Object.keys(INDICATORS).map(key => {
    const def = INDICATORS[key], row = rows.find(r => r.key === key) ?? { status: "notChecked" };
    const hist = indicatorHistory(key, all.slice(0, -1), today, { floors });
    const points = hist?.points ?? [];
    const first = points[0] ?? null, last = points.at(-1) ?? null;
    const usual = row.ref?.ready && Number.isFinite(row.tolerance) ? { mean: row.ref.mean, tolerance: row.tolerance } : null;
    return {
      key, def, domain: def.domain, status: row.status, mark: STATUS_MARKS[row.status],
      value: row.value ?? null, text: formatValue(row.value, def), unit: unitText(def),
      flagged: FLAGGED.has(row.status), reason: row.reason ?? null, limit: row.limit?.text ?? null,
      usual, usualText: usual ? `usual ${round(usual.mean, def.digits ?? 0)} ± ${round(usual.tolerance, (def.digits ?? 0) + 1)}${unitText(def)}` : null,
      sinceFirst: first && last && first !== last && last.current ? { day: first.day, value: first.value, delta: last.value - first.value } : null,
      series: points.slice(0, -1).map(p => p.value), band: last?.band ?? null, start: hist?.start ?? null, points: points.length,
    };
  });

  const domains = DOMAINS.map(([key, label, hazard]) => {
    const d = ev.domains.find(x => x.key === key);
    const flagged = tiles.filter(t => t.domain === key && t.flagged).map(t => t.def.label);
    if (key === "immune" && d?.symptoms?.length) flagged.push(...d.symptoms);
    return { key, label, hazard, status: d?.status ?? "notChecked", mark: STATUS_MARKS[d?.status ?? "notChecked"], flagged, measured: tiles.filter(t => t.domain === key && t.status !== "notChecked").length };
  });

  const needs = domains.filter(d => FLAGGED.has(d.status));
  const measured = domains.filter(d => d.status !== "notChecked");
  const headline = ev.redFlags.length ? `Red-flag symptom reported: ${ev.redFlags.join(", ")}.`
    : needs.length ? `${needs.length} of ${measured.length} body systems need a look: ${needs.map(d => d.label).join(", ")}.`
      : measured.some(d => d.status === "baseline") ? "Still building your baseline: comparisons start after 3 usable checks of each test."
        : "Everything measured is inside your usual range.";
  const plan = environment ? escalationPlan(ev.overall, environment) : null;
  const flaggedTiles = tiles.filter(t => t.flagged).sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);

  return {
    empty: false, evaluation: ev, check: today, overall: ev.overall, mark: STATUS_MARKS[ev.overall], headline, redFlags: ev.redFlags,
    missionDay: Number.isFinite(today.missionDay) ? today.missionDay : null, at: today.at,
    domains, tiles, flagged: flaggedTiles, actions: ev.actions, plan, environment, routine,
    checks: all.length, measuredCount: tiles.filter(t => t.status !== "notChecked").length,
    // The tile to chart first: the most serious one with at least two points.
    chartKey: (flaggedTiles.find(t => t.points >= 2) ?? tiles.find(t => t.points >= 2))?.key ?? null,
  };
}

// Mission adherence as a strip of days: done, missed, today, or still ahead. For the demo astronaut the
// days are mission days; for a person on this device, the last `span` calendar days.
export function adherenceStrip(doneDays, today, { from = Math.max(1, today - 59), to = today } = {}) {
  const done = new Set(doneDays), cells = [];
  for (let day = from; day <= to; day++) cells.push({ day, state: day === today ? (done.has(day) ? "today-done" : "today") : done.has(day) ? "done" : "missed" });
  return { from, to, cells, done: cells.filter(c => c.state.endsWith("done")).length, missed: cells.filter(c => c.state === "missed").length };
}

// The crew view for the crew medical officer and the flight surgeon: every crew member's own dashboard
// model, most serious first, so the person who needs attention is on top. Same engine, same rules, each
// person against their own earlier checks.
export function crewRoster(crew, environment = null) {
  const rows = crew.map(member => {
    const model = dashboardModel({ records: member.history, current: member.today, environment });
    const lead = model.flagged[0] ?? null;
    const day = model.missionDay;
    const done = member.checkDays.filter(d => d <= day).length + (member.checkDays.includes(day) ? 0 : 1);
    return { id: member.id, name: member.name, role: member.role, status: model.overall, mark: model.mark, model, lead,
      flagged: model.flagged.map(t => `${t.def.label} ${t.text}${t.unit}`), day, adherence: { done, of: day } };
  });
  rows.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(Object.keys(STATUS_MARKS).map(s => [s, rows.filter(r => r.status === s).length]).filter(([, n]) => n));
  return { rows, counts };
}

// One plain-text line per crew member, small enough for a slow deep-space link.
export function crewSummaryText(roster, environment = null) {
  const day = roster.rows[0]?.day;
  const lines = [`ASTROBONE CREW SUMMARY${Number.isFinite(day) ? ` · Mission day ${day}` : ""}${environment ? ` · ${environment.place} · message to Earth ${environment.delayText} one way` : ""}`,
    "Most serious first. Each person is compared with their own earlier checks. Not a diagnosis.", ""];
  for (const r of roster.rows) {
    lines.push(`${r.mark.word.padEnd(13)} ${r.name} (${r.role})${r.flagged.length ? `: ${r.flagged.join("; ")}` : ": no change outside usual range"}`);
    const first = r.model.actions.find(a => a.priority !== "info");
    if (first) lines.push(`              Next: ${first.text}`);
  }
  return lines.join("\n");
}
