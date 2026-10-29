import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BODY_PARTS, bodyPartFor, bodyPartStatus } from "./bodyParts.js";
import { INDICATORS, evaluateSelfCheck } from "./selfCheck.js";
import { ELENA_HISTORY, elenaDay147 } from "./elenaSelfCheck.js";

// The pickable structures, read from the scene source so a new one cannot be added without a card.
const picks = [...readFileSync(new URL("./twinScene.js", import.meta.url), "utf8").match(/export const PICK_LABELS = \{([\s\S]*?)\};/)[1].matchAll(/(\w+):/g)].map(m => m[1]);

test("every clickable structure on the 3D twin opens a card with its function and spaceflight effect", () => {
  assert.ok(picks.length >= 16);
  for (const pick of picks) {
    const key = bodyPartFor(pick);
    assert.ok(key, `${pick} has a card`);
    const part = BODY_PARTS[key];
    assert.ok(part.does && part.space && part.sources.length, key);
  }
  for (const part of Object.values(BODY_PARTS)) for (const key of part.indicators) assert.ok(INDICATORS[key], key);
});

test("the card shows today's status from the latest self-check", () => {
  const evaluation = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY);
  const tibia = bodyPartStatus(bodyPartFor("tibiaL"), evaluation);
  assert.equal(tibia.status, "changed");
  assert.deepEqual(tibia.rows.map(r => r.key), ["kneeExtension", "kneeRom"]);
  const heart = bodyPartStatus("heart", evaluation);
  assert.deepEqual(heart.rows.map(r => [r.key, r.status]), [["restingHr", "recheck"], ["systolicBp", "stable"], ["diastolicBp", "stable"]]);
  assert.equal(bodyPartStatus("radiation", evaluation).status, null, "radiation is context, never a health status");
  assert.equal(bodyPartStatus("tibia", null).status, "notChecked");
});
