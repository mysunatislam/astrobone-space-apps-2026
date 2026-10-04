import { cardiovascularAtDay } from "./missionHealth.js";

export function explainMission(current, health, external, scenario = null) {
  const cardio = cardiovascularAtDay(health, current.day);
  const change = current.comparison.changes.find(row => row.metric === "knee_extension_deg") || current.comparison.changes[0];
  const evidence = Object.values(external?.research || {}).filter(source => source?.accession).map(source => ({ accession: source.accession, url: source.url, population: source.population }));
  return { schema: "astrobone-explanation-v1", astronaut_id: current.astronaut_id, day: current.day,
    observation: change ? `${change.metric}: ${change.baseline} to ${change.current} ${change.unit}, compared with Day ${current.comparison.baseline_day}.`
      : current.comparison.reasons.join(" ") || "Personal baseline; no comparable follow-up.",
    cardiovascular: cardio.status === "missing" ? "No personal cardiovascular observation."
      : cardio.status === "withheld" ? "Newest cardiovascular observation withheld for low signal quality."
        : `${cardio.current.metrics.heart_rate_bpm} bpm on Day ${cardio.current.mission_day}; ${cardio.current.source}. ${cardio.delta === null ? "No comparable change computed." : `${cardio.delta > 0 ? "+" : ""}${cardio.delta} bpm from the first qualified reading in this device/protocol series.`}`,
    radiation: current.dose ? `${current.dose.cumulative_personal_absorbed_dose_mgy} mGy cumulative absorbed dose, Day ${current.dose.mission_day}; ${current.dose.source}. Context only.` : "No personal dosimeter observation.",
    scenario: scenario && current.synthetic && scenario.day === current.day && scenario.astronaut_id === current.astronaut_id ? scenario : null,
    evidence, imaging: external?.xray ? "External FracAtlas image and precomputed output; not assigned to this crew member." : "Imaging reference unavailable.",
    interpretation: "Movement and cardiovascular changes are descriptive. Radiation causation, bone loss, disease, and intervention effects are not inferred.",
    nextAction: current.nextAction,
    uncertainty: "No clinical confidence score. Independent movement accuracy and clinical significance remain unestablished.",
    gates: [
      { name: "Personal movement comparison", status: current.comparison.comparable ? "Comparable" : "Withheld / baseline only" },
      { name: "Cardiovascular quality", status: cardio.status },
      { name: "Mission dosimeter provenance", status: current.dose ? current.dose.source : "Missing" },
      { name: "NASA research references", status: `${evidence.length} linked / external populations` },
      { name: "Action authority", status: "Human review / no treatment prescribed" },
    ], engine: "deterministic structured review / no LLM inference" };
}
