import { INDICATORS, SAFETY_LIMITS, evaluateIndicator, describeBound } from "./selfCheck.js";

// The full-size chart for one indicator over the whole mission. Every point is re-evaluated against
// the checks before it, so the chart shows the status each check had on its own day, not today's.
// Colour is never the only cue: each status has its own word and its own marker shape, so the chart
// reads the same in greyscale and for colour-blind viewers (scripts/check-status-colours.mjs).
export const STATUS_MARKS = Object.freeze({
  urgent: { word: "URGENT", shape: "square", glyph: "■" },
  attention: { word: "CONTACT TODAY", shape: "diamond", glyph: "◆" },
  changed: { word: "REVIEW", shape: "triangle", glyph: "▲" },
  repeat: { word: "REPEAT", shape: "cross", glyph: "✕" },
  baseline: { word: "BASELINE", shape: "ring", glyph: "○" },
  stable: { word: "STABLE", shape: "dot", glyph: "●" },
  notChecked: { word: "NOT CHECKED", shape: "none", glyph: "–" },
});

const has = (check, key) => Number.isFinite(check.values?.[key]);
// Mission day when the record has one (the demo astronaut); otherwise days since the first check.
const DAY_MS = 86400e3;
function xOf(check, first) {
  if (Number.isFinite(check.missionDay)) return check.missionDay;
  const t = Date.parse(check.at), t0 = Date.parse(first.at);
  return Number.isFinite(t) && Number.isFinite(t0) ? 1 + (t - t0) / DAY_MS : null;
}
const hasDays = check => Number.isFinite(check.missionDay);

// records: saved checks, oldest first; current: today's unsaved check (or null). Records with the same
// id as `current` are skipped so a saved check is not drawn twice.
export function indicatorHistory(key, records, current = null, { floors = {}, limits = SAFETY_LIMITS } = {}) {
  const def = INDICATORS[key];
  if (!def) return null;
  const all = [...records.filter(r => !current || r.id !== current.id), ...(current ? [current] : [])];
  const first = all.find(r => has(r, key));
  const points = [];
  all.forEach((check, i) => {
    if (!has(check, key)) return;
    const prior = all.slice(0, i);
    const row = evaluateIndicator(key, check.values[key], prior, { protocol: check.protocols?.[key], usable: check.quality?.[key] !== false, floor: floors[key], limits });
    const x = xOf(check, first);
    points.push({
      x, day: hasDays(check) ? Math.round(x) : null, at: check.at, value: check.values[key], status: row.status, reason: row.reason ?? null, current: check === current,
      band: row.ref?.ready && Number.isFinite(row.tolerance) ? [row.ref.mean - row.tolerance, row.ref.mean + row.tolerance] : null,
      limit: row.limit ? row.limit.text : null, start: row.drift?.ready ? row.drift.lockedMean : null,
    });
  });
  const spec = limits[key];
  const limitLines = spec ? ["urgent", "attention"].flatMap(level => (spec[level] ?? []).map(([op, value]) => ({ level, op, value, text: describeBound([op, value], def.unit) }))) : [];
  const start = points.findLast(p => p.start !== null)?.start ?? null;
  return { key, def, points: points.filter(p => Number.isFinite(p.x)), start, limitLines };
}

// Round axis steps: 1, 2 or 5 times a power of ten.
export function niceTicks(lo, hi, target = 5) {
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / target, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { step, ticks };
}

// Sized for the self-check drawer (about 400 px wide) so 10 px labels stay 10 px on screen.
export const CHART = Object.freeze({ width: 400, height: 236, left: 38, right: 10, top: 28, bottom: 46, inset: 12 });

