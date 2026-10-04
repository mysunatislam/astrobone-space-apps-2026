export function normalizeScenarioSample({ demandCapacityRatio, capacityReductionPercent, evidenceCoverage }) {
  const normalized = (value, scale) => Number.isFinite(value)
    ? Math.max(0, Math.min(1, value / scale)) : null;
  return {
    demand: normalized(demandCapacityRatio, 1.35),
    capacity: normalized(capacityReductionPercent, 100),
    evidence: normalized(evidenceCoverage, 1),
  };
}

export function appendScenarioSample(histories, sample, limit = 110) {
  for (const key of ["demand", "capacity", "evidence"]) {
    histories[key].push(sample[key]);
    if (histories[key].length > limit) histories[key].shift();
  }
}
