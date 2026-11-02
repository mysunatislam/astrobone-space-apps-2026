import test from "node:test";
import assert from "node:assert/strict";
import { kneeDumbbell, pulseBars, alarmBars, evidenceTables } from "./evidenceCharts.js";
import { KNEE_PER_PERSON, PULSE_METHODS } from "./realDataValidation.js";
import { SIMULATED_RELIABILITY } from "./selfCheck.js";

const count = (s, re) => (s.match(re) ?? []).length;

test("knee chart: one row per person, two dots each, label states the averages", () => {
  const s = kneeDumbbell();
  assert.equal(count(s, /<g class="ev-row">/g), KNEE_PER_PERSON.length);
  assert.equal(count(s, /class="ev-ours" cx/g), KNEE_PER_PERSON.length + 1); // + legend
  assert.match(s, /aria-label="[^"]*21\.7° on average before, 13\.2° with the hybrid model; lower for all 9\./);
  assert.match(s, /<title>Person 2: 28\.1° before, 17\.0° after<\/title>/);
});

test("pulse chart: AstroBone first and in the highlight colour, bars sized by error", () => {
  const s = pulseBars();
  assert.equal(count(s, /<g class="ev-row">/g), PULSE_METHODS.length);
  const widths = [...s.matchAll(/<rect class="ev-(?:ours|before)" x="168" y="[\d.]+" width="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.equal(widths.length, PULSE_METHODS.length);
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] >= widths[i - 1], "sorted, lower error first");
  assert.match(s, /AstroBone \(shipped\)<\/text><rect class="ev-ours"/);
});

test("alarm chart and tables quote the simulation exactly", () => {
  const s = alarmBars();
  assert.match(s, new RegExp(`${SIMULATED_RELIABILITY.singleRuleReviewPct} % of days with a one-reading rule, ${SIMULATED_RELIABILITY.reviewPct} %`));
  assert.equal(count(s, /<g class="ev-row">/g), 2 + SIMULATED_RELIABILITY.detected.length);
  const t = evidenceTables();
  assert.equal(t.knee.rows.length, 9); assert.equal(t.pulse.rows[0][1], "2.14");
  assert.deepEqual(t.alarms.rows[1], ["Healthy days REVIEW, AstroBone", "11.4 %", ""]);
  for (const chart of [s, kneeDumbbell(), pulseBars()]) assert.doesNotMatch(chart, /undefined|NaN/);
});
