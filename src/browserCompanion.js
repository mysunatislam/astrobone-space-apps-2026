import { validateHealthObservation, summarizeHealth } from "./healthObservations.js";
import demoMission from "./demoMission.json" with { type: "json" };
import { compareMovement, validateFollowup } from "./missionCase.js";
const STORAGE_KEY = "astrobone-browser-companion-v1";
const METRICS = new Set([
  "knee_extension_deg", "knee_rom_left_deg", "knee_rom_right_deg",
  "hip_rom_left_deg", "hip_rom_right_deg", "ankle_rom_left_deg", "ankle_rom_right_deg",
  "shoulder_alignment_deg", "knee_asymmetry_deg", "knee_angular_speed_deg_s",
  "cadence_cycles_min", "gait_speed_m_s", "step_length_m", "sway_rms_normalized",
]);
const EQUIPMENT = new Set(["camera", "imu", "resistance_device", "treadmill"]);
const GRAVITY = new Set(["earth", "microgravity", "moon", "mars", "unknown"]);
const SOURCE = new Set(["camera", "video", "instrument", "synthetic"]);
const RED_FLAGS = new Set(["new_severe_pain", "loss_of_function", "new_numbness"]);
const metricLimit = (key) => key.endsWith("_deg") ? 180 : ({
  knee_angular_speed_deg_s: 1500, cadence_cycles_min: 300,
  gait_speed_m_s: 15, step_length_m: 3, sway_rms_normalized: 2,
})[key];
const UNAVAILABLE = {
  bone_loading_risk: "Not estimated: no measured forces or subject-specific bone capacity.",
  muscle_deterioration_risk: "Not estimated: motion is not a measure of muscle mass or strength.",
  balance_impairment_risk: "Not estimated: no validated balance assessment model.",
  injury_probability: "Not estimated: no externally validated astronaut outcome model.",
};
const SOURCES = [
  {
    id: "nasa-bone-changes", title: "Risk of Spaceflight-Induced Bone Changes",
    url: "https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/",
    section: "What are the top risks?", population: "Human spaceflight / general context",
    text: "NASA describes skeletal unloading and bone changes in microgravity. A camera measurement does not establish an individual bone-density change.",
  },
  {
    id: "nasa-human-body", title: "The Human Body in Space",
    url: "https://www.nasa.gov/humans-in-space/the-human-body-in-space/",
    section: "Gravity Fields", population: "Human spaceflight / general context",
    text: "NASA describes effects of changing gravity on orientation, coordination, balance, and locomotion. This does not identify the cause of one person's movement change.",
  },
];
const empty = () => ({ version: 1, profiles: [], assessments: {}, radiation: {}, health: {}, followups: {} });
const uid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const finite = (value) => Number.isFinite(value);

function compare(rows) {
  return compareMovement(rows);
}

function environmentContext(rows, radiation) {
  const current = rows.at(-1);
  const day = current?.mission_day ?? radiation.at(-1)?.mission_day ?? null;
  const reading = radiation.filter((row) => day === null || row.mission_day <= day).at(-1);
  return {
    mission_day: day, observation_gravity: current?.gravity ?? null,
    radiation: {
      status: reading ? reading.source === "synthetic" ? "synthetic" : "instrument_recorded" : "not_provided",
      cumulative_personal_absorbed_dose_mgy: reading?.cumulative_personal_absorbed_dose_mgy ?? null,
      reading_day: reading?.mission_day ?? null, instrument_id: reading?.instrument_id ?? null,
      interpretation: "Operator-entered instrument context; device provenance is not authenticated. No organ or bone dose, causal attribution, or radiation-musculoskeletal risk score is inferred.",
      source_url: "https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/",
    },
    fusion_status: "not_validated",
  };
}

