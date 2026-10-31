// Agreement describes only the submitted paired windows. It does not certify
// clinical accuracy, and refused estimates remain in the coverage denominator.
const average = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export function compareRespiratoryReference(input) {
  if (input?.schema !== "astrobone-respiratory-validation-v1") throw new Error("Expected astrobone-respiratory-validation-v1.");
  if (!input.reference || typeof input.reference.instrument !== "string" || !input.reference.instrument.trim() || !Number.isFinite(input.reference.clockOffsetMs)) throw new Error("Declare the reference instrument and clockOffsetMs (reference time + offset = camera time).");
  if (!Array.isArray(input.pairs) || input.pairs.length < 1 || input.pairs.length > 5000) throw new Error("Supply 1–5,000 paired windows, including refused estimates.");
  const seen = new Set();
  const pairs = input.pairs.map(row => {
    if (!row || !identifier(row.subjectId) || !identifier(row.captureId) || !["webcam", "depth"].includes(row.source)) throw new Error("Every pair needs pseudonymous subjectId, unique captureId, and webcam/depth source.");
    if (seen.has(row.captureId)) throw new Error("Duplicate captureId: paired windows must not be counted twice.");
    seen.add(row.captureId);
    if (![row.startMs, row.endMs, row.referenceStartMs, row.referenceEndMs, row.referenceRate].every(Number.isFinite) || row.referenceRate <= 0 || row.referenceRate > 100) throw new Error("Reference rates and both window timestamps must be finite and plausible.");
    const duration = row.endMs - row.startMs;
    if (duration < 30000 || duration > 180000 || row.referenceEndMs <= row.referenceStartMs) throw new Error("Compare simultaneous windows of 30–180 seconds.");
    const offset = input.reference.clockOffsetMs;
    if (Math.abs(row.referenceStartMs + offset - row.startMs) > 500 || Math.abs(row.referenceEndMs + offset - row.endMs) > 500) throw new Error("Camera and reference windows differ by more than 500 ms after clock alignment.");
    if (typeof row.accepted !== "boolean") throw new Error("Every window must explicitly declare accepted: true/false.");
    if (row.accepted && (!Number.isFinite(row.estimatedRate) || row.estimatedRate < 6 || row.estimatedRate > 40)) throw new Error("Accepted motion estimates must be finite and within the supported 6–40/min range.");
    if (!row.accepted && row.estimatedRate !== null) throw new Error("Refused windows must have estimatedRate: null, never a fabricated zero.");
    return { ...row, difference: row.accepted ? row.estimatedRate - row.referenceRate : null };
  });
  function summarize(rows) {
    const usable = rows.filter(row => row.accepted), errors = usable.map(row => row.difference);
    const bias = errors.length ? average(errors) : null;
    const sd = errors.length >= 2 ? Math.sqrt(errors.reduce((sum, x) => sum + (x - bias) ** 2, 0) / (errors.length - 1)) : null;
    return {
      windows: rows.length, usable: usable.length, refused: rows.length - usable.length,
      coverage: usable.length / rows.length, subjects: new Set(rows.map(row => row.subjectId)).size,
      bias, mae: errors.length ? average(errors.map(Math.abs)) : null,
      rmse: errors.length ? Math.sqrt(average(errors.map(x => x ** 2))) : null,
      agreement: sd === null ? null : { lower: bias - 1.96 * sd, upper: bias + 1.96 * sd },
    };
  }
  return {
    schema: "astrobone-respiratory-validation-report-v1", synthetic: input.synthetic === true,
    reference: { instrument: input.reference.instrument.trim().slice(0, 100), clockOffsetMs: input.reference.clockOffsetMs },
    overall: summarize(pairs),
    bySource: Object.fromEntries([...new Set(pairs.map(row => row.source))].map(source => [source, summarize(pairs.filter(row => row.source === source))])),
    bySubject: Object.fromEntries([...new Set(pairs.map(row => row.subjectId))].map(subject => [subject, summarize(pairs.filter(row => row.subjectId === subject))])),
    limits: "Descriptive agreement of submitted windows only. Repeated windows from the same person are not independent; limits of agreement are exploratory. No clinical validation or certification is established.",
  };
}
