import test from "node:test";
import assert from "node:assert/strict";
import { createPoseRuntime, closePoseRuntime } from "./poseRuntime.js";

test("automatic pose runtime selects GPU and releases its own context", async () => {
  const calls = []; let released = 0, closed = 0;
  const canvas = { getContext: () => ({ getExtension: () => ({ loseContext: () => released++ }) }) };
  const runtime = await createPoseRuntime({ createCanvas: () => canvas,
    createLandmarker: async (delegate, target) => { calls.push([delegate, target]); return { close: () => closed++ }; } });
  assert.deepEqual(calls, [["GPU", canvas]]);
  assert.equal(runtime.info.delegate, "GPU");
  closePoseRuntime(runtime);
  assert.equal(released, 1); assert.equal(closed, 1);
});

test("GPU initialization failure falls back once with observable reason", async () => {
  const calls = [], progress = [];
  const runtime = await createPoseRuntime({ createCanvas: () => ({}), onProgress: label => progress.push(label),
    createLandmarker: async delegate => { calls.push(delegate); if (delegate === "GPU") throw new Error("GPU disabled"); return {}; } });
  assert.deepEqual(calls, ["GPU", "CPU"]);
  assert.equal(runtime.info.delegate, "CPU");
  assert.equal(runtime.info.fallbackReason, "GPU disabled");
  assert.match(progress.at(-1), /CPU/);
});

test("CPU override never creates a GPU canvas", async () => {
  const runtime = await createPoseRuntime({ preference: "CPU", createCanvas: () => { throw new Error("Must not run"); },
    createLandmarker: async delegate => { assert.equal(delegate, "CPU"); return {}; } });
  assert.deepEqual(runtime.info, { delegate: "CPU", preference: "CPU", fallbackReason: null });
});

test("missing offscreen support is a supported CPU fallback", async () => {
  const runtime = await createPoseRuntime({ createCanvas: () => null, createLandmarker: async () => ({}) });
  assert.equal(runtime.info.delegate, "CPU");
  assert.match(runtime.info.fallbackReason, /unavailable/);
});

test("strict GPU and total initialization failure propagate errors", async () => {
  await assert.rejects(createPoseRuntime({ preference: "GPU", createCanvas: () => null }), /unavailable/);
  await assert.rejects(createPoseRuntime({ createCanvas: () => null, createLandmarker: async () => { throw new Error("No runtime"); } }), /No runtime/);
  await assert.rejects(createPoseRuntime({ preference: "invalid" }), /Unknown/);
});
