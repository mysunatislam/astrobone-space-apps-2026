export function validateDensePoseResult(data) {
  if (!data || data.retains_frames !== false || !["estimated", "no_person", "multiple_people"].includes(data.status)) throw new Error("Unsupported DensePose response");
  if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || Math.max(data.width, data.height) > 1280) throw new Error("Invalid DensePose frame size");
  if (!Number.isFinite(data.inference_ms) || data.inference_ms < 0) throw new Error("Missing DensePose timing");
  if (data.status === "estimated") {
    if (data.people !== 1 || !Number.isFinite(data.detection_score) || data.detection_score < 0 || data.detection_score > 1) throw new Error("Ambiguous DensePose person");
    for (const field of ["overlay", "iuv"]) if (typeof data[field] !== "string" || data[field].length > 5000000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data[field])) throw new Error("Invalid DensePose image");
    if (!Array.isArray(data.visible_parts) || !data.visible_parts.every(v => Number.isInteger(v) && v >= 1 && v <= 24)) throw new Error("Invalid DensePose body charts");
  }
  return data;
}

export function sameDensePoseSource(before, after, sourceEpoch, currentEpoch) {
  return sourceEpoch === currentEpoch && before.session === after.session && before.kind === after.kind && after.active && !after.starting;
}
