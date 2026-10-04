import assert from "node:assert/strict";
import test from "node:test";

import { buildTimestampedJsonFilename } from "./nativeRuntime.js";

test("Android evidence filenames are deterministic and filesystem safe", () => {
  const filename = buildTimestampedJsonFilename(
    "astrobone-handoff",
    new Date("2026-08-29T12:34:56.789Z"),
  );
  assert.equal(
    filename,
    "astrobone-handoff-2026-08-29T12-34-56-789Z.json",
  );
  assert.equal(/:/.test(filename), false);
});
