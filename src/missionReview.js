export const SPACE_APPS_CONTEXT = Object.freeze({
  event: "NASA Space Apps Challenge 2026",
  eventDates: "2026-11-14 / 2026-11-15",
  checkedAt: "2026-09-06",
  eventUrl: "https://www.spaceappschallenge.org/2026/",
  resourcesUrl: "https://www.spaceappschallenge.org/resources/",
  officialChallenge: null,
  eligibility: "Pending official challenge selection and confirmation of current submission rules.",
  priorWork: "AstroBone is a pre-event prototype. Disclose this foundation and identify work completed during the hackathon.",
});

export function buildMissionReview({
  skeletonLoaded = false, cameraReady = false, nasaSummary = null,
  simulation = null, imageLoaded = false, movement = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const nasaAvailable = nasaSummary?.schemaVersion === "astrobone-osdr-summary-v1"
    && nasaSummary?.source?.accession === "OSD-804";
  const simulationAvailable = Number.isFinite(simulation?.internalVerification?.comparisonRuns)
    && simulation.internalVerification.comparisonRuns > 0;
  const movementAvailable = movement?.status === "complete";
  const checks = [
    {
      id: "skeleton", title: "Rigged skeletal twin", available: Boolean(skeletonLoaded),
      scope: "Visualization asset; not a subject-specific anatomical or finite-element model.",
      next: skeletonLoaded ? "Inspect framing and pose alignment." : "Wait for the skeleton asset to load.",
    },
    {
      id: "nasa", title: "NASA OSD-804 biological context", available: nasaAvailable,
      scope: "Mouse microCT summary; does not calibrate human bone strength or fracture probability.",
      next: nasaAvailable ? "Review flight versus ground-control values and source hashes." : "NASA summary unavailable in this build.",
    },
    {
      id: "mechanics", title: "Mechanics implementation evidence", available: simulationAvailable,
      scope: "Analytical / Simulink agreement checks implementation, not biological accuracy.",
      next: simulationAvailable ? "Review assumptions and compare an event what-if." : "Simulation evidence package unavailable.",
    },
    {
      id: "imaging", title: "Current X-ray evidence", available: Boolean(imageLoaded),
      scope: "Research classifier and localization output; served-checkpoint evaluation remains pending.",
      next: imageLoaded ? "Inspect provenance and failure cases; no diagnostic conclusion." : "Connect a real case result or keep imaging explicitly missing.",
    },
    {
      id: "movement", title: "Recorded movement assessment", available: movementAvailable,
      scope: "Monocular kinematics only; no force, bone strength, or fracture measurement.",
      next: movementAvailable ? "Review capture quality and baseline comparison." : cameraReady
        ? "Record a baseline and assessment with the full body visible."
        : "Start camera tracking when appropriate; do not provoke painful movement.",
    },
  ];
  return {
    schemaVersion: "astrobone-mission-review-v1", generatedAt,
    readiness: "Research demonstration; not operational or clinical readiness",
    competition: { ...SPACE_APPS_CONTEXT },
    checks,
    availableArtifacts: checks.filter((check) => check.available).length,
    totalArtifacts: checks.length,
    nasaProvenance: nasaAvailable ? { ...nasaSummary.source, organism: nasaSummary.study?.organism } : null,
    unresolvedGates: [
      "Map new hackathon work to the exact official 2026 challenge and data requirements.",
      "Confirm current rules for prior work, team registration, attribution, and submission format.",
      "Evaluate the exact served X-ray checkpoints on a locked, leakage-audited test set.",
      "Measure pose-angle error and alert false-positive rate on consented reference recordings.",
      "Validate mechanical contact assumptions independently and obtain qualified clinical / mission review.",
    ],
    privacy: "No camera frames, raw landmarks, or identifying crew data in this report.",
  };
}

const COMPARISON_FIELDS = [
  ["mass", "Object mass", "g"], ["speed", "Speed", "m/s"],
  ["angle", "Angle", "deg"], ["contactArea", "Contact area", "mm2"],
  ["boneIndex", "Strength index", ""], ["microgravityDays", "Exposure", "days"],
  ["impactDurationMs", "Contact duration", "ms"], ["baselineCapacityMPa", "Baseline capacity", "MPa"],
  ["boneModulusGPa", "Elastic modulus", "GPa"],
  ["monthlyMicrogravityLossRate", "Monthly capacity-loss assumption", ""],
  ["maximumMicrogravityLossFraction", "Maximum capacity-loss assumption", ""],
];

export function compareMissionScenarios(reference, current) {
  if (!reference || !current) return null;
  const before = reference.demandCapacityRatio;
  const after = current.demandCapacityRatio;
  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) return null;
  const comparable = reference.state.target === current.state.target;
  return {
    reference: before, current: after, comparable,
    relativeChangePercent: comparable && before > 0 ? (after - before) / before * 100 : null,
    changedInputs: COMPARISON_FIELDS
      .filter(([key]) => reference.state[key] !== current.state[key])
      .map(([key, label, unit]) => ({ key, label, unit, before: reference.state[key], after: current.state[key] })),
    interpretation: comparable
      ? "Modeled DCR change under selected assumptions. It is not a change in fracture probability or a safety clearance."
      : "Target region changed; the reference is not directly comparable.",
  };
}
