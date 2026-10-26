import test from "node:test";
import assert from "node:assert/strict";
import { estimateWavePulse, estimateFusedPulse, colourWaves, resampleWave, WAVE_PULSE } from "./wavePulse.js";
import { fusedPulseFromSamples, colourPulseFromSamples, CAMERA_PULSE, RESTING_CAMERA_PROTOCOL, LIVE_PULSE, FUSION_WEIGHTS } from "./cameraPulse.js";
import { PulseCapture } from "./rppg.js";
import { ME_CROP, Kalman1D, blazeBoxFromMesh, FaceBoxSmoother, clampCropBox, rgbaToModelInput, meTimeStep } from "./meRppg.js";

// Deterministic noise, so the tests never flake.
function noise(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
}

// A pulse wave at `bpm`, one sample per frame at `fps` with jittered timestamps, plus noise.
function wave(bpm, { seconds = 30, fps = 30, amp = 1, noiseAmp = 0.3, seed = 3, t0 = 1000 } = {}) {
  const r = noise(seed), out = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = t0 + i * 1000 / fps + r() * 4;
    out.push({ t, v: amp * Math.sin(2 * Math.PI * bpm / 60 * t / 1000) + noiseAmp * r() });
  }
  return out;
}

// Skin colour with a pulse that is strongest in green, as blood volume changes absorb green light most.
function skin(bpm, { seconds = 30, fps = 30, seed = 5, motion = 0.002, base = [170, 120, 95] } = {}) {
  const r = noise(seed), out = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = 1000 + i * 1000 / fps, p = Math.sin(2 * Math.PI * bpm / 60 * t / 1000);
    out.push({ t, rgb: [base[0] * (1 + 0.0015 * p) + r() * 0.2, base[1] * (1 + 0.004 * p) + r() * 0.2, base[2] * (1 + 0.002 * p) + r() * 0.2], motion });
  }
  return out;
}

test("wave pulse: a 72 bpm wave at a jittered 30 fps reads 72 bpm with a clear peak", () => {
  const result = estimateWavePulse(wave(72));
  assert.equal(result.status, "estimated");
  assert.ok(Math.abs(result.bpmExact - 72) < 1, `got ${result.bpmExact}`);
  assert.ok(result.quality >= WAVE_PULSE.minQuality);
});

test("wave pulse: waits for 15 s, refuses low cadence and long gaps", () => {
  assert.equal(estimateWavePulse(wave(72, { seconds: 10 })).status, "insufficient");
  assert.match(estimateWavePulse(wave(72, { fps: 10 })).reason, /cadence/);
  const gappy = wave(72).filter((s, i) => i < 300 || i > 340);
  assert.equal(resampleWave(gappy), null, "a 1.3 s gap is not bridged");
  assert.equal(estimateWavePulse(gappy).status, "insufficient");
});

test("wave pulse: pure noise is refused as ambiguous instead of guessed", () => {
  const result = estimateWavePulse(wave(72, { amp: 0, noiseAmp: 1, seed: 11 }));
  assert.equal(result.status, "insufficient");
});

test("hybrid fusion: a clean wave outvotes a noisy wrong one", () => {
  const clean = wave(66, { seed: 7, noiseAmp: 0.2 });
  const noisy = wave(96, { seed: 9, amp: 0.25, noiseAmp: 1.2 });
  const fused = estimateFusedPulse([{ name: "clean", samples: clean }, { name: "noisy", samples: noisy }]);
  assert.equal(fused.status, "estimated");
  assert.ok(Math.abs(fused.bpmExact - 66) < 1, `got ${fused.bpmExact}`);
  assert.equal(fused.parts.length, 2);
  assert.ok(fused.parts[0].weight > fused.parts[1].weight);
});

test("hybrid fusion: agreeing waves fuse to the shared rate; nothing usable is refused", () => {
  const fused = estimateFusedPulse([{ name: "a", samples: wave(84, { seed: 2 }) }, { name: "b", samples: wave(84, { seed: 4, noiseAmp: 0.6 }) }]);
  assert.ok(Math.abs(fused.bpmExact - 84) < 1);
  assert.equal(estimateFusedPulse([{ name: "short", samples: wave(84, { seconds: 5 }) }]).status, "insufficient");
});

test("colour waves: POS and CHROM recover the pulse from skin colour", () => {
  const waves = colourWaves(skin(78));
  assert.ok(waves);
  assert.ok(Math.abs(waves.fs - 30) < 0.5);
  for (const name of ["pos", "chrom"]) {
    const r = estimateWavePulse(waves[name], { minQuality: 0 });
    assert.ok(Math.abs(r.bpmExact - 78) < 1.5, `${name} read ${r.bpmExact}`);
  }
});

