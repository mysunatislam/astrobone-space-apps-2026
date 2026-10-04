import assert from "node:assert/strict";
import test from "node:test";

import { normalizeApiBaseUrl } from "./xrayApi.js";

test("normalizes a secure Android inference endpoint", () => {
  assert.equal(
    normalizeApiBaseUrl(" https://ai.example.org/v1/ ", { requireHttps: true }),
    "https://ai.example.org/v1",
  );
});

test("rejects cleartext Android inference endpoints", () => {
  assert.throws(
    () => normalizeApiBaseUrl("http://192.168.1.20:8000", { requireHttps: true }),
    /must use HTTPS/,
  );
});

test("rejects credentials and query parameters in an API base URL", () => {
  assert.throws(
    () => normalizeApiBaseUrl("https://user:secret@ai.example.org"),
    /credentials/,
  );
  assert.throws(
    () => normalizeApiBaseUrl("https://ai.example.org?token=secret"),
    /query or fragment/,
  );
});
