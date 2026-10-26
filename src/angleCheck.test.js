import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHold, agreement, calibratedFloors, pairsToCsv, createAngleCheckStore, flexionToInterior, HOLD } from "./angleCheck.js";

const frame = (knee, usable = true) => ({ usable, angles: { left: { knee }, right: { knee: 170 } } });

test("goniometer flexion and camera interior angle convert both ways", () => {
  assert.equal(flexionToInterior(0), 180);
  assert.equal(flexionToInterior(90), 90);
});

test("a steady, well-tracked hold is summarized in flexion degrees", () => {
  const hold = summarizeHold(Array.from({ length: 20 }, (_, i) => frame(120 + (i % 2))), "left");
  assert.equal(hold.usable, true);
  assert.equal(hold.interior, 120.5);
  assert.equal(hold.flexion, 59.5);
});

test("too few usable frames or a moving knee is not paired", () => {
  const few = summarizeHold([...Array(HOLD.minSamples - 1)].map(() => frame(120)).concat(Array(20).fill(frame(120, false))), "left");
  assert.equal(few.usable, false);
  assert.match(few.reason, /usable frames/);
  const moving = summarizeHold(Array.from({ length: 20 }, (_, i) => frame(100 + i * 2)), "left");
  assert.equal(moving.usable, false);
  assert.match(moving.reason, /moved/);
});

test("Bland-Altman bias, limits of agreement and detectable change", () => {
  const diffs = [2, 4, 3, 5, 1, 3];
  const pairs = diffs.map((d, i) => ({ participant: `P${i % 3}`, referenceFlexion: 40 + i * 10, cameraFlexion: 40 + i * 10 + d }));
  const result = agreement(pairs);
  assert.equal(result.ready, true);
  assert.equal(result.n, 6);
  assert.equal(result.people, 3);
  assert.equal(result.bias, 3);
  assert.equal(result.sdDiff, 1.4);
  assert.deepEqual(result.loa, [0.2, 5.8]);
  assert.equal(result.mdc95, 3.9);
  assert.equal(result.triggerAboveNoise, true);
  assert.match(result.caution, /preliminary/);
});

test("agreement waits for at least two pairs", () => {
  assert.equal(agreement([{ participant: "P1", referenceFlexion: 10, cameraFlexion: 12 }]).ready, false);
});

test("CSV export quotes free text and includes the difference", () => {
  const csv = pairsToCsv([{ participant: 'A,"x"', side: "left", referenceType: "Goniometer", referenceFlexion: 30, cameraFlexion: 33.5, holdSd: 0.8, samples: 24, at: "t" }]);
  assert.equal(csv.split("\n")[1], '"A,""x""",left,Goniometer,30,33.5,0.8,24,3.5,t');
});

test("pairs stay in memory unless saving is consented", () => {
  const backing = new Map();
  const storage = { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, v), removeItem: k => backing.delete(k) };
  const store = createAngleCheckStore(storage);
  store.save([{ participant: "P1" }], false);
  assert.equal(backing.size, 0);
  assert.equal(store.load(false).length, 1);
  store.save([{ participant: "P1" }, { participant: "P2" }], true);
  assert.equal(store.load(true).length, 2);
  store.clear();
  assert.equal(store.load(true).length, 0);
});

test("the knee review floor is raised to the measured detectable change only for a large enough pilot", () => {
  const pairs = n => Array.from({ length: n }, (_, i) => ({ participant: `P${i % 4}`, cameraFlexion: 30 + (i % 2 ? 4 : -4), referenceFlexion: 30 }));
  assert.deepEqual(calibratedFloors(pairs(10)), {}, "fewer than 20 pairs keeps the default");
  const floors = calibratedFloors(pairs(24));
  assert.ok(floors.kneeExtension > 5);
  assert.equal(floors.kneeExtension, agreement(pairs(24)).mdc95);
  const tight = Array.from({ length: 24 }, (_, i) => ({ participant: `P${i % 4}`, cameraFlexion: 30 + (i % 2 ? 0.5 : -0.5), referenceFlexion: 30 }));
  assert.deepEqual(calibratedFloors(tight), {}, "a precise camera never lowers the floor below the default");
});