test("camera pulse: the shipped hybrid reads still skin and refuses movement and bad light", () => {
  const samples = skin(70).map(s => ({ ...s, bvp: null }));
  const still = fusedPulseFromSamples(samples);
  assert.equal(still.status, "estimated");
  assert.ok(Math.abs(still.bpmExact - 70) < 1.5, `got ${still.bpmExact}`);
  assert.deepEqual(still.parts.map(p => p.name), ["POS"]);
  assert.deepEqual(fusedPulseFromSamples(samples, { weights: { me: 1, pos: 1, chrom: 1 } }).parts.map(p => p.name), ["POS", "CHROM"]);
  const moving = samples.map((s, i) => ({ ...s, motion: i % 5 === 0 ? 0.08 : 0.002 }));
  assert.match(fusedPulseFromSamples(moving).reason, /movement/);
  const dark = skin(70, { base: [40, 22, 15] }).map(s => ({ ...s, bvp: null }));
  assert.match(fusedPulseFromSamples(dark).reason, /Lighting/);
  assert.match(fusedPulseFromSamples([]).reason, /No face/);
  // A slow device: the same skin at 7 frames a second is refused with the reason, not "collecting".
  const slow = samples.filter((_, i) => i % 4 === 0);
  assert.match(fusedPulseFromSamples(slow).reason, /frames a second/);
});

test("camera pulse: the deep model leads the fusion, POS at a quarter weight", () => {
  const colour = skin(64), deep = wave(64, { t0: 1000, seed: 13, noiseAmp: 0.2 });
  const samples = colour.map((s, i) => ({ ...s, bvp: deep[i].v }));
  const result = fusedPulseFromSamples(samples);
  assert.deepEqual(result.parts.map(p => p.name), ["ME-rPPG", "POS"]);
  result.parts.forEach((p, i) => assert.ok(Math.abs(p.weight / p.quality ** 2 - [1, 0.25][i]) < 1e-9));
  assert.deepEqual({ ...FUSION_WEIGHTS }, { me: 1, pos: 0.25, chrom: 0 });
  assert.ok(Math.abs(result.bpmExact - 64) < 1.5);
  assert.equal(RESTING_CAMERA_PROTOCOL, "resting-camera-hybrid-v1");
  assert.equal(CAMERA_PULSE.seconds, 45);
});

test("ME-rPPG crop: mesh box maps to the detector box, Kalman-smoothed, 20 % taller and raised", () => {
  const landmarks = [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.5, y: 0.6 }];
  const box = blazeBoxFromMesh(landmarks, 640, 480);
  assert.ok(Math.abs(box.width - 1.0849 * 128) < 1e-6);
  assert.ok(Math.abs(box.height - 0.9405 * 144) < 1e-6);
  assert.equal(blazeBoxFromMesh([], 640, 480), null);
  const smoother = new FaceBoxSmoother(), first = smoother.update(box);
  assert.ok(Math.abs(first.h - box.height * 1.2) < 1e-6);
  assert.ok(Math.abs(first.y - (box.originY - first.h * 0.2)) < 1e-6);
  const moved = smoother.update({ ...box, originX: box.originX + 50 });
  assert.ok(moved.x > first.x && moved.x < first.x + 50, "a jump is followed gradually");
  const k = new Kalman1D(0.01, 0.5, 0, 1);
  for (let i = 0; i < 200; i++) k.update(10);
  assert.ok(Math.abs(k.x - 10) < 0.01);
});

test("ME-rPPG input: crop clamped to the frame, pixels scaled to 0-1, time step floored at 1/90 s", () => {
  assert.deepEqual(clampCropBox({ x: -10, y: 5, w: 100, h: 700 }, 640, 480), { x: 0, y: 5, w: 100, h: 475 });
  assert.equal(clampCropBox({ x: 639, y: 0, w: 50, h: 50 }, 640, 480), null);
  const rgba = new Uint8ClampedArray(ME_CROP * ME_CROP * 4).fill(255);
  rgba[0] = 0; rgba[1] = 51;
  const input = rgbaToModelInput(rgba);
  assert.equal(input.length, ME_CROP * ME_CROP * 3);
  assert.deepEqual([input[0], input[1], input[2], input[3]], [0, Math.fround(0.2), 1, 1]);
  assert.equal(meTimeStep(null, 1000), 1 / 30);
  assert.equal(meTimeStep(1000, 1033), 0.033);
  assert.equal(meTimeStep(1000, 1001), 1 / 90);
});

test("live capture pulse: the face-colour POS wave with the validated gate, plugged into PulseCapture", () => {
  const result = colourPulseFromSamples(skin(75));
  assert.equal(result.status, "estimated");
  assert.ok(Math.abs(result.bpmExact - 75) < 1.5, `got ${result.bpmExact}`);
  assert.equal(result.reason, "Experimental camera estimate");
  assert.equal(colourPulseFromSamples(skin(75, { seconds: 8 })).status, "insufficient", `needs ${LIVE_PULSE.minSeconds} s`);
  assert.match(colourPulseFromSamples(skin(75).map((s, i) => ({ ...s, motion: i % 4 ? 0.002 : 0.09 }))).reason, /movement/);
  // PulseCapture draws frames on a canvas; a stub document is enough to check which estimator it uses.
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  try {
    assert.equal(new PulseCapture({ estimate: colourPulseFromSamples, onResult() {} }).estimate, colourPulseFromSamples);
    assert.notEqual(new PulseCapture({ onResult() {} }).estimate, colourPulseFromSamples, "the default stays estimatePulse");
  } finally { delete globalThis.document; }
});
