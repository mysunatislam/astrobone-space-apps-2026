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