const esc = text => String(text).replace(/[&"<>]/g, c => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);
const r1 = v => Math.round(v * 10) / 10;
const unitText = def => (def.unit === "°" || !def.unit ? def.unit : ` ${def.unit}`);
export const pointLabel = (p, def) => `${p.day !== null ? `Day ${p.day}` : new Date(p.at).toLocaleDateString()}: ${Number(p.value.toFixed(def.digits ?? 0))}${unitText(def)} · ${STATUS_MARKS[p.status].word}${p.limit ? ` (${p.limit})` : ""}`;

function marker(p, cx, cy) {
  const cls = `sc-h-pt sc-h-${p.status}${p.current ? " sc-h-today" : ""}`, s = 5;
  const shape = {
    square: `<rect x="${r1(cx - s)}" y="${r1(cy - s)}" width="${2 * s}" height="${2 * s}"/>`,
    diamond: `<path d="M${r1(cx)} ${r1(cy - s - 1.5)}L${r1(cx + s + 1.5)} ${r1(cy)}L${r1(cx)} ${r1(cy + s + 1.5)}L${r1(cx - s - 1.5)} ${r1(cy)}Z"/>`,
    triangle: `<path d="M${r1(cx)} ${r1(cy - s - 1)}L${r1(cx + s + 1)} ${r1(cy + s)}L${r1(cx - s - 1)} ${r1(cy + s)}Z"/>`,
    cross: `<path d="M${r1(cx - s)} ${r1(cy - s)}L${r1(cx + s)} ${r1(cy + s)}M${r1(cx + s)} ${r1(cy - s)}L${r1(cx - s)} ${r1(cy + s)}"/>`,
    ring: `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${s - 0.5}"/>`,
    dot: `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${s - 0.5}"/>`,
  }[STATUS_MARKS[p.status].shape] ?? "";
  return `<g class="${cls}">${shape}</g>`;
}

// SVG markup (testable without a DOM). The y axis covers the values and the usual range; safety limits
// inside it are drawn as labelled lines, limits outside it are named above or below the plot.
export function historyChartSvg(hist, { width = CHART.width, height = CHART.height } = {}) {
  if (!hist || hist.points.length < 1) return "";
  const { def, points } = hist, { left, right, top, bottom, inset } = CHART, d = def.digits ?? 0;
  const ys = points.flatMap(p => [p.value, ...(p.band ?? [])]).concat(Number.isFinite(hist.start) ? [hist.start] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max((hi - lo) * 0.12, def.floor ? def.floor / 2 : 1);
  lo -= pad; hi += pad;
  const { ticks, step } = niceTicks(lo, hi, 4), tickDigits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks.at(-1));
  const xs = points.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs), span = x1 - x0 || 1;
  const plot = width - left - right - 2 * inset;
  const X = x => left + inset + (points.length === 1 ? plot / 2 : ((x - x0) * plot) / span);
  const Y = v => top + ((hi - v) * (height - top - bottom)) / (hi - lo);
  const out = [`<svg class="sc-hchart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${def.label} over ${points.length} checks`)}">`];
  // Grid and y axis
  for (const t of ticks) out.push(`<line class="sc-h-grid" x1="${left}" x2="${width - right}" y1="${r1(Y(t))}" y2="${r1(Y(t))}"/><text class="sc-h-tick" x="${left - 6}" y="${r1(Y(t) + 3.5)}" text-anchor="end">${t.toFixed(tickDigits)}</text>`);
  out.push(`<text class="sc-h-unit" x="${left - 6}" y="${top - 8}" text-anchor="end">${esc(def.unit || "")}</text>`);
  // Usual range: a bar at each compared check, the range that check was judged against on its own day.
  for (const p of points.filter(q => q.band)) {
    const top1 = Y(Math.min(hi, p.band[1])), bottom1 = Y(Math.max(lo, p.band[0]));
    out.push(`<rect class="sc-h-band" x="${r1(X(p.x) - 7)}" y="${r1(top1)}" width="14" height="${r1(Math.max(0, bottom1 - top1))}" rx="3"/>`);
  }
  if (Number.isFinite(hist.start)) out.push(`<line class="sc-h-start" x1="${left}" x2="${width - right}" y1="${r1(Y(hist.start))}" y2="${r1(Y(hist.start))}"/><text class="sc-h-note" x="${left + 4}" y="${r1(Y(hist.start) + 12)}">starting level ${Number(hist.start.toFixed(d))}</text>`);
  // Safety limits
  const above = [], below = [];
  for (const line of hist.limitLines) {
    if (line.value > hi) { above.push(line); continue; }
    if (line.value < lo) { below.push(line); continue; }
    out.push(`<line class="sc-h-limit sc-h-${line.level}" x1="${left}" x2="${width - right}" y1="${r1(Y(line.value))}" y2="${r1(Y(line.value))}"/><text class="sc-h-note sc-h-${line.level}" x="${left + 4}" y="${r1(Y(line.value) - 4)}">${esc(`${STATUS_MARKS[line.level].word}: ${line.text}`)}</text>`);
  }
  const edge = (lines, y, arrow) => lines.length && out.push(`<text class="sc-h-note sc-h-edge" x="${width - right}" y="${y}" text-anchor="end">${esc(`${arrow} limit${lines.length > 1 ? "s" : ""} ${lines.map(l => l.text.replace(` ${def.unit}`, "")).join(", ")} ${def.unit}`)}</text>`);
  edge(above, top - 8, "↑"); edge(below, height - 4, "↓");
  // Line through usable values only; a failed quality check is shown but not joined.
  const usable = points.filter(p => p.status !== "repeat");
  if (usable.length > 1) out.push(`<path class="sc-h-line" d="${usable.map((p, i) => `${i ? "L" : "M"}${r1(X(p.x))} ${r1(Y(p.value))}`).join(" ")}"/>`);
  // X axis labels: the last check always, the others when they do not crowd a label already drawn.
  const shown = [X(points.at(-1).x)];
  points.forEach((p, i) => {
    const px = X(p.x);
    if (i !== points.length - 1) { if (shown.some(x => Math.abs(x - px) < 46)) return; shown.push(px); }
    out.push(`<text class="sc-h-tick" x="${r1(X(p.x))}" y="${height - bottom + 16}" text-anchor="middle">${p.day !== null ? `Day ${p.day}` : esc(new Date(p.at).toLocaleDateString([], { month: "short", day: "numeric" }))}</text>`);
  });
  for (const p of points) out.push(marker(p, X(p.x), Y(p.value)).replace("</g>", `<title>${esc(pointLabel(p, def))}</title></g>`));
  const last = points.at(-1);
  out.push(`<text class="sc-h-now sc-h-${last.status}" x="${r1(X(last.x) - 9)}" y="${r1(Y(last.value) < top + 16 ? Y(last.value) + 16 : Y(last.value) - 9)}" text-anchor="end">${esc(`${last.current ? "today " : ""}${Number(last.value.toFixed(d))}${unitText(def)} ${STATUS_MARKS[last.status].word}`)}</text>`);
  out.push("</svg>");
  return out.join("");
}

// Statuses that appear in a chart, for its legend.
export const legendFor = hist => Object.entries(STATUS_MARKS).filter(([status]) => hist.points.some(p => p.status === status)).map(([status, mark]) => ({ status, ...mark }));
// Indicators with at least two values in these records: the ones worth charting.
export const chartableKeys = (records, current = null) => Object.keys(INDICATORS).filter(key => [...records, ...(current ? [current] : [])].filter(r => has(r, key)).length >= 2);
