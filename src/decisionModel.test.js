import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDecision,
  fragilityToCapacityReduction,
} from "./decisionModel.js";

test("decision remains incomplete when imaging evidence is missing", () => {
  const decision = calculateDecision({
    demandCapacityRatio: 0.58,
    fragility: 1.25,
  });

  assert.equal(decision.sourceCount, 2);
  assert.equal(decision.imagingScore, null);
  assert.equal(decision.concordance.key, "incomplete");
  assert.match(decision.uncertainty, /imaging missing/i);
  assert.match(decision.recommendation, /do not delay/i);
});

test("positive image evidence sets review priority without weighted fusion", () => {
  const decision = calculateDecision({
    demandCapacityRatio: 0.2,
    fragility: 1.3,
    aiLoaded: true,
    fractureScore: 0.99,
    fractureDetected: true,
  });

  assert.equal(decision.band.key, "high");
  assert.equal(decision.sourceCount, 3);
  assert.equal(decision.concordance.key, "disagreement");
  assert.equal("score" in decision, false);
  assert.match(decision.method, /no cross-domain weighted score/i);
});

test("mechanics and image disagreement widens uncertainty", () => {
  const decision = calculateDecision({
    demandCapacityRatio: 0.08,
    fragility: 0.9,
    aiLoaded: true,
    fractureProbability: 0.96,
  });

  assert.equal(decision.concordance.key, "disagreement");
  assert.match(decision.uncertainty, /channels disagree/i);
});

test("concordant lower signals remain a monitor state", () => {
  const decision = calculateDecision({
    demandCapacityRatio: 0.2,
    fragility: 1,
    aiLoaded: true,
    fractureScore: 0.1,
    fractureDetected: false,
  });

  assert.equal(decision.band.key, "low");
  assert.equal(decision.concordance.key, "concordant-lower");
});

test("capacity reduction display is bounded and interpretable", () => {
  assert.equal(fragilityToCapacityReduction(1), 0);
  assert.ok(Math.abs(fragilityToCapacityReduction(1.25) - 20) < 1e-12);
  assert.equal(fragilityToCapacityReduction(4), 75);
  assert.equal(fragilityToCapacityReduction(0.4), 0);
});
