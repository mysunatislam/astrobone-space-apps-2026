// Canonical measured samples, rather than filename/JSON formatting, identify a
// depth recording. Values are hashed locally; no video or secret is involved.
export async function fingerprintDepthSamples(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 18000) throw new Error("Cannot identify this depth recording.");
  if (!globalThis.crypto?.subtle?.digest) throw new Error("Depth history needs a secure browser context to identify duplicate recordings.");
  const canonical = samples.map(s => {
    if (!s || ![s.t, s.chest, s.abdomen].every(Number.isFinite)) throw new Error("Cannot identify invalid depth samples.");
    return [s.t, s.chest, s.abdomen, s.motion ?? 0, s.visibility ?? 1, s.valid !== false];
  });
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `depth-sha256-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hasSavedRespiratoryCapture(history, { captureId, subjectId, source, protocol }) {
  return Boolean(captureId && history.some(record => record.captureId === captureId && (record.subjectId || "crew-01") === subjectId && record.source === source && record.protocol === protocol));
}


export const RESPIRATORY_HISTORY_PROFILE = "respiratory:you";
export const LEGACY_RESPIRATORY_HISTORY_KEY = "astrobone.respiratory.accepted.v1";

// Saved summaries carry their own provenance. This validator is shared by the
// capture panel, daily-check attachments and backup restoration. Never accept a
// demo, refused estimate, mismatched protocol or another person's record.
export function normalizeRespiratoryRecord(record, { legacy = false, subjectId = "you" } = {}) {
  if (!record || typeof record !== "object" || record.synthetic === true) return null;
  if (!legacy && (record.synthetic !== false || record.status !== "estimated" || record.subjectId !== "you")) return null;
  if (legacy && record.status && record.status !== "estimated") return null;
  if (typeof record.id !== "string" || !record.id.trim() || record.id.length > 160) return null;
  if (!["webcam", "depth"].includes(record.source)) return null;
  if (typeof record.protocol !== "string" || !new RegExp("^respiratory-motion-v[1-9][0-9]*-" + record.source + "$").test(record.protocol)) return null;
  if (!Number.isFinite(record.rate) || record.rate < 6 || record.rate > 40 || !Number.isFinite(record.quality) || record.quality < 0 || record.quality > 1) return null;
  if (!Number.isFinite(record.duration) || record.duration < 30 || record.duration > 180) return null;
  if (typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))) return null;
  if (record.captureId != null && (typeof record.captureId !== "string" || record.captureId.length > 180)) return null;
  if (record.source === "depth" && !/^depth-sha256-[a-f0-9]{64}$/.test(record.captureId || "")) return null;
  if (subjectId !== "you") return null;
  return {
    id: record.id, captureId: record.captureId || null, subjectId: "you",
    recordedAt: new Date(record.recordedAt).toISOString(), rate: record.rate,
    quality: record.quality, duration: record.duration, source: record.source,
    protocol: record.protocol, synthetic: false, status: "estimated", experimental: true,
    validation: "Reference-belt validation pending",
    ...(legacy ? { legacySourceProfile: String(record.subjectId || "crew-01").slice(0, 40) } :
      typeof record.legacySourceProfile === "string" ? { legacySourceProfile: record.legacySourceProfile.slice(0, 40) } : {}),
  };
}

export function isRespiratoryRecord(record) { return normalizeRespiratoryRecord(record) !== null; }

export function respiratoryAttachment(record, profile = "you") {
  if (profile !== "you") return null;
  const normalized = normalizeRespiratoryRecord(record);
  return normalized ? { schema: "astrobone-respiratory-attachment-v1", ...normalized } : null;
}

export function mergeRespiratoryRecords(existing = [], incoming = []) {
  const result = [];
  for (const item of [...existing, ...incoming]) {
    const record = normalizeRespiratoryRecord(item);
    if (!record || result.some(r => r.id === record.id) || hasSavedRespiratoryCapture(result, record)) continue;
    result.push(record);
  }
  return result.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).slice(-100);
}

// Migration is opt-in and scoped to the crew code the user identifies as theirs.
// Other profiles and malformed legacy rows are left untouched in the old store.
export function migrateLegacyRespiratoryRecords(existing, legacyRecords, selectedProfile) {
  if (typeof selectedProfile !== "string" || !selectedProfile.trim()) throw new Error("Choose the legacy profile that belongs to you.");
  const valid = [], remaining = [];
  for (const item of Array.isArray(legacyRecords) ? legacyRecords : []) {
    const own = (item?.subjectId || "crew-01") === selectedProfile;
    const normalized = own ? normalizeRespiratoryRecord(item, { legacy: true }) : null;
    if (normalized) valid.push(normalized); else remaining.push(item);
  }
  return { records: mergeRespiratoryRecords(existing, valid), remaining, migrated: valid.length };
}