function makeReport(profile, rows, radiation, redFlags, storageName) {
  const comparison = compare(rows);
  const flagged = redFlags.length > 0;
  const priority = flagged
    ? { status: "human_review_now", reason: "Crew-reported warning signs: use the approved onboard escalation protocol; do not wait for this software.", clinical_predictions: UNAVAILABLE }
    : !comparison.comparable
      ? { status: "insufficient_evidence", reason: `Comparison withheld: ${comparison.reasons.join(" ")}`, clinical_predictions: UNAVAILABLE }
      : { status: comparison.changes.some((row) => Math.abs(row.delta) >= .1) ? "change_observed" : "no_resolved_change",
        reason: "Differences are observations, not diagnoses. Repeatability, cause, and clinical significance require qualified review.",
        clinical_predictions: UNAVAILABLE };
  const findings = comparison.changes.map((row) => ({ id: row.id,
    text: `${row.metric.replaceAll("_", " ")}: ${row.baseline} to ${row.current} ${row.unit}, Day ${comparison.baseline_day} to Day ${comparison.current_day}. Observed change only.` }));
  const actions = flagged
    ? [{ id: "escalate", text: "Use the approved onboard medical escalation protocol and contact the designated medical officer.", approval: "human-led", equipment: null }]
    : [
      { id: "review_capture", text: "Review framing, visibility, protocol, and gravity context before interpreting this comparison.", approval: "crew review", equipment: "camera" },
      { id: "repeat_observation", text: "Repeat the same approved assessment when appropriate for the crew member.", approval: "approved protocol and human review required", equipment: "camera" },
      { id: "handoff", text: "Export observations and limitations for qualified medical review.", approval: "crew approval before transmission", equipment: null },
    ].filter((action) => !action.equipment || profile.equipment.includes(action.equipment));
  const trace = [
    { tool: "compare_digital_twin", agent: "Biomechanics rules", status: "complete", detail: "Personal baseline and protocol checked" },
    { tool: "show_curated_sources", agent: "Evidence context", status: "complete", detail: "Two curated NASA pages; no individual causation inferred" },
    { tool: "generate_report", agent: "Action rules", status: "complete", detail: "Only human-reviewed actions listed" },
    { tool: "verify_report", agent: "Verifier", status: "complete", detail: "Clinical claims and source boundaries checked" },
  ];
  return {
    id: uid(), created_at: new Date().toISOString(), schema_version: "astrobone-companion-report-v1",
    astronaut_id: profile.astronaut_id, is_demo: profile.is_demo,
    engine: "deterministic-browser", model: "none", comparison, priority, findings,
    environment: environmentContext(rows, radiation),
    evidence: SOURCES, actions, trace,
    verification: {
      evidence: { status: "research_context_only", detail: "Source URLs are provided; they do not establish individual causation." },
      physics: { status: "not_established", detail: "No forces or bone capacity can be inferred from camera observations." },
      mission: { status: "bounded", detail: "No exercise dose, schedule, or treatment is prescribed." },
      safety: { status: "human_review_required", detail: "A crew member or clinician makes the decision." },
    },
    warnings: ["Browser review uses fixed rules and curated NASA context, not a local LLM or clinical prediction."],
    privacy: { raw_frames_stored: false, cloud_used: false, storage: storageName },
    limitations: ["Research prototype, not a diagnosis or mission-certified system.",
      "A camera cannot measure bone density, muscle strength, or injury probability."],
  };
}

