import test from "node:test";
import assert from "node:assert/strict";
import { ENVIRONMENTS, environmentFor, escalationPlan, escalationLevel, DEFAULT_ENVIRONMENT } from "./missionEnvironment.js";
import { evaluateSelfCheck, applyVitals, newCheck } from "./selfCheck.js";
import { ELENA_HISTORY, elenaDay147 } from "./elenaSelfCheck.js";

test("the statement's environments are all covered: spacecraft, station, rover and planetary bases", () => {
  const labels = new Set(ENVIRONMENTS.map(e => e.label));
  for (const label of ["Spacecraft", "Space station", "Rover", "Lunar base", "Mars base"]) assert.ok(labels.has(label), label);
  assert.equal(environmentFor(DEFAULT_ENVIRONMENT.elena).place, "Earth-Mars transit");
});

test("message delay comes from light time: about 1.3 s to the Moon, 3-22 min to Mars", () => {
  assert.equal(environmentFor("lunarBase").delayText, "1.3 s");
  assert.equal(environmentFor("marsBase").delayText, "3-22 min");
  assert.equal(environmentFor("station").delayText, "under 1 s");
  // 384,400 km / c and 54.6-401 million km / c.
  assert.ok(Math.abs(384400 / 299792.458 - environmentFor("lunarBase").delaySec[0]) < 0.05);
  assert.ok(Math.abs(54.6e6 / 299792.458 / 60 - 3) < 0.1 && Math.abs(401e6 / 299792.458 / 60 - 22) < 0.5);
});

test("the ladder climbs with the result and words each rung for the place", () => {
  assert.deepEqual(["stable", "baseline", "changed", "attention", "urgent"].map(escalationLevel), [0, 0, 1, 2, 3]);
  const mars = escalationPlan("urgent", environmentFor("marsTransit"));
  assert.equal(mars.steps.find(s => s.active).key, "now");
  assert.match(mars.steps.find(s => s.active).detail, /crew decides first.*no return to Earth for months/i);
  const iss = escalationPlan("urgent", environmentFor("station"));
  assert.match(iss.steps.find(s => s.active).detail, /Mission Control.*within about a day/);
});

test("where you are changes who reviews a logged change", () => {
  const iss = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY, { environment: environmentFor("station") });
  const mars = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY, { environment: environmentFor("marsTransit") });
  assert.match(iss.actions.find(a => a.id === "review-musculoskeletal").text, /private medical conference/);
  assert.match(mars.actions.find(a => a.id === "review-musculoskeletal").text, /takes 3-22 min to reach Earth/);
  assert.equal(mars.environment, "marsTransit");
  // The evaluation itself does not change with place; only the wording of who to tell.
  assert.deepEqual(iss.domains.map(d => d.status), mars.domains.map(d => d.status));
  assert.equal(evaluateSelfCheck(applyVitals(newCheck("you"), { spo2: { value: 91 } }), []).overall, "urgent");
});
