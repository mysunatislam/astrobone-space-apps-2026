export const CASE_FIELDS = ["protocol", "gravity", "source", "pose_model", "calibrated_distance"];
export const captureUsable = row => Boolean(row && Number.isFinite(row.tracking_quality)
  && row.tracking_quality >= .7 && Number.isInteger(row.sample_count) && row.sample_count >= 12);

export function compareMovement(rows) {
  const baseline = rows.find(row => row.is_baseline), current = rows.at(-1), reasons = [];
  if (!baseline) reasons.push("A personal baseline is missing.");
  if (!current || current.id === baseline?.id) reasons.push("A follow-up observation is required.");
  if (baseline && current) {
    for (const field of CASE_FIELDS) if (baseline[field] !== current[field]) reasons.push(`Baseline and current ${field} differ; numerical comparison withheld.`);
    if (baseline.mission_day > current.mission_day) reasons.push("Baseline cannot occur after the follow-up.");
    if (!captureUsable(baseline) || !captureUsable(current)) reasons.push("Capture quality does not pass the engineering comparison gate.");
  }
  const changes = [];
  if (!reasons.length) {
    for (const metric of Object.keys(baseline.metrics).sort()) {
      const previous = baseline.metrics[metric], value = current.metrics[metric];
      if (!Number.isFinite(previous) || !Number.isFinite(value)) continue;
      const delta = value - previous;
      const unit = metric.endsWith("_deg_s") ? "deg/s" : metric.endsWith("_deg") ? "deg"
        : metric.endsWith("_m_s") ? "m/s" : metric.endsWith("_m") ? "m" : metric.endsWith("_min") ? "cycles/min" : "normalized";
      changes.push({ id: `change:${metric}`, metric, baseline: previous, current: value,
        delta: Number(delta.toFixed(3)), percent_change: Math.abs(previous) > 1e-8 ? Number((100 * delta / Math.abs(previous)).toFixed(2)) : null, unit });
    }
    if (!changes.length) reasons.push("No shared finite measurement is available.");
  }
  return { comparable: !reasons.length, reasons, baseline_id: baseline?.id ?? null, current_id: current?.id ?? null,
    baseline_day: baseline?.mission_day ?? null, current_day: current?.mission_day ?? null, changes };
}

export function buildMissionCase({ profile, history = [], radiation = [], followups = [], day = Infinity, redFlags = false }) {
  const visible = history.filter(row => row.mission_day <= day);
  const current = visible.at(-1), baseline = visible.find(row => row.is_baseline);
  const comparison = compareMovement(visible);
  const baselineOnly = current && current.id === baseline?.id && captureUsable(current);
  const changed = comparison.changes.some(row => Math.abs(row.delta) >= .1);
  const status = redFlags ? "human_review_now" : baselineOnly ? "baseline_recorded"
    : !comparison.comparable ? "insufficient_evidence" : changed ? "change_observed" : "no_resolved_change";
  const previous = visible.slice(0, -1).reverse().find(row => !row.is_baseline && captureUsable(row)
    && CASE_FIELDS.every(field => row[field] === current?.[field]));
  const anchor = comparison.changes.find(row => row.metric === "knee_extension_deg") || comparison.changes.find(row => row.metric === "knee_rom_left_deg");
  let followup = null;
  if (anchor && previous && Number.isFinite(previous.metrics[anchor.metric])) {
    const previousDistance = Math.abs(previous.metrics[anchor.metric] - anchor.baseline), distance = Math.abs(anchor.current - anchor.baseline);
    followup = { previousDay: previous.mission_day, metric: anchor.metric, prior: previous.metrics[anchor.metric], current: anchor.current,
      direction: Math.abs(distance - previousDistance) < .1 ? "similar distance from baseline" : distance < previousDistance ? "closer to baseline" : "further from baseline",
      interpretation: "Descriptive follow-up only. It does not establish recovery or an intervention effect." };
  }
  const dose = radiation.filter(row => row.mission_day <= (current?.mission_day ?? day)).at(-1) ?? null;
  const titles = { human_review_now: "Human review now", baseline_recorded: "Personal baseline recorded", insufficient_evidence: "Comparison withheld",
    change_observed: "Movement change observed", no_resolved_change: "No resolved change" };
  return { schema: "astrobone-mission-case-v1", astronaut_id: profile?.astronaut_id ?? null, synthetic: Boolean(profile?.is_demo),
    day: current?.mission_day ?? null, current, baseline, comparison, status, title: titles[status], followup, dose,
    nextAction: redFlags ? "Use the approved onboard medical escalation protocol; do not wait for this software."
      : !comparison.comparable && !baselineOnly ? "Check capture quality and protocol, then obtain a usable repeat when appropriate."
      : baselineOnly ? "Keep this baseline locked and record the next observation using the same approved protocol."
      : "Review the observation, request an appropriate protocol-matched repeat, and share the evidence with the medical officer.",
    confidence: "Measurement accuracy and clinical significance are not established. Tracking quality is not diagnostic confidence.",
    followups: followups.filter(row => row.mission_day <= (current?.mission_day ?? day)),
    evidenceIds: current ? ["nasa-gravity-transition", "nasa-delayed-support"] : [],
    boundaries: ["No bone density, muscle strength, force, or injury probability measured.", "Radiation is context, not an explanation or numerical contributor to a movement change."] };
}

export function validateFollowup(input, history) {
  const observation = history.find(row => row.id === input.assessment_id);
  if (!input.consent_to_store) throw new Error("Consent is required to record a follow-up action.");
  if (!observation || input.mission_day !== observation.mission_day) throw new Error("The action must link to the selected observation and mission day.");
  if (!["repeat_requested", "review_recorded"].includes(input.kind)) throw new Error("Unsupported follow-up action.");
  return { assessment_id: input.assessment_id, mission_day: input.mission_day, kind: input.kind,
    text: input.kind === "repeat_requested" ? "Crew requested a protocol-matched repeat, subject to approved procedures." : "Crew recorded review of this observation; no clearance or treatment was issued." };
}
