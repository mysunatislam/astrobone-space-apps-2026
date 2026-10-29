import test from "node:test";
import assert from "node:assert/strict";
import { SEALED_SCHEMA, PASSCODE_MIN, PBKDF2_ITERATIONS, passcodeProblem, readEnvelope, isSealed, newSeal, sealJson, openSealed } from "./sealedStore.js";
import { createSelfCheckStore } from "./selfCheck.js";

const FAST = 100000; // the lowest count readEnvelope accepts; the app uses PBKDF2_ITERATIONS
const memoryStorage = () => {
  const data = new Map();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
};
const check = (id, notes = "") => ({ id, at: "2026-10-29T08:00:00.000Z", values: { restingHr: 61 }, notes });

test("passcodes need a minimum length and a matching repeat", () => {
  assert.equal(PASSCODE_MIN, 8);
  assert.ok(PBKDF2_ITERATIONS >= 600000);
  assert.match(passcodeProblem("short"), /at least 8/);
  assert.match(passcodeProblem("long enough", "long enougH"), /do not match/);
  assert.equal(passcodeProblem("long enough", "long enough"), null);
});

test("a sealed record opens only with its passcode and refuses edits", async () => {
  const seal = await newSeal("correct horse", { iterations: FAST });
  const env = await sealJson({ you: [check("a", "knee felt stiff")] }, seal);
  assert.equal(env.schema, SEALED_SCHEMA); assert.ok(isSealed(env)); assert.ok(isSealed(JSON.stringify(env)));
  assert.doesNotMatch(JSON.stringify(env), /stiff|restingHr/);
  const opened = await openSealed(env, "correct horse");
  assert.equal(opened.value.you[0].notes, "knee felt stiff");
  await assert.rejects(openSealed(env, "wrong horse!"), /Wrong passcode/);
  const flipped = { ...env, data: Buffer.from(Buffer.from(env.data, "base64").map((b, i) => (i === 3 ? b ^ 1 : b))).toString("base64") };
  await assert.rejects(openSealed(flipped, "correct horse"), /Wrong passcode/);
  const again = await sealJson({ you: [] }, seal);
  assert.notEqual(again.iv, env.iv, "every write uses a fresh IV");
});

test("damaged or planted envelopes are refused before any crypto runs", async () => {
  const seal = await newSeal("correct horse", { iterations: FAST }), env = await sealJson({}, seal);
  for (const bad of [{ ...env, iterations: 10 }, { ...env, iterations: 1e9 }, { ...env, salt: "AAAA" }, { ...env, iv: "%%%" }, { ...env, cipher: "AES-CBC" }, null, "not json"]) {
    assert.equal(readEnvelope(bad), null, JSON.stringify(bad));
  }
  await assert.rejects(openSealed({ ...env, iterations: 10 }, "correct horse"), /damaged/);
});

test("the self-check store seals, locks, unlocks and removes a passcode without losing checks", async () => {
  const storage = memoryStorage(), key = "astrobone-self-check-v1";
  let store = createSelfCheckStore(storage, key, { iterations: FAST });
  assert.ok(store.canSeal); assert.equal(store.sealed(), false);
  store.save("you", [check("a", "headache after EVA")], true);
  assert.match(storage.data.get(key), /headache/);

  await assert.rejects(store.setPasscode("short"), /at least 8/);
  await store.setPasscode("correct horse");
  assert.ok(store.sealed()); assert.equal(store.locked(), false);
  assert.doesNotMatch(storage.data.get(key), /headache|restingHr/, "nothing readable is left in storage");
  assert.equal(store.load("you", true)[0].notes, "headache after EVA");

  store.save("you", [...store.load("you", true), check("b")], true); await store.flush();
  store.lock();
  assert.ok(store.locked()); assert.deepEqual(store.load("you", true), [], "a locked store shows no history");
  const sealedCopy = storage.data.get(key);
  assert.equal(store.save("you", [check("c")], true), false, "a locked store refuses to write");
  store.clear("you");
  assert.equal(storage.data.get(key), sealedCopy, "and never overwrites the sealed copy");

  store = createSelfCheckStore(storage, key, { iterations: FAST }); // a new page load
  assert.ok(store.locked());
  await assert.rejects(store.unlock("wrong horse!"), /Wrong passcode/);
  assert.ok(store.locked());
  await store.unlock("correct horse");
  assert.deepEqual(store.load("you", true).map(c => c.id), ["a", "b"]);

  await store.removePasscode();
  assert.equal(store.sealed(), false);
  assert.deepEqual(JSON.parse(storage.data.get(key)).you.map(c => c.id), ["a", "b"]);
});

test("a forgotten passcode can only delete the sealed record", async () => {
  const storage = memoryStorage(), store = createSelfCheckStore(storage, "k", { iterations: FAST });
  store.save("you", [check("a")], true); await store.setPasscode("correct horse"); store.lock();
  await store.forget();
  assert.equal(storage.data.has("k"), false); assert.equal(store.locked(), false);
  assert.deepEqual(store.load("you", true), []);
});

test("a record that only claims the sealed schema still counts as locked", () => {
  const storage = memoryStorage(); storage.setItem("k", JSON.stringify({ schema: SEALED_SCHEMA, data: "x" }));
  const store = createSelfCheckStore(storage, "k", { iterations: FAST });
  assert.ok(store.locked());
  assert.equal(store.save("you", [check("a")], true), false);
  assert.equal(JSON.parse(storage.getItem("k")).data, "x");
});
