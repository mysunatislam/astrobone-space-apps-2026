import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

// Uses a public reference photograph, never the user's camera.
const base = "http://127.0.0.1:8011";
const sample = await readFile(".artifacts/mediapipe-woman-hands.jpg");
const request = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(180000) });
const init = await request("/initialize", { method: "POST" });
assert.equal(init.status, 200, await init.clone().text());
const cases = [
  ["/frame", { headers: { Origin: "https://example.org", "Content-Type": "image/jpeg" }, body: sample }, 403],
  ["/frame?pipeline=unknown", { headers: { "Content-Type": "image/jpeg" }, body: sample }, 422],
  ["/frame", { headers: { "Content-Type": "text/plain" }, body: "hello" }, 415],
  ["/frame", { headers: { "Content-Type": "image/jpeg" }, body: "" }, 422],
  ["/frame", { headers: { "Content-Type": "image/jpeg" }, body: "not a jpeg" }, 422],
  ["/frame", { headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(1000001) }, 413],
];
for (const [path, options, status] of cases) {
  const response = await request(path, { method: "POST", ...options });
  assert.equal(response.status, status, `${path}: ${await response.text()}`);
}
const start = performance.now();
const response = await request("/frame?pipeline=B", { method: "POST", headers: { "Content-Type": "image/jpeg", Origin: "http://127.0.0.1:5180" }, body: sample });
assert.equal(response.status, 200, await response.clone().text());
assert.equal(response.headers.get("cache-control"), "no-store");
const frame = await response.json();
assert.equal(frame.status, "estimated");
assert.equal(frame.vertices.length, 4899); assert.equal(frame.faces.length, 9794);
assert.equal(frame.wholebody_2d.length, 133);
assert.ok(frame.vertices.flat().every(Number.isFinite));
const health = await (await request("/health")).json();
const result = { scope: "Actual HTTP service and model smoke test on a reference photograph; not clinical accuracy validation", acceptedFrame: true, vertices: frame.vertices.length, wholebodyLandmarks: frame.wholebody_2d.length, providers: health.providers, roundTripMs: Math.round(performance.now() - start), rejectedBoundaryCases: cases.length };
await writeFile(".artifacts/vision-service-qa.json", JSON.stringify(result, null, 2));
console.log(result);
