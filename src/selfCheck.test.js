import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizePvt, personalReference, evaluateIndicator, evaluateSelfCheck, recommendActions, newCheck, createSelfCheckStore, PVT_B, INDICATORS,
} from "./selfCheck.js";
import { ELENA_HISTORY, elenaDay147, ELENA_POOR_CAPTURE } from "./elenaSelfCheck.js";

const trials = rts => rts.map(rtMs => ({ rtMs }));

test("PVT-B scoring counts lapses at 355 ms and early taps as false starts", () => {
  const summary = summarizePvt([...trials([250, 300, 360, 400, 80]), { falseStart: true }], { durationMs: PVT_B.durationMs });
  assert.equal(summary.validResponses, 4);
  assert.equal(summary.lapses, 2);
  assert.equal(summary.falseStarts, 2);
  assert.equal(summary.protocol, "pvt-b-3min");
  assert.equal(summary.usable, false, "too few valid responses for a 3-minute test");
  const full = summarizePvt(trials(Array.from({ length: 40 }, () => 300)));
  assert.equal(full.usable, true);
  assert.equal(full.meanSpeed, Number((1000 / 300).toFixed(3)));
});

test("an unfinished or practice-length test is labeled and gated", () => {
  assert.equal(summarizePvt(trials(Array(40).fill(300)), { completed: false }).usable, false);
  assert.equal(summarizePvt(trials(Array(12).fill(300)), { durationMs: PVT_B.practiceDurationMs }).protocol, "pvt-practice");
});

test("a personal reference needs three usable checks of the same protocol", () => {
  const history = [1, 2].map(i => ({ values: { pvtLapses: i }, protocols: { pvtLapses: "pvt-b-3min" } }));
  assert.equal(personalReference(history, "pvtLapses", "pvt-b-3min").ready, false);
  history.push({ values: { pvtLapses: 3 }, protocols: { pvtLapses: "pvt-practice" } });
  assert.equal(personalReference(history, "pvtLapses", "pvt-b-3min").ready, false, "practice tests are not mixed with 3-minute tests");
  history.push({ values: { pvtLapses: 3 }, protocols: { pvtLapses: "pvt-b-3min" }, quality: { pvtLapses: false } });
  assert.equal(personalReference(history, "pvtLapses", "pvt-b-3min").ready, false, "failed-quality results are excluded");
});

test("indicators respect direction, personal spread and the review floor", () => {
  const history = [160, 161, 159, 160].map(v => ({ values: { kneeExtension: v } }));
  assert.equal(evaluateIndicator("kneeExtension", 157, history).status, "stable", "3 degrees is inside the 5-degree floor");
  assert.equal(evaluateIndicator("kneeExtension", 152, history).status, "changed");
  assert.equal(evaluateIndicator("kneeExtension", 175, history).status, "stable", "improvement is not a worsening");
  assert.equal(evaluateIndicator("kneeExtension", 150, history, { usable: false }).status, "repeat");
  assert.equal(evaluateIndicator("kneeExtension", null, history).status, "notChecked");
  const hr = [64, 65, 64, 66].map(v => ({ values: { restingHr: v } }));
  assert.equal(evaluateIndicator("restingHr", 50, hr).status, "changed", "heart rate flags both directions");
});

test("red flags make the check urgent and put contact-now first", () => {
  const check = { ...newCheck("you"), redFlags: { chestPain: true }, values: {} };
  const result = evaluateSelfCheck(check, []);
  assert.equal(result.overall, "urgent");
  assert.equal(result.actions[0].id, "contact-now");
});

test("immune symptoms are reported as a change and reviewed", () => {
  const result = evaluateSelfCheck({ ...newCheck("you"), symptoms: { fever: true } }, []);
  const immune = result.domains.find(d => d.key === "immune");
  assert.equal(immune.status, "changed");
  assert.ok(result.actions.some(a => a.id === "review-immune"));
});

test("actions stay bounded: no diagnosis, treatment or exercise prescription", () => {
  const evaluation = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY);
  for (const action of evaluation.actions) assert.doesNotMatch(action.text, /diagnos|prescri|dose of|take \d|medication|treatment/i);
});

test("Elena's demo day 147 flags bone/muscle, cardiovascular and behavioral changes, not immune", () => {
  const evaluation = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY);
  const status = Object.fromEntries(evaluation.domains.map(d => [d.key, d.status]));
  assert.deepEqual(status, { musculoskeletal: "changed", cardiovascular: "changed", behavioral: "changed", immune: "stable" });
  const behavioral = evaluation.domains.find(d => d.key === "behavioral").indicators.filter(r => r.status === "changed").map(r => r.key);
  assert.deepEqual(behavioral.sort(), ["pvtLapses", "pvtSpeed", "sleepHours"]);
});

test("a poor demo capture is withheld and asks for a repeat instead of a comparison", () => {
  const evaluation = evaluateSelfCheck(elenaDay147(ELENA_POOR_CAPTURE), ELENA_HISTORY);
  const msk = evaluation.domains.find(d => d.key === "musculoskeletal");
  assert.ok(msk.indicators.every(r => r.status === "repeat"));
  assert.ok(evaluation.actions.some(a => a.id === "repeat-kneeExtension"));
});

test("store keeps records in memory unless consent to persist is given", () => {
  const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const store = createSelfCheckStore(storage);
  store.save("you", [{ id: 1 }], false);
  assert.equal(data.size, 0);
  assert.deepEqual(store.load("you", false), [{ id: 1 }]);
  store.save("you", [{ id: 2 }], true);
  assert.deepEqual(store.load("you", true), [{ id: 2 }]);
  assert.ok(Object.keys(INDICATORS).length >= 9);
  assert.ok(recommendActions([], []).length === 1);
});
