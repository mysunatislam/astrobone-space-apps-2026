import test from "node:test";
import assert from "node:assert/strict";
import { GUIDANCE, guidanceFor, GUIDANCE_BOUNDARY } from "./countermeasures.js";
import { HRP_HAZARDS, hazardsForIndicator, hazardsForDomain } from "./hazards.js";
import { DOMAINS, INDICATORS } from "./selfCheck.js";

test("every self-check domain has sourced guidance on what helps", () => {
  for (const [key] of DOMAINS) {
    const g = guidanceFor(key);
    assert.ok(g, key);
    assert.ok(g.helps.length >= 2 && g.sources.length >= 1, key);
  }
  assert.match(GUIDANCE_BOUNDARY, /crew medical officer decides on any treatment/);
});

test("guidance never prescribes: no medicines, doses or amounts", () => {
  const text = Object.values(GUIDANCE).flatMap(g => g.helps).join(" ");
  assert.doesNotMatch(text, /\b(mg|milligram|gram|tablet|pill|dose|medication|medicine|drug|ibuprofen|paracetamol|acetaminophen|aspirin|insulin|bisphosphonate|melatonin|zolpidem)\b/i);
  assert.doesNotMatch(text, /diagnos/i);
});

test("NASA's five hazards are named as NASA names them and cover every indicator", () => {
  assert.deepEqual(HRP_HAZARDS.map(h => h.name), ["Space Radiation", "Isolation and Confinement", "Distance from Earth", "Gravity Fields", "Hostile/Closed Environments"]);
  for (const key of Object.keys(INDICATORS)) assert.ok(hazardsForIndicator(key).length >= 1, `${key} is linked to a hazard`);
  for (const [key] of DOMAINS) assert.ok(hazardsForDomain(key).length >= 1, `${key} is linked to a hazard`);
  for (const h of HRP_HAZARDS.filter(h => !h.indicators.length)) assert.ok(h.context, `${h.name} says how it is handled without a body measurement`);
});
