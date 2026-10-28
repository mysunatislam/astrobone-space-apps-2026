import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATUS_MARKS, indicatorHistory, historyChartSvg, niceTicks, legendFor, chartableKeys, pointLabel } from "./historyChart.js";
import { evaluateSelfCheck, INDICATORS } from "./selfCheck.js";
import { ELENA_HISTORY, ELENA_POOR_CAPTURE, elenaDay147 } from "./elenaSelfCheck.js";
import { STATUS_COLOURS, statusColourReport, deltaE2000 } from "../scripts/check-status-colours.mjs";

test("the last chart point has the same status as today's self-check result", () => {
  const today = elenaDay147(), ev = evaluateSelfCheck(today, ELENA_HISTORY);
  for (const key of chartableKeys(ELENA_HISTORY, today)) {
    const row = ev.domains.flatMap(d => d.indicators).find(r => r.key === key);
    assert.equal(indicatorHistory(key, ELENA_HISTORY, today).points.at(-1).status, row.status, key);
  }
});

test("each earlier point is judged only against the checks before it", () => {
  const hist = indicatorHistory("kneeExtension", ELENA_HISTORY, elenaDay147());
  assert.deepEqual(hist.points.map(p => p.day), [1, 30, 60, 90, 120, 147]);
  assert.deepEqual(hist.points.slice(0, 3).map(p => p.status), ["baseline", "baseline", "baseline"], "no comparison before 3 usable checks");
  assert.equal(hist.points[3].status, "stable");
  assert.ok(hist.points[3].band && hist.points[3].band[0] < 160 && hist.points[3].band[1] > 160, "day 90 sits inside the range it had on day 90");
  assert.equal(hist.points.at(-1).current, true);
});

test("a capture that failed its quality check is drawn as REPEAT and left off the line", () => {
  const hist = indicatorHistory("kneeExtension", ELENA_HISTORY, elenaDay147(ELENA_POOR_CAPTURE));
  assert.equal(hist.points.at(-1).status, "repeat");
  const svg = historyChartSvg(hist), line = svg.match(/class="sc-h-line" d="([^"]+)"/)[1];
  assert.equal(line.split(/[ML]/).filter(Boolean).length, 5, "the line joins only the five usable checks");
  assert.match(svg, /REPEAT/);
});

test("a saved check is not drawn twice when it is also today's check", () => {
  const today = elenaDay147();
  assert.equal(indicatorHistory("restingHr", [...ELENA_HISTORY, today], today).points.length, 6);
});

test("safety limits inside the scale are drawn as lines, the rest are named at the edge", () => {
  const today = elenaDay147(), hist = indicatorHistory("systolicBp", ELENA_HISTORY, today);
  assert.deepEqual(hist.limitLines.map(l => [l.level, l.value]), [["urgent", 180], ["attention", 140], ["attention", 90]]);
  const svg = historyChartSvg(hist);
  assert.match(svg, /↑ limits above 180, at or above 140 mmHg/);
  assert.match(svg, /↓ limit below 90 mmHg/);
  const high = { ...today, id: "x", values: { ...today.values, systolicBp: 150 } };
  const near = historyChartSvg(indicatorHistory("systolicBp", ELENA_HISTORY, high));
  assert.match(near, /class="sc-h-limit sc-h-attention"/, "140 is drawn once a value comes near it");
  assert.match(near, /CONTACT TODAY: at or above 140 mmHg/);
});

test("every status has its own word and its own shape, so colour is never the only cue", () => {
  const marks = Object.values(STATUS_MARKS);
  assert.equal(new Set(marks.map(m => m.word)).size, marks.length);
  assert.equal(new Set(marks.map(m => m.shape)).size, marks.length);
  assert.equal(new Set(marks.map(m => m.glyph)).size, marks.length);
  const hist = indicatorHistory("pvtLapses", ELENA_HISTORY, elenaDay147());
  assert.deepEqual(legendFor(hist).map(m => m.word), ["REVIEW", "BASELINE", "STABLE"]);
  assert.equal(pointLabel(hist.points.at(-1), hist.def), "Day 147: 9 · REVIEW");
});

test("checks without a mission day use days since the first check", () => {
  const rec = (at, v) => ({ id: at, at, values: { restingHr: v }, protocols: { restingHr: "p" }, quality: {} });
  const hist = indicatorHistory("restingHr", [rec("2026-11-01T08:00:00Z", 60), rec("2026-11-03T08:00:00Z", 62)]);
  assert.deepEqual(hist.points.map(p => p.x), [1, 3]);
  assert.equal(hist.points[0].day, null);
});

test("axis ticks are round numbers that cover the range", () => {
  assert.deepEqual(niceTicks(108.2, 121.7, 4).ticks, [110, 115, 120]);
  assert.deepEqual(niceTicks(36.3, 37.6, 4).ticks, [36.5, 37, 37.5]);
  assert.equal(niceTicks(5, 5).ticks.length > 0, true);
});

test("only indicators with two or more values are offered for charting", () => {
  assert.equal(chartableKeys([ELENA_HISTORY[0]]).length, 0);
  assert.ok(chartableKeys(ELENA_HISTORY).includes("glucose"));
  assert.ok(chartableKeys(ELENA_HISTORY).every(key => INDICATORS[key]));
});

// Colour-blind check of the status palette (scripts/check-status-colours.mjs).
test("CIEDE2000 matches the published test pairs", () => {
  // Sharma, Wu & Dalal 2005, Table 1, pairs 1 and 17.
  assert.ok(Math.abs(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 1e-3);
  assert.ok(Math.abs(deltaE2000([50, 2.5, 0], [73, 25, -18]) - 27.1492) < 1e-3);
});

test("the status colours in twin.css are the ones the colour check tested", () => {
  const css = readFileSync(new URL("./twin.css", import.meta.url), "utf8");
  const token = name => css.match(new RegExp(`--st-${name}:\\s*(#[0-9a-f]{6})`))[1];
  assert.equal(token("urgent"), STATUS_COLOURS.urgent);
  assert.equal(token("attention"), STATUS_COLOURS.attention);
  assert.equal(token("changed"), STATUS_COLOURS.changed);
  assert.equal(token("wait"), STATUS_COLOURS.baseline);
  assert.equal(token("stable"), STATUS_COLOURS.stable);
});

test("no two result statuses look alike with normal vision or red-green colour blindness", () => {
  const report = statusColourReport();
  for (const vision of ["normal", "deutan", "protan"]) {
    const close = report.visions.find(v => v.vision === vision).under10.filter(d => d.a !== "notChecked" && d.b !== "notChecked");
    assert.deepEqual(close, [], vision);
  }
  for (const [status, ratio] of Object.entries(report.contrast)) assert.ok(ratio >= 4.5, `${status} text contrast ${ratio.toFixed(1)}`);
});
