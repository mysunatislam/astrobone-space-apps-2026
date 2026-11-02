import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintDepthSamples, hasSavedRespiratoryCapture, mergeRespiratoryRecords, migrateLegacyRespiratoryRecords, respiratoryAttachment } from "./respiratoryHistory.js";

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

const reading = (over = {}) => ({ id: "r1", captureId: null, subjectId: "you", recordedAt: "2026-11-01T08:00:00Z", rate: 14.2, quality: 0.8, duration: 45, source: "webcam", protocol: "respiratory-motion-v1-webcam", synthetic: false, status: "estimated", experimental: true, ...over });

test("only usable personal readings are kept; demo, refused or other-person rows are dropped", () => {
  assert.equal(mergeRespiratoryRecords([], [reading(), reading({ id: "d", synthetic: true }), reading({ id: "x", status: "refused" }), reading({ id: "o", subjectId: "crew-02" }), reading({ id: "p", protocol: "respiratory-motion-v1-depth" })]).length, 1);
  const attachment = respiratoryAttachment(reading());
  for (const key of ["recordedAt", "source", "protocol", "quality", "experimental"]) assert.ok(key in attachment, key);
  assert.equal(attachment.experimental, true);
});

test("legacy migration moves only the chosen crew code and leaves the rest for later", () => {
  const legacy = [reading({ id: "a", subjectId: "crew-01", synthetic: undefined, status: undefined }), reading({ id: "b", subjectId: "crew-07", synthetic: undefined, status: undefined }), { id: "broken", subjectId: "crew-01" }];
  const moved = migrateLegacyRespiratoryRecords([], legacy, "crew-01");
  assert.equal(moved.migrated, 1);
  assert.deepEqual(moved.records.map(r => [r.id, r.subjectId, r.legacySourceProfile]), [["a", "you", "crew-01"]]);
  assert.deepEqual(moved.remaining.map(r => r.id), ["b", "broken"]);
  assert.throws(() => migrateLegacyRespiratoryRecords([], legacy, ""), /Choose the legacy profile/);
});
