export const HEALTH_METRICS = Object.freeze({
  heart_rate_bpm: { label: "Heart rate", unit: "bpm", min: 30, max: 240, system: "cardiovascular" },
  hrv_rmssd_ms: { label: "HRV (RMSSD)", unit: "ms", min: 0, max: 500, system: "cardiovascular" },
  spo2_pct: { label: "SpO2", unit: "%", min: 50, max: 100, system: "cardiovascular" },
  recovery_hr_60s_bpm: { label: "HR at 60 s recovery", unit: "bpm", min: 30, max: 240, system: "cardiovascular" },
  dose_rate_usv_h: { label: "Personal dose-equivalent rate", unit: "uSv/h", min: 0, max: 1e7, system: "exposure" },
  cumulative_dose_msv: { label: "Cumulative personal dose equivalent", unit: "mSv", min: 0, max: 1e5, system: "exposure" },
});

const SOURCES = new Set(["instrument", "camera_rppg", "synthetic"]);
const ALLOWED = new Set(["mission_day", "observed_at", "source", "device_id", "protocol", "metrics", "quality", "consent_to_store"]);
export function validateHealthObservation(input, isDemo = false, previous = []) {
  if (!input || Object.keys(input).some(key => !ALLOWED.has(key))) throw new Error("Unsupported observation fields.");
  if (input.consent_to_store !== true) throw new Error("Explicit consent is required to store observations.");
  if (!Number.isInteger(input.mission_day) || input.mission_day < 0 || input.mission_day > 2000) throw new Error("Mission day must be 0 to 2000.");
  if (!SOURCES.has(input.source) || isDemo !== (input.source === "synthetic")) throw new Error("Synthetic and real observations require separate profiles.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(input.device_id || "")) throw new Error("Use a device ID with letters, numbers, underscores or hyphens.");
  if (typeof input.protocol !== "string" || input.protocol.trim().length < 3 || input.protocol.length > 80) throw new Error("A repeatable measurement protocol is required.");
  if (typeof input.observed_at !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.observed_at) || !Number.isFinite(Date.parse(input.observed_at)) || Date.parse(input.observed_at) > Date.now() + 300000) throw new Error("Use a valid observation timestamp with timezone, not in the future.");
  if (!Number.isFinite(input.quality) || input.quality < 0 || input.quality > 1) throw new Error("Quality must be between 0 and 1.");
  const entries = Object.entries(input.metrics || {});
  if (!entries.length || entries.length > 6) throw new Error("Enter at least one supported measurement.");
  for (const [key, value] of entries) {
    const spec = HEALTH_METRICS[key];
    if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max) throw new Error(`Invalid ${spec?.label || key} reading.`);
    if (input.source === "camera_rppg" && key !== "heart_rate_bpm") throw new Error("Webcam rPPG supports experimental pulse only, not HRV, SpO2 or dose.");
  }
  if (input.source === "camera_rppg" && input.quality < 0.6) throw new Error("Pulse estimate did not pass the engineering signal-quality gate.");
  for (const row of previous) {
    if (row.device_id !== input.device_id || row.source !== input.source || row.protocol !== input.protocol) continue;
    const oldDose = row.metrics.cumulative_dose_msv, newDose = input.metrics.cumulative_dose_msv;
    if (Number.isFinite(oldDose) && Number.isFinite(newDose)) {
      const deltaTime = Date.parse(input.observed_at) - Date.parse(row.observed_at);
      if ((deltaTime >= 0 && newDose < oldDose) || (deltaTime <= 0 && newDose > oldDose)) throw new Error("Cumulative dose cannot decrease within a device/protocol series. Use a new protocol for a reset.");
    }
  }
  const { consent_to_store, ...record } = input;
  return { ...record, metrics: { ...input.metrics } };
}

// Each independent series retains its units and acquisition protocol. No clinical fusion score.
export function summarizeHealth(rows = []) {
  const series = new Map();
  for (const row of [...rows].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))) {
    for (const [metric, value] of Object.entries(row.metrics)) {
      if (!HEALTH_METRICS[metric] || !Number.isFinite(value)) continue;
      const key = JSON.stringify([metric, row.source, row.device_id, row.protocol]);
      if (!series.has(key)) series.set(key, { key, metric, ...HEALTH_METRICS[metric], source: row.source, device: row.device_id, protocol: row.protocol, points: [] });
      series.get(key).points.push({ day: row.mission_day, at: row.observed_at, value, quality: row.quality });
    }
  }
  const result = [...series.values()].map(item => {
    const comparable = item.points.filter(p => p.quality >= 0.6);
    const first = comparable[0], latest = item.points.at(-1), last = latest?.quality >= .6 ? latest : null;
    return { ...item, first, last, withheld: !last, latestDay: latest?.day,
      delta: last && comparable.length > 1 ? last.value - first.value : null, count: comparable.length };
  });
  return {
    series: result,
    coverage: { cardiovascular: result.some(s => s.system === "cardiovascular"), exposure: result.some(s => s.system === "exposure") },
    interpretation: "Changes are descriptive comparisons with the first quality-qualified reading in the same device, source and protocol series. Timing alone does not establish causation. No combined health score or diagnosis is computed.",
  };
}
