import test from "node:test";
import assert from "node:assert/strict";
import { surgeonReport, rowReason, byteSize, REPORT_BOUNDARY } from "./surgeonReport.js";
import { evaluateSelfCheck } from "./selfCheck.js";
import { ELENA_HISTORY, ELENA_POOR_CAPTURE, elenaDay147 } from "./elenaSelfCheck.js";
import { environmentFor } from "./missionEnvironment.js";

const mars = environmentFor("marsTransit");
const report = (check, opts = {}) => surgeonReport(evaluateSelfCheck(check, ELENA_HISTORY, { environment: mars }), check, { environment: mars, profile: "DEMO-ELENA (synthetic)", ...opts });

test("Elena's Day 147 report leads with the overall result and lists every change before anything stable", () => {
  const text = report(elenaDay147()), lines = text.split("\n");
  assert.equal(lines[0], "ASTROBONE SELF-CHECK REPORT · DEMO-ELENA (synthetic) · Mission day 147");
  assert.match(lines[1], /Earth-Mars transit · message to Earth 3-22 min one way/);
  assert.equal(lines[2], "Overall: REVIEW");
  assert.equal(lines[3], "Red flags: none reported");
  const needs = lines.indexOf("NEEDS A LOOK"), stable = lines.findIndex(l => l.startsWith("STABLE"));
  assert.ok(needs > 0 && stable > needs);
  assert.match(text, /- REVIEW: Bone & muscle, Knee extension 151° \(usual 162 ± 6\.9\)/);
  assert.match(text, /STABLE \(within usual range\): Systolic 112 mmHg, Diastolic 72 mmHg/);
  assert.equal(lines.at(-1), REPORT_BOUNDARY);
});

test("the report is small enough for a slow link and much smaller than the JSON record", () => {
  const check = elenaDay147(), ev = evaluateSelfCheck(check, ELENA_HISTORY, { environment: mars });
  const text = surgeonReport(ev, check, { environment: mars }), json = JSON.stringify({ check, evaluation: ev }, null, 2);
  assert.ok(byteSize(text) < 2048, `${byteSize(text)} bytes`);
  assert.ok(byteSize(json) / byteSize(text) > 8);
});

test("an urgent safety limit and a red flag come first, with the limit named", () => {
  const check = elenaDay147();
  check.values.systolicBp = 186; check.values.diastolicBp = 95; check.redFlags = { chestPain: true };
  const text = report(check);
  assert.match(text, /^Overall: URGENT$/m);
  assert.doesNotMatch(text, /^Red flags: none/m);
  const first = text.split("\n").find(l => l.startsWith("- "));
  assert.equal(first, "- URGENT: Cardiovascular, Blood pressure, systolic 186 mmHg (safety limit: above 180 mmHg)");
});

test("a failed capture is reported as not compared, never as a decline", () => {
  const check = elenaDay147(ELENA_POOR_CAPTURE), text = report(check);
  assert.match(text, /- REPEAT: Bone & muscle, Knee extension 135° \(quality check failed, not compared\)/);
  assert.match(text, /not compared \(quality\): Knee extension, Knee range of motion/);
});

test("after saving, the report lists the actions the astronaut chose", () => {
  const text = report(elenaDay147(), { followUps: [{ text: "Repeat the knee test tomorrow." }] });
  assert.match(text, /ACTIONS THE ASTRONAUT SELECTED\n- Repeat the knee test tomorrow\./);
  assert.doesNotMatch(text, /WHAT THE ASTRONAUT WAS ADVISED/);
});

test("reasons stay descriptive: no diagnosis, no treatment", () => {
  const check = elenaDay147(); check.values.glucose = 250;
  const text = report(check);
  assert.match(text, /Blood sugar 250 mg\/dL \(safety limit: above 240 mg\/dL\)/);
  assert.doesNotMatch(text.replace(REPORT_BOUNDARY, ""), /diagnos|prescri|insulin|dose of/i);
  assert.equal(rowReason({ status: "baseline", def: {}, ref: { count: 1, needed: 3 } }), "building baseline 1/3");
});
