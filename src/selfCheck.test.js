import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizePvt, PVT_PROTOCOL, personalReference, evaluateIndicator, lockedReference, driftCheck, evaluateSelfCheck, recommendActions, newCheck, createSelfCheckStore, PVT_B, INDICATORS,
  backupPacket, restoreBackup, SPREAD, pvtDeviceClass,
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

test("a reaction test is compared only with tests answered the same way, and one that switches is repeated", () => {
  const answered = (input, n = 40, other = null, k = 0) => [...Array(n - k).fill({ rtMs: 300, input }), ...Array(k).fill({ rtMs: 300, input: other })];
  const touch = summarizePvt(answered("touch")), key = summarizePvt(answered("key"));
  assert.deepEqual([touch.input, touch.compareAs, touch.usable], ["touch", `${PVT_PROTOCOL.full}:touch`, true]);
  assert.equal(key.compareAs, `${PVT_PROTOCOL.full}:key`);
  assert.equal(summarizePvt(answered("touch", 40, "key", 2)).input, "touch", "a stray key press or two does not spoil a tapped test");
  const mixed = summarizePvt(answered("touch", 40, "key", 10));
  assert.deepEqual([mixed.input, mixed.usable], ["mixed", false]);
  assert.match(mixed.reason, /one way/);
  assert.equal(summarizePvt([...answered("touch", 30), { rtMs: PVT_B.timeoutMs }]).input, "touch", "a 30 s timeout has no input and does not count against the main one");
  const legacy = summarizePvt(trials(Array(40).fill(300)));
  assert.deepEqual([legacy.input, legacy.compareAs], [null, PVT_PROTOCOL.full], "results without input keep the plain protocol");
  const onMac = summarizePvt(answered("key"), { device: "macos-safari" });
  assert.equal(onMac.compareAs, `${PVT_PROTOCOL.full}:key:macos-safari`, "the device and browser family join the protocol");
  const history = [3.3, 3.4, 3.3, 3.35].map(v => ({ values: { pvtSpeed: v }, protocols: { pvtSpeed: key.compareAs } }));
  assert.equal(evaluateIndicator("pvtSpeed", 2.6, history, { protocol: touch.compareAs }).status, "baseline", "tapping after weeks of the space bar starts a new baseline");
  assert.equal(evaluateIndicator("pvtSpeed", 2.6, history, { protocol: key.compareAs }).status, "changed");
});

test("the device class keeps only the operating system and browser family", () => {
  const cases = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", 5, "ios-safari"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 5, "ios-safari"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 0, "macos-safari"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", 5, "android-chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", 0, "windows-edge"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0", 0, "windows-firefox"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", 0, "linux-chrome"],
  ];
  for (const [ua, touch, expected] of cases) assert.equal(pvtDeviceClass(ua, touch), expected, ua);
  assert.equal(pvtDeviceClass(), "other-other");
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

test("one value just outside the usual range asks for a re-check; two in a row or one far outside is a change", () => {
  const history = [160, 161, 159, 160].map(v => ({ values: { kneeExtension: v } }));
  const once = evaluateIndicator("kneeExtension", 154, history);
  assert.deepEqual([once.status, once.reason], ["recheck", "once"], "6 degrees down: beyond the 5-degree range, inside 1.5 times it");
  assert.equal(evaluateIndicator("kneeExtension", 152, history).status, "changed", "8 degrees down is far outside");
  assert.equal(evaluateIndicator("kneeExtension", 154, history, { multirule: false }).status, "changed", "the original single-value rule");
  history.push({ values: { kneeExtension: 154 } });
  const twice = evaluateIndicator("kneeExtension", 154, history);
  assert.deepEqual([twice.status, twice.reason], ["changed", "day"], "the second value outside in a row is a change, though the rolling range has moved towards it");
  const hr = [64, 65, 64, 66, 74].map(v => ({ values: { restingHr: v } }));
  assert.equal(evaluateIndicator("restingHr", 56, hr).status, "recheck", "outside on the other side is not two in a row");
});

test("once there are 10 checks the usual range takes its spread from up to 30 of them, so 5 lucky-tight checks cannot shrink it", () => {
  const series = [55, 69, 57, 67, 54, 70, 56, 68, 55, 69, 62, 62, 62, 62, 62], history = series.map(v => ({ values: { restingHr: v } }));
  const ranges = series.slice(1).map((v, i) => Math.abs(v - series[i]));
  const now = evaluateIndicator("restingHr", 72, history), original = evaluateIndicator("restingHr", 72, history, { multirule: false });
  assert.ok(Math.abs(now.tolerance - 2 * ranges.reduce((a, b) => a + b, 0) / ranges.length / 1.128) < 1e-9, "2 x the moving-range SD of every usable check");
  assert.equal(now.status, "stable", "10 bpm is ordinary for this person");
  assert.deepEqual([original.tolerance, original.status], [8, "changed"], "the last 5 checks alone have no spread, so the 8 bpm floor decided");
  assert.equal(SPREAD.window, 30);
  const short = [64, 65, 64, 66, 65, 64].map(v => ({ values: { restingHr: v } }));
  assert.equal(evaluateIndicator("restingHr", 74, short).tolerance, 8, "under 10 checks: the 5-check SD, here below the floor");
});

