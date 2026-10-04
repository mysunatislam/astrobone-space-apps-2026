import test from "node:test";
import assert from "node:assert/strict";
import { validateDensePoseResult, sameDensePoseSource } from "./densePoseResult.js";
const valid = () => ({ status: "estimated", retains_frames: false, width: 320, height: 240, inference_ms: 100, people: 1, detection_score: .9, overlay: "data:image/png;base64,AAAA", iuv: "data:image/png;base64,AAAA", visible_parts: [1, 2, 24] });
test("DensePose validates private surface outputs without inventing internal anatomy", () => {
  assert.equal(validateDensePoseResult(valid()).status, "estimated");
  for (const change of [{ retains_frames: true }, { width: 0 }, { people: 2 }, { detection_score: 1.2 }, { visible_parts: [25] }, { overlay: "https://example.org/map.png" }]) assert.throws(() => validateDensePoseResult({ ...valid(), ...change }));
});
test("DensePose rejects output from an old source, cancelled input, or seek", () => {
  const source = { session: 1, kind: "video", active: true, starting: false };
  assert.equal(sameDensePoseSource(source, source, 2, 2), true);
  for (const change of [{ session: 2 }, { kind: "camera" }, { active: false }, { starting: true }]) assert.equal(sameDensePoseSource(source, { ...source, ...change }, 2, 2), false);
  assert.equal(sameDensePoseSource(source, source, 1, 2), false);
});
