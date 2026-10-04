import test from "node:test";
import assert from "node:assert/strict";
import { buildMissionReview, compareMissionScenarios } from "./missionReview.js";

test("readiness does not claim evidence for an empty session", () => {
  const review = buildMissionReview();
  assert.equal(review.availableArtifacts, 0);
  assert.equal(review.competition.officialChallenge, null);
  assert.match(review.readiness, /Research/);
  assert.equal(review.nasaProvenance, null);
});

test("a working visual demo never clears scientific validation gates", () => {
  const review = buildMissionReview({
    skeletonLoaded: true, imageLoaded: true, cameraReady: true, movement: { status: "complete" },
    nasaSummary: { schemaVersion: "astrobone-osdr-summary-v1", source: { accession: "OSD-804" } },
    simulation: { internalVerification: { comparisonRuns: 25 } },
  });
  assert.equal(review.availableArtifacts, 5);
  assert.equal(review.unresolvedGates.length, 5);
  assert.match(review.checks.find((c) => c.id === "imaging").scope, /pending/);
  assert.match(review.checks.find((c) => c.id === "nasa").scope, /Mouse/);
});

test("live camera alone is not recorded movement evidence", () => {
  const review = buildMissionReview({ cameraReady: true, movement: { status: "insufficient" } });
  assert.equal(review.checks.find((c) => c.id === "movement").available, false);
});

test("what-if compares mechanical DCR and records actual changed inputs", () => {
  const reference = { state: { target: "tibia", speed: 4 }, demandCapacityRatio: 2 };
  const current = { state: { target: "tibia", speed: 2 }, demandCapacityRatio: 1 };
  const comparison = compareMissionScenarios(reference, current);
  assert.equal(comparison.relativeChangePercent, -50);
  assert.equal(comparison.changedInputs[0].key, "speed");
  assert.match(comparison.interpretation, /not a change in fracture probability/);
});

test("zero or changed-region references do not produce misleading percentage changes", () => {
  const reference = { state: { target: "tibia" }, demandCapacityRatio: 0 };
  assert.equal(compareMissionScenarios(reference, { ...reference, demandCapacityRatio: 2 }).relativeChangePercent, null);
  const changed = compareMissionScenarios(reference, { state: { target: "femur" }, demandCapacityRatio: 2 });
  assert.equal(changed.comparable, false);
  assert.equal(compareMissionScenarios(reference, { ...reference, demandCapacityRatio: NaN }), null);
});
