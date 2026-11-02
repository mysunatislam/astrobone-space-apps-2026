import { SAFETY_LIMITS, INDICATORS, describeBound } from "./selfCheck.js";

// Flight-surgeon-set safety limits. The fixed limits in SAFETY_LIMITS follow public guidance for adults on
// Earth; a crew's flight surgeon knows the person (a known low blood pressure, a stricter line before an
// EVA) and can move any of them. A limit set is a small signed file: who set it, when, why, and only the
// lines they changed. It is checked before it is used, so a typo cannot switch a safety limit off: every
// value must be physiologically plausible, an urgent line must stay beyond the "tell today" line on the
// same side, and a low line must stay below the high one. Site-specific lines (an armpit fever) keep the
// public values. Every status a surgeon line produces says so, and the public value stays on screen.

export const SURGEON_LIMITS_SCHEMA = "astrobone-surgeon-limits-v1";
export const SURGEON_LIMITS_KEY = "astrobone-surgeon-limits";

// The range a limit may be set within, in the indicator's own unit.
export const PLAUSIBLE = Object.freeze({ systolicBp: [70, 250], diastolicBp: [40, 150], glucose: [40, 400], bodyTemp: [34, 41], spo2: [80, 99] });
const UPPER = new Set([">", ">="]);
const LEVEL_WORDS = { urgent: "Urgent", attention: "Tell today" };

// Every public line a surgeon can move, with a stable id ("systolicBp.attention.0").
export function editableBounds(base = SAFETY_LIMITS) {
  return Object.entries(base).flatMap(([key, rule]) => ["urgent", "attention"].flatMap(level => (rule[level] ?? []).map(([op, value], index) => ({
    id: `${key}.${level}.${index}`, key, level, index, op, value, upper: UPPER.has(op),
    label: `${INDICATORS[key].short ?? INDICATORS[key].label} · ${LEVEL_WORDS[level]} ${describeBound([op, value], "").replace(/ [\d.]+$/, "")}`, unit: INDICATORS[key].unit,
  }))));
}

// Why a limit set cannot be used, or null.
export function surgeonLimitsProblem(set, base = SAFETY_LIMITS) {
  if (!set || set.schema !== SURGEON_LIMITS_SCHEMA) return "This is not an AstroBone safety-limit file.";
  if (!String(set.setBy ?? "").trim()) return "Add the name of the flight surgeon who set these limits.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(set.date ?? ""))) return "Add the date the limits were set.";
  const bounds = editableBounds(base), byId = new Map(bounds.map(b => [b.id, b]));
  const entries = Object.entries(set.values ?? {});
  if (!entries.length) return "No limit was changed.";
  for (const [id, value] of entries) {
    const b = byId.get(id);
    if (!b) return `Unknown limit "${id}".`;
    const [lo, hi] = PLAUSIBLE[b.key];
    if (!Number.isFinite(value) || value < lo || value > hi) return `${b.label}: use a value from ${lo} to ${hi}${b.unit ? ` ${b.unit}` : ""}.`;
  }
  // Order checks on the merged lines, per indicator and side.
  const merged = bounds.map(b => ({ ...b, value: set.values?.[b.id] ?? b.value }));
  for (const key of Object.keys(base)) {
    const lines = merged.filter(b => b.key === key);
    const highest = (level, upper) => lines.filter(b => b.level === level && b.upper === upper).map(b => b.value);
    const [uUp, aUp, uLo, aLo] = [highest("urgent", true), highest("attention", true), highest("urgent", false), highest("attention", false)];
    const name = INDICATORS[key].short ?? INDICATORS[key].label;
    if (uUp.length && aUp.length && Math.min(...uUp) <= Math.max(...aUp)) return `${name}: the urgent high line must be above the tell-today line.`;
    if (uLo.length && aLo.length && Math.max(...uLo) >= Math.min(...aLo)) return `${name}: the urgent low line must be below the tell-today line.`;
    const lows = [...uLo, ...aLo], highs = [...uUp, ...aUp];
    if (lows.length && highs.length && Math.max(...lows) >= Math.min(...highs)) return `${name}: a low line must be below every high line.`;
  }
  return null;
}

// SAFETY_LIMITS with the surgeon's lines in place. A moved line carries "surgeon" as its fourth element so
// safetyLimit() can say who set it; an unusable set returns the public limits unchanged.
export function applySurgeonLimits(set, base = SAFETY_LIMITS) {
  if (!set || surgeonLimitsProblem(set, base)) return base;
  const out = {};
  for (const [key, rule] of Object.entries(base)) {
    const next = { ...rule };
    for (const level of ["urgent", "attention"]) {
      if (!rule[level]) continue;
      next[level] = rule[level].map((bound, index) => {
        const value = set.values[`${key}.${level}.${index}`];
        return Number.isFinite(value) && value !== bound[1] ? [bound[0], value, bound[2] ?? null, "surgeon"] : bound;
      });
    }
    out[key] = Object.freeze(next);
  }
  return Object.freeze(out);
}

// One line per moved limit, with the public value beside it.
export function surgeonLimitsSummary(set, base = SAFETY_LIMITS) {
  if (!set || surgeonLimitsProblem(set, base)) return [];
  return editableBounds(base).filter(b => Number.isFinite(set.values[b.id]) && set.values[b.id] !== b.value)
    .map(b => `${b.label} ${set.values[b.id]}${b.unit ? ` ${b.unit}` : ""} (public guidance ${b.value})`);
}

export const newSurgeonLimits = ({ setBy = "", date = new Date().toISOString().slice(0, 10), reason = "", values = {} } = {}) =>
  ({ schema: SURGEON_LIMITS_SCHEMA, setBy, date, reason, values });

export function parseSurgeonLimits(text) {
  try { const set = JSON.parse(text); return { set, problem: surgeonLimitsProblem(set) }; } catch { return { set: null, problem: "This file is not readable JSON." }; }
}
