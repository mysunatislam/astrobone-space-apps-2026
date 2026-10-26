import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizePvt, PVT_PROTOCOL, personalReference, evaluateIndicator, lockedReference, driftCheck, evaluateSelfCheck, recommendActions, newCheck, createSelfCheckStore, PVT_B, INDICATORS,
} from "./selfCheck.js";
import { ELENA_HISTORY, elenaDay147, ELENA_POOR_CAPTURE } from "./elenaSelfCheck.js";

const trials = rts => rts.map(rtMs => ({ rtMs }));

test("PVT-B scoring counts lapses at 355 ms and early taps as false starts", () => {
  const summary = summarizePvt([...trials([250, 300, 360, 400, 80]), { falseStart: true }], { durationMs: PVT_B.durationMs });
  assert.equal(summary.validResponses, 4);
  assert.equal(summary.lapses, 2);
  assert.equal(summary.falseStarts, 2);
  assert.equal(summary.protocol, PVT_PROTOCOL.full);
  assert.equal(summary.usable, false, "too few valid responses for a 3-minute test");
  // Basner 2011 performance score: 100 % - (lapses + false starts) / (valid stimuli + false starts); 5 stimuli, 2 early.
  assert.equal(summary.performanceScore, 42.9);
  const full = summarizePvt(trials(Array.from({ length: 40 }, () => 300)));
  assert.equal(full.usable, true);
  assert.equal(full.meanSpeed, Number((1000 / 300).toFixed(3)));
});

test("PVT-B timing follows Basner 2011: 1-4 s intervals with 1 s feedback, 30 s response window", () => {
  assert.deepEqual([PVT_B.isiMinMs, PVT_B.isiMaxMs, PVT_B.feedbackMs, PVT_B.timeoutMs, PVT_B.lapseMs, PVT_B.falseStartMs], [1000, 4000, 1000, 30000, 355, 100]);
  assert.notEqual(PVT_PROTOCOL.full, "pvt-b-3min", "results from the old 2-5 s timing are never mixed with the new ones");
});

test("an unfinished or practice-length test is labeled and gated", () => {
  assert.equal(summarizePvt(trials(Array(40).fill(300)), { completed: false }).usable, false);
  assert.equal(summarizePvt(trials(Array(12).fill(300)), { durationMs: PVT_B.practiceDurationMs }).protocol, PVT_PROTOCOL.practice);
});

test("a personal reference needs three usable checks of the same protocol", () => {
  const history = [1, 2].map(i => ({ values: { pvtLapses: i }, protocols: { pvtLapses: PVT_PROTOCOL.full } }));
  assert.equal(personalReference(history, "pvtLapses", PVT_PROTOCOL.full).ready, false);
  history.push({ values: { pvtLapses: 3 }, protocols: { pvtLapses: PVT_PROTOCOL.practice } });
  assert.equal(personalReference(history, "pvtLapses", PVT_PROTOCOL.full).ready, false, "practice tests are not mixed with 3-minute tests");
  history.push({ values: { pvtLapses: 3 }, protocols: { pvtLapses: PVT_PROTOCOL.full }, quality: { pvtLapses: false } });
  assert.equal(personalReference(history, "pvtLapses", PVT_PROTOCOL.full).ready, false, "failed-quality results are excluded");
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

test("a slow decline that the rolling baseline absorbs is caught as drift from the locked baseline", () => {
  const history = [170, 171, 169, 170, 170].map(v => ({ values: { kneeExtension: v } }));
  assert.equal(lockedReference(history, "kneeExtension").count, 5);
  let row;
  for (let value = 169; value >= 162; value--) {
    row = evaluateIndicator("kneeExtension", value, history);
    if (value > 162) assert.equal(row.status, "stable", `${value} degrees is not yet a sustained drift`);
    history.push({ values: { kneeExtension: value } });
  }
  assert.equal(row.status, "changed");
  assert.equal(row.reason, "drift", "each day is inside the rolling tolerance; only the drift rule sees it");
  assert.ok(row.drift.sinceBaseline < -7);
});

test("ordinary day-to-day noise around a steady value does not raise drift", () => {
  const history = [];
  const noise = [0, 1, -1, 2, -2, 1, 0, -1, 1, -2, 2, 0, -1, 1, 0, -1, 2, -2, 1, 0, 0, 1, -1, 2, -2, 1, 0, -1, 1, -2];
  for (const n of noise) {
    const row = evaluateIndicator("kneeExtension", 170 + n, history);
    assert.notEqual(row.reason, "drift");
    history.push({ values: { kneeExtension: 170 + n } });
  }
  assert.equal(driftCheck("kneeExtension", 170, history).drift, false);
});

test("drift needs a locked baseline and never flags an improvement", () => {
  assert.equal(driftCheck("kneeExtension", 150, [170, 170].map(v => ({ values: { kneeExtension: v } }))).ready, false);
  const history = [170, 170, 170, 170, 170, ...Array(20).fill(178)].map(v => ({ values: { kneeExtension: v } }));
  assert.equal(driftCheck("kneeExtension", 178, history).drift, false);
});
