import { ELENA } from "./elenaMissionScenario.js";
import { buildMissionCase } from "./missionCase.js";
import { cardiovascularAtDay } from "./missionHealth.js";

export const SYSTEMS = ["multisystem", "outer", "skeletal", "muscular", "cardiovascular", "radiation", "movement"];
export const initialMissionState = () => ({ day: ELENA.identity.currentDay.value, system: "multisystem", evidence: "OSD-804", event: null,
  offline: false, lab: false, options: { lowQuality: false, sensorMissing: false, evidenceMissing: false, movement: "recorded", exposure: null } });

export function missionData(state) {
  const history = ELENA.observations.map(row => ({ id: `elena-${row.day.value}`, mission_day: row.day.value, is_baseline: row.day.value === 1,
    protocol: ELENA.protocol.value, source: "synthetic", pose_model: ELENA.model.value, gravity: ELENA.identity.gravity.value,
    calibrated_distance: false, tracking_quality: row.trackingQuality.value, sample_count: row.sampleCount.value,
    metrics: { knee_extension_deg: row.kneeExtension.value, knee_rom_left_deg: row.kneeRom.value } }));
  const health = ELENA.observations.map(row => ({ mission_day: row.day.value, source: "synthetic", device_id: "DEMO-PPG",
    protocol: "resting-restrained-demo-v1", quality: row.heartQuality.value, metrics: { heart_rate_bpm: row.heartRate.value } }));
  const radiation = ELENA.observations.map(row => ({ mission_day: row.day.value, source: "synthetic", cumulative_personal_absorbed_dose_mgy: row.absorbedDose.value }));
  if (state.lab) {
    const row = history.find(row => row.mission_day === state.day);
    if (state.options.lowQuality) row.tracking_quality = ELENA.whatIf.poorQuality.value;
    if (state.options.movement !== "recorded" && !row.is_baseline) row.metrics.knee_extension_deg = state.options.movement === "stable" ? ELENA.whatIf.stableExtension.value : ELENA.whatIf.reducedExtension.value;
    if (Number.isFinite(state.options.exposure)) radiation.find(row => row.mission_day === state.day).cumulative_personal_absorbed_dose_mgy = state.options.exposure;
  }
  return { profile: { astronaut_id: ELENA.identity.id.value, display_name: ELENA.identity.name.value, is_demo: true }, history,
    health: state.lab && state.options.sensorMissing ? [] : health, radiation, day: state.day };
}

