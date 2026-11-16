import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The README's and the submission's headline numbers, recomputed from the shipped code and data
// (scripts/audit-claims.mjs). The two 60-day simulations run there without --quick.
test("every headline claim in the README is reproduced by the shipped code and data", () => {
  let out;
  try { out = execFileSync(process.execPath, [new URL("../scripts/audit-claims.mjs", import.meta.url).pathname, "--quick", "--json"], { encoding: "utf8" }); }
  catch (error) { out = error.stdout; }
  const results = JSON.parse(out);
  assert.ok(results.length >= 15, `${results.length} claims checked`);
  for (const r of results) assert.ok(r.pass, `${r.id}: ${r.claim} (found ${r.found})`);
});
