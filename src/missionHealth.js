// The newest reading is not silently replaced by an older, better-quality result.
export function cardiovascularAtDay(rows = [], day = Infinity) {
  const visible = rows.filter(row => row.mission_day <= day && Number.isFinite(row.metrics?.heart_rate_bpm))
    .sort((a, b) => a.mission_day - b.mission_day || Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const current = visible.at(-1);
  if (!current) return { status: "missing", current: null, points: [], delta: null };
  const points = visible.filter(row => ["source", "device_id", "protocol"].every(key => row[key] === current[key]));
  const baseline = points.find(row => row.quality >= .6);
  const usable = current.quality >= .6;
  return { status: !usable ? "withheld" : current.mission_day < day ? "earlier" : "available", current, baseline, points,
    delta: usable && baseline && baseline !== current ? Number((current.metrics.heart_rate_bpm - baseline.metrics.heart_rate_bpm).toFixed(1)) : null };
}

export function describeXray(payload) {
  if (payload?.schemaVersion !== "astrobone-held-out-evidence-v1" || !payload.imageId
    || !Number.isFinite(payload.fractureScore) || payload.fractureScore < 0 || payload.fractureScore > 1
    || !Number.isFinite(payload.maskAreaFraction) || payload.maskAreaFraction < 0 || payload.maskAreaFraction > 1) {
    throw new Error("The X-ray evidence file is incomplete or unsupported.");
  }
  return { ...payload, provenance: "External FracAtlas example; not crew imaging", inference: "Precomputed model output; not live inference",
    scoreLabel: "Classifier score (uncalibrated)", maskLabel: "Predicted mask area, not injury severity",
    patientLinked: false, clinicalDiagnosis: false };
}