export function createBrowserCompanion(storage) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  let memory = empty();
  const storageName = storage ? "this browser / unencrypted aggregates" : "this session / memory only";
  const read = () => {
    if (!storage) return memory;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.profiles) || !value.assessments) {
      throw new Error("Stored browser observations use an unsupported format.");
    }
    if (value.radiation === undefined) value.radiation = {};
    if (value.health === undefined) value.health = {};
    if (value.followups === undefined) value.followups = {};
    if (!value.health || typeof value.health !== "object" || Array.isArray(value.health)) throw new Error("Invalid health observation storage.");
    if (!value.radiation || typeof value.radiation !== "object" || Array.isArray(value.radiation)) {
      throw new Error("Stored dosimeter observations use an unsupported format.");
    }
    return value;
  };
  const write = (value) => {
    if (storage) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(value)); }
      catch { throw new Error("Browser storage is unavailable or full; the observation was not saved."); }
    } else memory = value;
  };
  const getProfile = (state, id) => {
    const profile = state.profiles.find((item) => item.astronaut_id === id);
    if (!profile) throw new Error("Crew profile not found.");
    return profile;
  };
  const addAssessment = (state, id, input) => {
    const profile = getProfile(state, id);
    if (!input.consent_to_store) throw new Error("Explicit consent is required to save aggregate observations.");
    if (profile.is_demo !== (input.source === "synthetic")) throw new Error("Synthetic and camera observations require separate profiles.");
    if (!Number.isInteger(input.mission_day) || input.mission_day < 0 || input.mission_day > 2000
      || !GRAVITY.has(input.gravity) || !SOURCE.has(input.source)
      || typeof input.protocol !== "string" || input.protocol.length < 3 || input.protocol.length > 80
      || (input.pose_model !== undefined && (typeof input.pose_model !== "string" || input.pose_model.length > 100))
      || !finite(input.tracking_quality) || input.tracking_quality < 0 || input.tracking_quality > 1
      || !Number.isInteger(input.sample_count) || input.sample_count < 1 || input.sample_count > 100000) {
      throw new Error("Observation fields are outside the supported input range.");
    }
    const metrics = {};
    for (const [key, value] of Object.entries(input.metrics || {})) {
      if (!METRICS.has(key) || !finite(value) || value < 0 || value > metricLimit(key)
        || (["gait_speed_m_s", "step_length_m"].includes(key) && !input.calibrated_distance)) {
        throw new Error("Observation contains an unsupported measurement.");
      }
      metrics[key] = value;
    }
    if (!Object.keys(metrics).length) throw new Error("No supported movement measurement is available.");
    const history = state.assessments[id] || [];
    const baseline = history.find((row) => row.is_baseline);
    if (input.is_baseline && baseline) throw new Error("Baseline is locked; create a new profile rather than replacing it.");
    if (input.is_baseline && (input.tracking_quality < .7 || input.sample_count < 12)) {
      throw new Error("Baseline requires at least 12 samples and 70% quality (engineering gate only).");
    }
    if (input.is_baseline && history.some((row) => row.mission_day < input.mission_day)) {
      throw new Error("Baseline cannot be later than an existing observation.");
    }
    if (baseline && input.mission_day < baseline.mission_day) throw new Error("Follow-up cannot precede the baseline.");
    const record = {
      id: uid(), mission_day: input.mission_day, protocol: input.protocol,
      gravity: input.gravity, source: input.source, pose_model: input.pose_model || "MediaPipe Pose Landmarker lite",
      calibrated_distance: Boolean(input.calibrated_distance), metrics,
      tracking_quality: input.tracking_quality, sample_count: input.sample_count,
      is_baseline: Boolean(input.is_baseline), created_at: new Date().toISOString(),
    };
    state.assessments[id] = [...history, record].sort((a, b) => a.mission_day - b.mission_day || a.created_at.localeCompare(b.created_at));
    return record;
  };
  const runs = new Map();
  return {
    async request(path, options = {}) {
      const method = options.method || "GET";
      const input = options.body ? JSON.parse(options.body) : {};
      if (path === "/health" && method === "GET") return {
        status: "ready", mode: "browser", llm: { available: false, model: "none" },
        storage: storageName, clinical_prediction_model: "not validated / unavailable",
      };
      if (path === "/profiles" && method === "GET") return read().profiles;
      if (path === "/profiles" && method === "POST") {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(input.astronaut_id || "")
          || !input.display_name?.trim() || input.display_name.length > 60
          || !input.mission_name?.trim() || input.mission_name.length > 80
          || !Array.isArray(input.equipment) || input.equipment.some((item) => !EQUIPMENT.has(item))) {
          throw new Error("Use a valid crew ID, display name, mission, and supported equipment.");
        }
        const state = read();
        if (state.profiles.some((item) => item.astronaut_id === input.astronaut_id)) throw new Error("Crew ID already exists.");
        const profile = { astronaut_id: input.astronaut_id, display_name: input.display_name.trim(),
          mission_name: input.mission_name.trim(), equipment: [...new Set(input.equipment)],
          is_demo: false, created_at: new Date().toISOString() };
        state.profiles.push(profile); state.assessments[profile.astronaut_id] = [];
        state.radiation[profile.astronaut_id] = []; write(state);
        return profile;
      }
      if (path === "/demo" && method === "POST") {
        const state = read();
        const id = `DEMO-180-${uid().replaceAll("-", "").slice(0, 6)}`;
        const profile = { astronaut_id: id, ...structuredClone(demoMission.profile), is_demo: true,
          created_at: new Date().toISOString() };
        state.profiles.push(profile); state.assessments[id] = []; state.radiation[id] = [];
        for (const {stage, ...observation} of demoMission.observations) {
          addAssessment(state, id, { ...structuredClone(observation), protocol: demoMission.protocol,
            gravity: demoMission.gravity, pose_model: demoMission.pose_model, source: "synthetic", consent_to_store: true });
        }
        state.radiation[id] = demoMission.radiation.map(row => ({...row, id: uid(), source: "synthetic", instrument_id: "DEMO-DOSIMETER", created_at: new Date().toISOString()}));
        state.followups[id] = [];
        state.health[id] = demoMission.health.map(row => ({ id: uid(),
          ...validateHealthObservation({ ...structuredClone(row), consent_to_store: true }, true),
          created_at: new Date().toISOString() }));
        write(state); return profile;
      }
      const profileMatch = path.match(/^\/profiles\/([^/]+)(?:\/(assessments|radiation|health|followups))?$/);
      if (profileMatch) {
        const id = decodeURIComponent(profileMatch[1]), state = read();
        const profile = getProfile(state, id);
        if (profileMatch[2] === "followups" && method === "POST") {
          const record = { id: uid(), ...validateFollowup(input, state.assessments[id] || []), created_at: new Date().toISOString() };
          state.followups[id] = [...(state.followups[id] || []), record]; write(state); return record;
        }
        if (profileMatch[2] === "health" && method === "POST") {
          const record = { id: uid(), ...validateHealthObservation(input, profile.is_demo, state.health[id] || []), created_at: new Date().toISOString() };
          state.health[id] = [...(state.health[id] || []), record]; write(state); return record;
        }
        if (profileMatch[2] === "assessments" && method === "POST") {
          const record = addAssessment(state, id, input); write(state); return record;
        }
        if (profileMatch[2] === "radiation" && method === "POST") {
          if (profile.is_demo || !input.consent_to_store) throw new Error("A real profile and explicit consent are required for a dosimeter reading.");
          if (!Number.isInteger(input.mission_day) || input.mission_day < 0 || input.mission_day > 2000
            || !finite(input.cumulative_personal_absorbed_dose_mgy)
            || input.cumulative_personal_absorbed_dose_mgy < 0 || input.cumulative_personal_absorbed_dose_mgy > 100000
            || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(input.instrument_id || "")) {
            throw new Error("Dosimeter record must have a valid mission day, mGy reading, and instrument ID.");
          }
          const previous = state.radiation[id] || [];
          for (const row of previous) {
            if (row.instrument_id !== input.instrument_id) throw new Error("A new instrument requires a separately reviewed series.");
            if ((row.mission_day <= input.mission_day && row.cumulative_personal_absorbed_dose_mgy > input.cumulative_personal_absorbed_dose_mgy)
              || (row.mission_day > input.mission_day && row.cumulative_personal_absorbed_dose_mgy < input.cumulative_personal_absorbed_dose_mgy)) {
              throw new Error("A cumulative reading cannot decrease across mission days.");
            }
          }
          const record = { id: uid(), mission_day: input.mission_day,
            cumulative_personal_absorbed_dose_mgy: input.cumulative_personal_absorbed_dose_mgy,
            instrument_id: input.instrument_id, reading_type: "personal_dosimeter_cumulative_absorbed_dose",
            created_at: new Date().toISOString() };
          state.radiation[id] = [...previous, record].sort((a, b) => a.mission_day - b.mission_day || a.created_at.localeCompare(b.created_at));
          write(state); return record;
        }
        if (!profileMatch[2] && method === "GET") return { profile, history: state.assessments[id] || [], radiation: state.radiation[id] || [], health: state.health[id] || [], followups: state.followups[id] || [] };
        if (!profileMatch[2] && method === "DELETE") {
          state.profiles = state.profiles.filter((item) => item.astronaut_id !== id);
          delete state.assessments[id]; delete state.radiation[id]; delete state.health[id]; delete state.followups[id]; write(state); return { deleted: true };
        }
      }
      if (path === "/runs" && method === "POST") {
        if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 1500
          || !Array.isArray(input.red_flags) || input.red_flags.length > 3
          || input.red_flags.some((flag) => !RED_FLAGS.has(flag))) {
          throw new Error("Review request or warning signs are invalid.");
        }
        const state = read(), profile = getProfile(state, input.astronaut_id);
        if (input.as_of_day != null && (!Number.isInteger(input.as_of_day) || input.as_of_day < 0 || input.as_of_day > 2000)) throw new Error("Invalid review mission day.");
        const day = input.as_of_day ?? Infinity;
        const report = makeReport(profile, (state.assessments[profile.astronaut_id] || []).filter(row => row.mission_day <= day),
          (state.radiation[profile.astronaut_id] || []).filter(row => row.mission_day <= day),
          input.red_flags || [], storageName);
        report.multisystem = summarizeHealth((state.health[profile.astronaut_id] || []).filter(row => row.mission_day <= day));
        report.followups = (state.followups[profile.astronaut_id] || []).filter(row => row.mission_day <= day);
        runs.set(report.id, report);
        return { id: report.id, status: "complete" };
      }
      const runMatch = path.match(/^\/runs\/([^/]+)$/);
      if (runMatch && method === "GET") {
        const report = runs.get(runMatch[1]);
        if (!report) throw new Error("Browser review not found; run it again.");
        return { id: report.id, status: "complete", trace: report.trace, report };
      }
      throw new Error("This companion action is unavailable in browser-only mode.");
    },
  };
}
