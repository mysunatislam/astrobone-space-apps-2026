import test from "node:test";
import assert from "node:assert/strict";
import { appendScenarioSample, normalizeScenarioSample } from "./scenarioHistory.js";

test("scenario history preserves constant values without artificial oscillation", () => {
  const histories = { demand: [], capacity: [], evidence: [] };
  const sample = normalizeScenarioSample({
    demandCapacityRatio: 0.675, capacityReductionPercent: 30, evidenceCoverage: 2 / 3,
  });
  for (let i = 0; i < 150; i++) appendScenarioSample(histories, sample);
  assert.equal(histories.demand.length, 110);
  assert.deepEqual([...new Set(histories.demand)], [0.5]);
  assert.deepEqual([...new Set(histories.capacity)], [0.3]);
});

test("unknown evidence remains absent instead of receiving demo defaults", () => {
  assert.deepEqual(normalizeScenarioSample({}), { demand: null, capacity: null, evidence: null });
});

test("scenario changes are recorded directly without overshoot", () => {
  const histories = { demand: [], capacity: [], evidence: [] };
  appendScenarioSample(histories, { demand: 0.1, capacity: 0.2, evidence: 0.3 });
  appendScenarioSample(histories, { demand: 0.8, capacity: 0.2, evidence: 1 });
  assert.deepEqual(histories.demand, [0.1, 0.8]);
});
