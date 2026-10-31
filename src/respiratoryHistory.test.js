import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintDepthSamples, hasSavedRespiratoryCapture } from "./respiratoryHistory.js";

const samples = () => [{ t: 0, chest: 1000, abdomen: 1100, motion: 0, visibility: 1, valid: true }, { t: 100, chest: 1001, abdomen: 1101, motion: 0, visibility: 1, valid: true }];

test("depth fingerprints are stable across equivalent JSON formatting and property order", async () => {
  const a = samples(), b = JSON.parse(JSON.stringify(a, null, 2)).map(s => ({ abdomen: s.abdomen, chest: s.chest, t: s.t, ignored: "metadata" }));
  const first = await fingerprintDepthSamples(a), second = await fingerprintDepthSamples(b);
  assert.match(first, /^depth-sha256-[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("different depth values or sample timestamps identify distinct recordings", async () => {
  const original = await fingerprintDepthSamples(samples());
  const altered = samples(); altered[1].chest += .01;
  assert.notEqual(await fingerprintDepthSamples(altered), original);
  altered[1].chest -= .01; altered[1].t += 1;
  assert.notEqual(await fingerprintDepthSamples(altered), original);
});

test("duplicate saves match only the same crew profile, source and protocol", async () => {
  const captureId = await fingerprintDepthSamples(samples()), identity = { captureId, subjectId: "crew-01", source: "depth", protocol: "respiratory-motion-v1-depth" };
  const history = [{ ...identity, id: "first-save" }];
  assert.equal(hasSavedRespiratoryCapture(history, identity), true);
  for (const change of [{ captureId: "different-recording" }, { subjectId: "crew-02" }, { source: "webcam" }, { protocol: "new-protocol" }]) assert.equal(hasSavedRespiratoryCapture(history, { ...identity, ...change }), false);
  assert.equal(hasSavedRespiratoryCapture(history, { ...identity, captureId: null }), false);
});

test("invalid depth samples cannot acquire a usable fingerprint", async () => {
  await assert.rejects(fingerprintDepthSamples([]));
  await assert.rejects(fingerprintDepthSamples([{ t: 0, chest: NaN, abdomen: 1 }]));
});
