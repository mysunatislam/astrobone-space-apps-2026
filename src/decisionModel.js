export function calculateDecision({
  demandCapacityRatio,
  mechanicsBand,
  fragility,
  aiLoaded = false,
  fractureScore,
  fractureProbability,
  fractureDetected,
  physicsConfidence = "Research model",
}) {
  const mechanicalIndex = Math.max(0, Number(demandCapacityRatio) || 0);
  const resolvedMechanicsBand = mechanicsBand ?? getMechanicsBand(mechanicalIndex);
  const imageModelScore = fractureScore ?? fractureProbability ?? 0;
  const imagingScore = aiLoaded
    ? clamp((Number(imageModelScore) || 0) * 100, 0, 100)
    : null;
  const imagePositive = aiLoaded
    ? Boolean(fractureDetected ?? imagingScore >= 50)
    : null;
  const mechanicalConcern = mechanicalIndex >= 0.5;
  const capacityReductionPercent = fragilityToCapacityReduction(fragility);
  const band = getDecisionBand({
    mechanicalIndex,
    aiLoaded,
    imagePositive,
  });
  const concordance = getConcordance({
    aiLoaded,
    imagePositive,
    mechanicalConcern,
  });
  const sourceCount = aiLoaded ? 3 : 2;
  const uncertainty = getUncertainty({
    aiLoaded,
    concordance,
    physicsConfidence,
  });

  return {
    band,
    concordance,
    sourceCount,
    completeness: sourceCount / 3,
    uncertainty,
    imagingScore,
    imagePositive,
    mechanicalIndex,
    mechanicsBand: resolvedMechanicsBand,
    mechanicalDisplayPercent: clamp(mechanicalIndex * 100, 0, 100),
    capacityReductionPercent,
    recommendation: getRecommendation({ band, aiLoaded }),
    rationale: getRationale({
      aiLoaded,
      imagePositive,
      resolvedMechanicsBand,
      concordance,
    }),
    method: "Explicit decision rules; no cross-domain weighted score.",
  };
}

export function fragilityToCapacityReduction(fragility) {
  const capacityFactor = 1 / Math.max(Number(fragility) || 1, Number.EPSILON);
  return clamp((1 - capacityFactor) * 100, 0, 100);
}

function getMechanicsBand(index) {
  if (index >= 1) return { key: "capacity-exceedance", label: "Potential capacity exceedance" };
  if (index >= 0.8) return { key: "elevated", label: "Elevated relative concern" };
  if (index >= 0.5) return { key: "monitor", label: "Monitor" };
  return { key: "lower", label: "Lower relative concern" };
}

function getDecisionBand({ mechanicalIndex, aiLoaded, imagePositive }) {
  if (mechanicalIndex >= 1 || imagePositive === true) {
    return {
      key: "high",
      label: "High review priority",
      title: "At least one evidence channel requires prompt review",
    };
  }
  if (mechanicalIndex >= 0.5) {
    return {
      key: "watch",
      label: "Review needed",
      title: "The mechanical channel is above the lower band",
    };
  }
  if (!aiLoaded) {
    return {
      key: "low",
      label: "Incomplete review",
      title: "Structural image evidence is not connected",
    };
  }
  return {
    key: "low",
    label: "Monitor",
    title: "No channel crosses its provisional review rule",
  };
}

function getConcordance({ aiLoaded, imagePositive, mechanicalConcern }) {
  if (!aiLoaded) {
    return {
      key: "incomplete",
      label: "Incomplete evidence",
      shortLabel: "Incomplete",
    };
  }
  if (imagePositive === mechanicalConcern) {
    return {
      key: imagePositive ? "concordant-warning" : "concordant-lower",
      label: imagePositive
        ? "Concordant warning signals"
        : "Concordant lower signals",
      shortLabel: "Concordant",
    };
  }
  return {
    key: "disagreement",
    label: "Evidence channels disagree",
    shortLabel: "Disagree",
  };
}

function getUncertainty({ aiLoaded, concordance, physicsConfidence }) {
  if (!aiLoaded) return "Wide - imaging missing";
  if (physicsConfidence !== "Research model") return "Wide - mechanics scope warning";
  if (concordance.key === "disagreement") return "Wide - channels disagree";
  return "Moderate - prototype models";
}

function getRecommendation({ band, aiLoaded }) {
  if (!aiLoaded) {
    return "Collect image evidence if available, but do not delay the condition check or an approved response when warning signs are present.";
  }
  if (band.key === "high") {
    return "Open the response plan, protect the limb from further loading, and prepare a qualified medical handoff.";
  }
  if (band.key === "watch") {
    return "Lower controllable loading, log a follow-up observation, and gather stronger evidence for assisted review.";
  }
  return "Record a baseline, continue monitoring, and compare future condition or load data against it.";
}

function getRationale({
  aiLoaded,
  imagePositive,
  resolvedMechanicsBand,
  concordance,
}) {
  if (!aiLoaded) {
    return `Mechanics is ${resolvedMechanicsBand.label.toLowerCase()}, but structural image evidence is missing.`;
  }

  const imageLabel = imagePositive
    ? "above its provisional screening threshold"
    : "below its provisional screening threshold";
  return `The X-ray model is ${imageLabel}; mechanics is ${resolvedMechanicsBand.label.toLowerCase()}. ${concordance.label}. No weighted fusion is applied.`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
