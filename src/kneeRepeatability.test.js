import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, repetitions, repeatNoise, kneeNoiseByPosition, facingMinusSideOn, videoRepetitions, videoRepeatNoise, kneeRepeatNoiseEstimate } from "./kneeRepeatability.js";
import { KNEE_REPEAT_NOISE } from "./selfCheck.js";

const read = name => parseCsv(readFileSync(new URL(`../data/validation/${name}`, import.meta.url), "utf8"));
const reps = read("rehab24-knee-reps.csv"), methods = read("rehab24-knee-methods.csv"), video = read("rehab24-squat-video.csv");

test("the saved files parse, quoted method names included", () => {
  assert.equal(reps.length, 928);
  assert.equal(methods.find(m => m.exercise_view === "Ex6|side" && m.method.startsWith("Learned trees + fallback")).extension_mae_deg, 4.97);
  assert.equal(methods.filter(m => m.method === "Pretrained, 3D angle (app before)").length, 7);
  assert.equal(video.length, 344);
});

test("rows regroup into repetitions: the side-on knee is the first facing knee of the same repetition", () => {
  const both = repetitions(reps).filter(r => r.knees.facingA && r.knees.sideOn);
  const same = both.filter(r => Math.abs(r.knees.facingA.mocap_rom_deg - r.knees.sideOn.mocap_rom_deg) < 0.15);
  assert.ok(both.length > 170 && same.length / both.length > 0.95, `${same.length} of ${both.length}`);
  const counted = repetitions(reps).reduce((n, r) => n + Object.keys(r.knees).length, 0);
  assert.equal(counted, 928, "every row lands in exactly one repetition");
});

test("repeat noise uses consecutive differences, so a constant offset (a person's own bias) cancels", () => {
  const noise = repeatNoise([[10, 10, 10, 10], [-20, -20, -20]]);
  assert.equal(noise.sd, 0); assert.equal(noise.pairs, 5);
  const alternating = repeatNoise([[0, 2, 0, 2, 0]]);
  assert.equal(alternating.sd, Number((2 / 1.128).toFixed(1)));
  assert.equal(alternating.mdc95, Number((1.96 * Math.SQRT2 * 2 / 1.128).toFixed(1)));
});

test("the app's knee noise figures are the ones the saved data give", () => {
  const e = kneeRepeatNoiseEstimate(reps, methods);
  assert.deepEqual({ sd: e.extensionSd, mdc95: e.extensionMdc95 }, { ...KNEE_REPEAT_NOISE.kneeExtension });
  assert.deepEqual({ sd: e.romSd, mdc95: e.romMdc95 }, { ...KNEE_REPEAT_NOISE.kneeRom });
  const one = videoRepeatNoise(video, "side_on");
  assert.equal(one.reps, KNEE_REPEAT_NOISE.oneVideo.squats);
  assert.equal(one.extension.repeatSd, KNEE_REPEAT_NOISE.oneVideo.kneeExtension);
  assert.equal(one.rom.repeatSd, KNEE_REPEAT_NOISE.oneVideo.kneeRom);
  assert.ok(one.extension.repeatSd < e.extensionSd && one.rom.repeatSd < e.romSd, "the figures the app uses are the cautious ones");
  assert.equal(facingMinusSideOn(reps).find(r => r.movement === "squat").bias, -KNEE_REPEAT_NOISE.facingMinusSideOn);
});

test("side-on repeats are the steadiest, and the hybrid repeats no worse than the old 3D angle there", () => {
  const rows = kneeNoiseByPosition(reps), before = kneeNoiseByPosition(reps, "before");
  for (const movement of ["squat", "lunge"]) {
    const side = rows.find(r => r.movement === movement && r.position === "side-on"), facing = rows.find(r => r.movement === movement && r.position === "facing");
    assert.ok(side.repeat.sd < facing.repeat.sd, movement);
    assert.ok(Math.abs(side.agreement.bias) < Math.abs(facing.agreement.bias), movement);
    assert.ok(side.repeat.sd <= before.find(r => r.movement === movement && r.position === "side-on").repeat.sd, movement);
  }
  assert.ok(rows.every(r => r.repeat.sd < r.agreement.sd), "part of every position's error is the person's own steady offset");
});

test("one video splits into its 21 squats and the per-squat errors are finite", () => {
  for (const camera of ["side_on", "facing"]) {
    const r = videoRepetitions(video, camera);
    assert.equal(r.length, 21, camera);
    assert.ok(r.every(x => Number.isFinite(x.extensionError) && Number.isFinite(x.romError)));
  }
});

test("the validation doc's repeat-noise section is the script's current output", async () => {
  const { kneeRepeatabilityMarkdown } = await import("../scripts/validation/knee-repeatability.mjs");
  const doc = readFileSync(new URL("../docs/real-video-validation.md", import.meta.url), "utf8");
  assert.ok(doc.includes(kneeRepeatabilityMarkdown().trim()), "rerun: node scripts/validation/knee-repeatability.mjs and paste section 5");
});
