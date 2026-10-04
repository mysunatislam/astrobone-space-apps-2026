import test from "node:test";
import assert from "node:assert/strict";
import { validateImageEvidence, validateXrayFile } from "./imageEvidence.js";

const evidence = () => ({
  schemaVersion: "astrobone-image-evidence-v3",
  fractureScore: 0.72,
  maskAreaFraction: 0.03,
  calibratedProbability: false,
  retained: false,
  fractureDetected: true,
  overlayDataUrl: "data:image/png;base64,AA==",
  model: { classifier: "DenseNet121", segmenter: "U-Net++" },
});

test("accepts complete live image evidence", () => {
  const payload = evidence();
  assert.equal(validateImageEvidence(payload), payload);
});
test("rejects a claimed calibrated probability", () => {
  assert.throws(() => validateImageEvidence({ ...evidence(), calibratedProbability: true }), /calibrated/);
});
test("rejects services that retain the uploaded image", () => {
  assert.throws(() => validateImageEvidence({ ...evidence(), retained: true }), /not retained/);
});
test("rejects scores outside the unit interval", () => {
  assert.throws(() => validateImageEvidence({ ...evidence(), fractureScore: NaN }), /finite/);
  assert.throws(() => validateImageEvidence({ ...evidence(), maskAreaFraction: 2 }), /finite/);
});
test("rejects remote or malformed image overlays", () => {
  assert.throws(() => validateImageEvidence({ ...evidence(), overlayDataUrl: "https://example.com/image.png" }), /in-memory/);
  assert.throws(() => validateImageEvidence({ ...evidence(), overlayDataUrl: {} }), /in-memory/);
});
test("validates image upload type and size before sending", () => {
  assert.throws(() => validateXrayFile({ type: "text/plain", size: 100 }), /JPEG/);
  assert.throws(() => validateXrayFile({ type: "image/png", size: 0 }), /empty/);
  assert.throws(() => validateXrayFile({ type: "image/png", size: 16 * 1024 * 1024 }), /15 MB/);
  assert.equal(validateXrayFile({ type: "image/png", size: 100 }).size, 100);
});