export function deriveMission(state, external = {}) {
  const data = missionData(state), review = buildMissionCase(data), cardio = cardiovascularAtDay(data.health, state.day);
  const coreReferences = state.lab && state.options.evidenceMissing ? [] : [external.research?.cardiovascular, external.research?.radiation,
    external.bone?.source ? { accession: "OSD-804", title: "Skeletal microCT research", population: "Female mice / 37-day spaceflight", url: external.bone.source.studyUrl,
      boundary: "External mouse research; not Elena's bone density or a human risk threshold." } : null].filter(Boolean);
  const references = [...coreReferences, ...(state.lab && state.options.evidenceMissing ? [] : external.extended?.studies || [])];
  const event = state.event && state.day >= state.event.day ? state.event : null;
  const change = review.comparison.changes.find(row => row.metric === "knee_extension_deg");
  const dose = review.dose?.cumulative_personal_absorbed_dose_mgy;
  const doseWithEvent = Number.isFinite(dose) ? Number((dose + (event ? ELENA.event.increment.value : 0)).toFixed(2)) : null;
  const movement = review.status === "insufficient_evidence" ? "INSUFFICIENT DATA" : review.status === "baseline_recorded" ? "BASELINE" : review.status === "no_resolved_change" ? "NO RESOLVED CHANGE" : "REVIEW REQUIRED";
  const gates = [
    { id: "input", name: "Movement input available", pass: Boolean(review.current), detail: "Selected recorded checkpoint only." },
    { id: "provenance", name: "Source provenance", pass: data.history.every(r => r.source === "synthetic"), detail: "ELENA fixture / SYNTHETIC DEMO. No claim of instrument acquisition." },
    { id: "baseline", name: "Compatible personal baseline", pass: review.comparison.comparable || review.status === "baseline_recorded", detail: review.comparison.reasons.join(" ") || "Protocol, gravity, source, model and calibration match." },
    { id: "quality", name: "Movement quality gate", pass: review.current?.tracking_quality >= .7 && review.current?.sample_count >= 12, detail: "Engineering rule: quality >= 0.70, samples >= 12; not clinically validated." },
    { id: "cardio", name: "Cardiovascular input", pass: ["available", "earlier"].includes(cardio.status), detail: "Synthetic resting series, matched device/protocol. Not a cardiac diagnosis." },
    { id: "evidence", name: "Prepared NASA sources", pass: coreReferences.length === 3, detail: `${coreReferences.length} of 3 core summaries; ${references.length - coreReferences.length} additional human-assay datasets. Topic links, not individual causal evidence.` },
    { id: "scope", name: "Output scope restricted", pass: true, detail: "Fixed structured templates only. No disease, injury probability, treatment or organ function predicted." },
    { id: "separation", name: "External data separated", pass: !external.xray || external.xray.patientLinked === false, detail: "NASA cohorts and FracAtlas are external. No patient or exposure-to-damage join." },
  ];
  const limitations = ["Movement accuracy and clinical significance are not independently established.", "Co-occurrence does not establish radiation causation.",
    "No measured bone density, muscle strength or internal organ physiology.", "Anatomy is a reference atlas, not Elena's reconstruction."];
  const observation = change ? `Knee extension ${change.baseline} to ${change.current} deg (${change.delta > 0 ? "+" : ""}${change.delta} deg vs Day 1).`
    : review.status === "baseline_recorded" ? "Personal baseline locked. Follow-up comparison not yet available." : "INSUFFICIENT MOVEMENT EVIDENCE. Numerical change withheld.";
  const action = movement === "INSUFFICIENT DATA" ? "Repeat a usable, protocol-matched movement observation before interpreting change."
    : "Review the observations with the medical officer and repeat under the same approved protocol. No exercise prescription is issued.";
  return { schema: "astrobone-mission-intelligence-v1", identity: ELENA.identity, day: state.day, data, review, cardio, change, references,
    event, dose, doseWithEvent, movement, gates, passed: gates.filter(g => g.pass).length, limitations, observation, action,
    cardiovascular: cardio.current ? `${cardio.current.metrics.heart_rate_bpm} bpm${cardio.delta === null ? " / baseline" : ` / ${cardio.delta > 0 ? "+" : ""}${cardio.delta} bpm vs baseline`}` : "INSUFFICIENT DATA",
    radiation: event ? "REASSESSMENT REQUIRED" : "CONTEXT RECORDED", skeletal: "RESEARCH CONTEXT",
    scope: state.lab ? "WHAT-IF / NOT THE MISSION RECORD" : "SYNTHETIC MISSION DEMONSTRATION",
    evidenceReady: coreReferences.length === 3, remoteReview: state.offline ? "Pending / Earth link unavailable (demo)" : "Human review required / no remote transmission",
    engine: "Deterministic tools + local prepared-evidence lookup; no LLM call" };
}

export function astraAnswer(kind, result) {
  const missing = result.gates.filter(g => !g.pass).map(g => g.name);
  const answers = {
    why: `${result.observation} ${result.cardiovascular}. These are synthetic observations. Changes are descriptive, not a diagnosis or proof of radiation injury.`,
    baseline: `${result.observation} ${result.review.comparison.comparable ? "DERIVED: subtraction from the locked, protocol-matched baseline." : "No numerical change approved."}`,
    missing: missing.length ? `INSUFFICIENT EVIDENCE: ${missing.join("; ")}.` : "All configured demo inputs are available. Independent angle accuracy, clinical significance, measured bone density and causal evidence remain unavailable.",
    recheck: result.action,
    evidence: result.references.length ? `NASA RESEARCH: ${result.references.map(r => r.accession).join(", ")}. External populations only; no Elena measurements or causal attribution.` : "INSUFFICIENT EVIDENCE. Prepared NASA research is unavailable.",
  };
  return { text: answers[kind] || "INSUFFICIENT EVIDENCE. This structured assistant cannot answer outside the verified review.",
    source: kind === "evidence" ? "NASA RESEARCH" : "DERIVED / SYNTHETIC DEMO", day: result.day, engine: result.engine };
}
