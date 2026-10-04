export function calculateCarePlan({
  decisionBand = "low",
  aiLoaded = false,
  painScore = 0,
  swelling = "none",
  mobility = "normal",
  sensationChange = false,
}) {
  const pain = clamp(Number(painScore) || 0, 0, 10);
  const redFlags = [];

  if (pain >= 8) redFlags.push("severe reported pain");
  if (swelling === "severe") redFlags.push("severe reported swelling");
  if (mobility === "unable") redFlags.push("unable to use or load the limb");
  if (sensationChange) redFlags.push("reported sensation change");

  const priority = getPriority({
    decisionBand,
    pain,
    swelling,
    mobility,
    redFlags,
  });
  const subject = "crew member";
  const remoteReviewer = "flight surgeon or mission medical support";

  return {
    priority,
    redFlags,
    actions: [
      {
        id: "protect",
        phase: "Respond",
        label: priority.key === "monitor"
          ? "Avoid provoking load"
          : "Stop the task and protect the limb",
        detail:
          "Reduce additional loading while the situation is reviewed. Use only mission- or clinician-approved procedures.",
      },
      {
        id: "assess",
        phase: "Assess",
        label: `Complete the ${subject} condition check`,
        detail:
          "Record pain, swelling, limb use, sensation, visible changes, and the time of the event.",
      },
      {
        id: "protocol",
        phase: "Respond",
        label: "Open the approved response protocol",
        detail:
          "This prototype does not prescribe treatment. Link the priority to an authorized procedure and available supplies.",
      },
      {
        id: "monitor",
        phase: "Monitor",
        label: "Log a follow-up observation",
        detail:
          "Track symptoms and function over time using the reassessment interval defined by the approved protocol.",
      },
      {
        id: "relay",
        phase: "Relay",
        label: `Prepare a handoff for the ${remoteReviewer}`,
        detail:
          "Package the image result, impact reconstruction, condition trend, model limits, and completed actions.",
      },
    ],
    summary: getSummary({
      priority,
      aiLoaded,
      redFlags,
      remoteReviewer,
    }),
    protocolNote:
      "Operational use requires a flight-surgeon- or clinician-approved musculoskeletal protocol. AstroBone is decision support, not autonomous treatment.",
  };
}

function getPriority({
  decisionBand,
  pain,
  swelling,
  mobility,
  redFlags,
}) {
  if (redFlags.length > 0 || decisionBand === "high") {
    return {
      key: "urgent",
      label: "Urgent medical review",
      title: "Protect, assess, and escalate",
    };
  }

  if (
    decisionBand === "watch"
    || pain >= 5
    || swelling === "moderate"
    || mobility === "limited"
  ) {
    return {
      key: "review",
      label: "Assisted review",
      title: "Reduce load and gather follow-up evidence",
    };
  }

  return {
    key: "monitor",
    label: "Monitor",
    title: "Record a baseline and watch for change",
  };
}

function getSummary({
  priority,
  aiLoaded,
  redFlags,
  remoteReviewer,
}) {
  if (redFlags.length > 0) {
    return `Reported condition flags require ${priority.label.toLowerCase()} even if imaging is incomplete.`;
  }
  if (!aiLoaded) {
    return "The response plan can begin from the event and condition check while image evidence is being collected.";
  }
  if (priority.key === "urgent") {
    return `The combined evidence supports immediate protection and handoff to the ${remoteReviewer}.`;
  }
  if (priority.key === "review") {
    return "The combined evidence supports load reduction, reassessment, and assisted review.";
  }
  return "No strong operational warning is present, but a trend log preserves a baseline for later comparison.";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
