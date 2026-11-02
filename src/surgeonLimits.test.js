import test from "node:test";
import assert from "node:assert/strict";
import { SAFETY_LIMITS, safetyLimit, evaluateSelfCheck, SELF_CHECK_SCHEMA } from "./selfCheck.js";
import { editableBounds, surgeonLimitsProblem, applySurgeonLimits, surgeonLimitsSummary, newSurgeonLimits, parseSurgeonLimits, SURGEON_LIMITS_SCHEMA } from "./surgeonLimits.js";

const set = values => newSurgeonLimits({ setBy: "Dr. A. Rahman", date: "2026-11-02", reason: "Known low blood pressure", values });

test("every public line can be moved and has a readable label", () => {
  const bounds = editableBounds();
  assert.equal(bounds.length, Object.values(SAFETY_LIMITS).reduce((n, r) => n + (r.urgent?.length ?? 0) + (r.attention?.length ?? 0), 0));
  assert.equal(bounds.find(b => b.id === "systolicBp.attention.0").label, "Systolic · Tell today at or above");
  assert.equal(bounds.find(b => b.id === "systolicBp.attention.1").upper, false);
});

test("a surgeon's stricter blood pressure line changes the status and says who set it", () => {
  const limits = applySurgeonLimits(set({ "systolicBp.attention.0": 135, "systolicBp.attention.1": 85 }));
  assert.equal(safetyLimit("systolicBp", 137), null);
  const hit = safetyLimit("systolicBp", 137, limits);
  assert.equal(hit.level, "attention"); assert.equal(hit.surgeon, true);
  assert.equal(hit.text, "at or above 135 mmHg (flight surgeon's limit)");
  // Lines the surgeon left alone stay public and unmarked.
  assert.equal(safetyLimit("systolicBp", 190, limits).text, "above 180 mmHg");
  assert.equal(safetyLimit("systolicBp", 88, limits), null, "known low pressure: 88 no longer flagged");
  const check = { schema: SELF_CHECK_SCHEMA, id: "x", at: "2026-11-02T08:00:00Z", values: { systolicBp: 137, diastolicBp: 80 }, protocols: {}, quality: {} };
  assert.equal(evaluateSelfCheck(check, [], { limits }).overall, "attention");
  assert.notEqual(evaluateSelfCheck(check, []).overall, "attention");
});

test("a set that would switch a safety limit off is refused and the public limits stay", () => {
  const cases = [
    [{ "systolicBp.attention.0": 190 }, /urgent high line must be above/],
    [{ "spo2.urgent.0": 95 }, /urgent low line must be below/],
    [{ "bodyTemp.attention.0": 34.5 }, /low line must be below every high line/],
    [{ "glucose.urgent.1": 900 }, /use a value from 40 to 400/],
    [{ "glucose.urgent.1": Number.NaN }, /use a value/],
    [{ "nope.urgent.0": 1 }, /Unknown limit/],
    [{}, /No limit was changed/],
  ];
  for (const [values, re] of cases) {
    assert.match(surgeonLimitsProblem(set(values)), re, JSON.stringify(values));
    assert.equal(applySurgeonLimits(set(values)), SAFETY_LIMITS);
  }
  assert.match(surgeonLimitsProblem({ ...set({ "spo2.attention.0": 95 }), setBy: " " }), /name of the flight surgeon/);
  assert.match(surgeonLimitsProblem({ schema: "other" }), /not an AstroBone/);
});

test("site lines keep public values; the summary names the public value; files round-trip", () => {
  const s = set({ "bodyTemp.attention.0": 38.0 });
  const limits = applySurgeonLimits(s);
  assert.equal(safetyLimit("bodyTemp", 37.9, limits), null);
  assert.equal(safetyLimit("bodyTemp", 37.3, limits, "temp-armpit-v1").text, "at or above 37.2 °C (armpit)");
  assert.deepEqual(surgeonLimitsSummary(s), ["Body temperature · Tell today at or above 38 °C (public guidance 37.8)"]);
  const back = parseSurgeonLimits(JSON.stringify(s));
  assert.equal(back.problem, null); assert.equal(back.set.schema, SURGEON_LIMITS_SCHEMA);
  assert.match(parseSurgeonLimits("{oops").problem, /not readable/);
});

test("the flight surgeon report names the limits that were moved", async () => {
  const { surgeonReport } = await import("./surgeonReport.js");
  const s = set({ "systolicBp.attention.0": 135 });
  const check = { schema: SELF_CHECK_SCHEMA, id: "x", at: "2026-11-02T08:00:00Z", values: { systolicBp: 137, diastolicBp: 80 }, protocols: {}, quality: {} };
  const ev = evaluateSelfCheck(check, [], { limits: applySurgeonLimits(s) });
  const text = surgeonReport(ev, check, { profile: "This device", surgeonLimits: s });
  assert.match(text, /Safety limits set by Dr\. A\. Rahman on 2026-11-02: Systolic · Tell today at or above 135 mmHg \(public guidance 140\)/);
  assert.match(text, /at or above 135 mmHg \(flight surgeon's limit\)/);
  assert.doesNotMatch(surgeonReport(ev, check, { profile: "This device" }), /Safety limits set by/);
});