test("a re-check is one bounded action and nothing is logged for review", () => {
  const history = [160, 161, 159, 160].map(v => ({ values: { kneeExtension: v } }));
  const result = evaluateSelfCheck({ ...newCheck("you"), values: { kneeExtension: 154 } }, history);
  assert.equal(result.overall, "recheck");
  assert.deepEqual(result.actions.map(a => a.id), ["recheck"]);
  assert.match(result.actions[0].text, /^Check knee extension again at your next self-check\. It is just outside your usual range today\./);
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

test("Elena's demo day 147 flags bone/muscle and behavioral changes, asks to re-check heart rate and sleep, keeps immune stable", () => {
  const evaluation = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY);
  const status = Object.fromEntries(evaluation.domains.map(d => [d.key, d.status]));
  assert.deepEqual(status, { musculoskeletal: "changed", cardiovascular: "recheck", metabolic: "stable", behavioral: "changed", immune: "stable" });
  const rows = evaluation.domains.flatMap(d => d.indicators), keys = s => rows.filter(r => r.status === s).map(r => r.key).sort();
  assert.deepEqual(keys("changed"), ["kneeExtension", "kneeRom", "pvtLapses", "pvtSpeed"]);
  assert.deepEqual(keys("recheck"), ["restingHr", "sleepHours"]);
  // The original single-value rule flagged all six.
  const single = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY, { multirule: false }).domains.flatMap(d => d.indicators);
  assert.equal(single.filter(r => r.status === "changed").length, 6);
});

test("a poor demo capture is withheld and asks for a repeat instead of a comparison", () => {
  const evaluation = evaluateSelfCheck(elenaDay147(ELENA_POOR_CAPTURE), ELENA_HISTORY);
  const msk = evaluation.domains.find(d => d.key === "musculoskeletal");
  assert.ok(msk.indicators.every(r => r.status === "repeat"));
  assert.ok(evaluation.actions.some(a => a.id === "repeat-kneeExtension"));
});

test("a backup restores a lost baseline, keeps checks already here and reads only numbers it uses", () => {
  // Elena's values as if typed on this device, one check a month.
  const mine = ELENA_HISTORY.map((c, i) => ({ ...c, profileId: "you", missionDay: undefined, at: new Date(Date.UTC(2026, 4 + i, 1)).toISOString() }));
  const saved = mine.slice(3), packet = JSON.parse(JSON.stringify(backupPacket(mine, "2026-10-29T00:00:00Z")));
  const result = restoreBackup(saved, packet);
  assert.equal(result.added, mine.length - saved.length);
  assert.equal(result.skipped, saved.length);
  assert.deepEqual(result.checks.map(c => c.id), mine.map(c => c.id), "oldest first, no duplicates");
  assert.deepEqual(evaluateSelfCheck(elenaDay147(), result.checks).domains.map(d => d.status), evaluateSelfCheck(elenaDay147(), ELENA_HISTORY).domains.map(d => d.status), "the restored baseline gives the same result");
  const odd = restoreBackup([], { schema: "astrobone-self-check-backup-v1", checks: [
    { id: "a", at: "2026-10-01T08:00:00Z", values: { restingHr: 60, kneeExtension: "<img src=x>", unknown: 5 }, quality: { restingHr: "yes" } },
    { id: "b", at: "not a date", values: { restingHr: 61 } }, null] });
  assert.equal(odd.added, 1);
  assert.deepEqual(odd.checks[0].values, { restingHr: 60 });
  assert.deepEqual(odd.checks[0].quality, {});
  assert.throws(() => restoreBackup([], { checks: [] }), /not an AstroBone self-check backup/);
  assert.equal(restoreBackup([], { schema: "astrobone-self-check-export-v1", check: ELENA_HISTORY[0] }).added, 1, "a single exported check is accepted");
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
  const history = Array(4).fill([170, 171, 169, 170, 170]).flat().map(v => ({ values: { kneeExtension: v } }));
  assert.equal(lockedReference(history, "kneeExtension").count, 20, "the first 20 usable checks");
  assert.equal(lockedReference(history.slice(0, 7), "kneeExtension").count, 7, "all of them while there are fewer");
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
