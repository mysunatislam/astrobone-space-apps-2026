// Astronaut daily self-check: gather indicators, evaluate against the person's own
// baseline, and choose a bounded next action. Review triggers are engineering
// defaults for prompting a re-check or human review, not clinical thresholds.

export const SELF_CHECK_SCHEMA = "astrobone-self-check-v1";

// PVT-B parameters: 3-minute psychomotor vigilance test, 2-5 s inter-stimulus interval,
// 355 ms lapse threshold (Basner, Mollicone & Dinges, Acta Astronautica 2011).
export const PVT_B = Object.freeze({ durationMs: 180000, practiceDurationMs: 60000, isiMinMs: 2000, isiMaxMs: 5000, lapseMs: 355, falseStartMs: 100, timeoutMs: 30000 });

// Samn-Perelli 7-point fatigue checklist (USAF School of Aerospace Medicine, 1982).
export const SAMN_PERELLI = Object.freeze([
  "Fully alert, wide awake", "Very lively, responsive, but not at peak", "Okay, somewhat fresh", "A little tired, less than fresh",
  "Moderately tired, let down", "Extremely tired, very difficult to concentrate", "Completely exhausted, unable to function effectively",
]);

export const RED_FLAGS = Object.freeze([
  ["chestPain", "Chest pain, pressure or tightness"],
  ["fainting", "Fainting or nearly fainting"],
  ["breathless", "Severe shortness of breath at rest"],
  ["neuro", "Sudden severe headache, vision loss, weakness or confusion"],
  ["selfHarm", "Thoughts of harming yourself"],
]);

export const IMMUNE_SYMPTOMS = Object.freeze([
  ["fever", "Fever or chills"],
  ["respiratory", "Sore throat, cough or congestion"],
  ["skin", "New skin rash or cold sores"],
  ["wound", "Cut or scrape that is slow to heal"],
  ["malaise", "Unusual tiredness or aches"],
]);

// Indicator definitions. `floor` is the smallest change that triggers review even when
// the personal spread is tiny; `direction` says which way is a worsening.
export const INDICATORS = Object.freeze({
  kneeExtension: { domain: "musculoskeletal", label: "Knee extension", unit: "°", floor: 5, direction: "down", source: "CAMERA" },
  kneeRom: { domain: "musculoskeletal", label: "Knee range of motion", unit: "°", floor: 8, direction: "down", source: "CAMERA" },
  restingHr: { domain: "cardiovascular", label: "Resting heart rate", unit: "bpm", floor: 8, direction: "both", source: "DEVICE" },
  pvtSpeed: { domain: "behavioral", label: "Reaction speed", unit: "/s", floor: 0.3, direction: "down", source: "TEST", digits: 2 },
  pvtLapses: { domain: "behavioral", label: "Attention lapses", unit: "", floor: 3, direction: "up", source: "TEST" },
  sleepHours: { domain: "behavioral", label: "Sleep", unit: "h", floor: 1.5, direction: "down", source: "SELF-REPORT", digits: 1 },
  fatigue: { domain: "behavioral", label: "Fatigue (Samn-Perelli)", unit: "/7", floor: 2, direction: "up", source: "SELF-REPORT" },
  mood: { domain: "behavioral", label: "Mood", unit: "/10", floor: 3, direction: "down", source: "SELF-REPORT" },
  stress: { domain: "behavioral", label: "Stress", unit: "/10", floor: 3, direction: "up", source: "SELF-REPORT" },
});

export const DOMAINS = Object.freeze([
  ["musculoskeletal", "Bone & muscle", "Bone loss and deconditioning under altered gravity"],
  ["cardiovascular", "Cardiovascular", "Fluid shifts and cardiovascular change"],
  ["behavioral", "Behavioral health", "Isolation, confinement, sleep and workload"],
  ["immune", "Immune", "Immune change in a closed environment"],
]);

const MIN_BASELINE = 3;
const BASELINE_WINDOW = 5;
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const sd = values => { if (values.length < 2) return 0; const m = mean(values); return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)); };
const round = (value, digits = 1) => Number(value.toFixed(digits));

// PVT scoring: valid responses are >= 100 ms after stimulus onset; earlier taps are false starts.
export function summarizePvt(trials = [], { durationMs = PVT_B.durationMs, completed = true } = {}) {
  const responses = trials.filter(t => Number.isFinite(t.rtMs));
  const valid = responses.filter(t => t.rtMs >= PVT_B.falseStartMs);
  const falseStarts = trials.filter(t => t.falseStart).length + responses.filter(t => t.rtMs < PVT_B.falseStartMs).length;
  const rts = valid.map(t => t.rtMs).sort((a, b) => a - b);
  const protocol = durationMs >= PVT_B.durationMs ? "pvt-b-3min" : "pvt-practice";
  const usable = completed && valid.length >= (protocol === "pvt-b-3min" ? 20 : 8) && falseStarts <= 10;
  return {
    protocol, durationMs, completed, stimuli: trials.filter(t => !t.falseStart).length, validResponses: valid.length, falseStarts,
    lapses: valid.filter(t => t.rtMs >= PVT_B.lapseMs).length,
    meanSpeed: valid.length ? round(mean(valid.map(t => 1000 / t.rtMs)), 3) : null,
    medianRtMs: rts.length ? round(rts[Math.floor((rts.length - 1) / 2)], 0) : null,
    usable,
    reason: usable ? null : !completed ? "Test stopped before the end." : falseStarts > 10 ? "Too many early responses." : "Too few valid responses.",
  };
}

// Personal reference from the most recent usable earlier checks of the same protocol.
export function personalReference(history, key, protocol) {
  const values = history.filter(check => check.values?.[key] !== undefined && check.values[key] !== null && (!protocol || check.protocols?.[key] === protocol) && check.quality?.[key] !== false)
    .map(check => check.values[key]).slice(-BASELINE_WINDOW);
  if (values.length < MIN_BASELINE) return { ready: false, count: values.length, needed: MIN_BASELINE };
  return { ready: true, count: values.length, mean: mean(values), sd: sd(values) };
}

export function evaluateIndicator(key, value, history, { protocol, usable = true } = {}) {
  const def = INDICATORS[key];
  if (value === null || value === undefined || Number.isNaN(value)) return { key, status: "notChecked", def };
  if (!usable) return { key, value, status: "repeat", def };
  const ref = personalReference(history, key, protocol);
  if (!ref.ready) return { key, value, status: "baseline", ref, def };
  const tolerance = Math.max(2 * ref.sd, def.floor), delta = value - ref.mean;
  const worse = def.direction === "down" ? delta < -tolerance : def.direction === "up" ? delta > tolerance : Math.abs(delta) > tolerance;
  return { key, value, status: worse ? "changed" : "stable", ref, delta, tolerance, def };
}

const STATUS_RANK = { urgent: 5, changed: 4, repeat: 3, baseline: 2, stable: 1, notChecked: 0 };

export function evaluateSelfCheck(check, history = []) {
  const prior = history.filter(h => h.id !== check.id);
  const values = check.values || {}, protocols = check.protocols || {}, quality = check.quality || {};
  const indicators = Object.keys(INDICATORS).map(key => evaluateIndicator(key, values[key], prior, { protocol: protocols[key], usable: quality[key] !== false }));
  const redFlags = RED_FLAGS.filter(([key]) => check.redFlags?.[key]).map(([, label]) => label);
  const symptoms = IMMUNE_SYMPTOMS.filter(([key]) => check.symptoms?.[key]).map(([, label]) => label);
  const domains = DOMAINS.map(([key, label, hazard]) => {
    const rows = indicators.filter(row => row.def.domain === key);
    let status = rows.reduce((best, row) => (STATUS_RANK[row.status] > STATUS_RANK[best] ? row.status : best), "notChecked");
    if (key === "immune") status = check.symptoms ? (symptoms.length ? "changed" : "stable") : "notChecked";
    return { key, label, hazard, status, indicators: rows, symptoms: key === "immune" ? symptoms : undefined };
  });
  const overall = redFlags.length ? "urgent" : domains.reduce((best, d) => (STATUS_RANK[d.status] > STATUS_RANK[best] ? d.status : best), "notChecked");
  return { schema: SELF_CHECK_SCHEMA, id: check.id, at: check.at, overall, redFlags, domains, actions: recommendActions(domains, redFlags, check) };
}

// Bounded actions only: repeat, re-check, log for human review, or contact now.
// AstroBone does not prescribe treatment or exercise changes.
export function recommendActions(domains, redFlags, check = {}) {
  const actions = [];
  if (redFlags.length) actions.push({ id: "contact-now", priority: "urgent", text: "Contact your crew medical officer now and follow your mission's emergency procedure.", due: 0 });
  for (const domain of domains) {
    const repeats = domain.indicators.filter(row => row.status === "repeat");
    for (const row of repeats) actions.push({ id: `repeat-${row.key}`, priority: "repeat", text: `Repeat the ${row.def.label.toLowerCase()} measurement. This result did not pass its quality check, so it was not compared.`, due: 0 });
    if (domain.status === "changed") {
      const items = domain.key === "immune" ? [] : domain.indicators.filter(r => r.status === "changed").map(r => r.def.label.toLowerCase());
      const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0];
      const what = domain.key === "immune" ? `new symptoms reported (${domain.symptoms.join(", ").toLowerCase()})` : `${list} ${items.length > 1 ? "are" : "is"} outside your usual range`;
      actions.push({ id: `review-${domain.key}`, priority: "review", text: `${domain.label}: ${what}. Re-check in 24 h at the same time and log it for medical review at the next communication window.`, due: 24 });
    }
  }
  if (domains.some(d => d.status === "baseline")) actions.push({ id: "baseline", priority: "info", text: `Keep checking daily. Comparisons start after ${MIN_BASELINE} usable checks of each test.`, due: 24 });
  if (!actions.length) actions.push({ id: "routine", priority: "info", text: "No change outside your usual range. Next self-check in 24 h.", due: 24 });
  if (check.notes) actions.push({ id: "note", priority: "info", text: "Your note is attached to this record for the reviewer.", due: null });
  return actions;
}

export function newCheck(profileId, at = new Date().toISOString()) {
  return { schema: SELF_CHECK_SCHEMA, id: `${profileId}-${at}`, profileId, at, values: {}, protocols: {}, quality: {}, sources: {}, redFlags: null, symptoms: null, notes: "" };
}

// Local storage only with explicit consent; otherwise records live in memory for this tab.
export function createSelfCheckStore(storage = globalThis.localStorage, key = "astrobone-self-check-v1") {
  const read = () => { try { return JSON.parse(storage?.getItem(key) || "{}"); } catch { return {}; } };
  let memory = {};
  return {
    load(profileId, persist) { const all = persist ? read() : memory; return all[profileId] ?? []; },
    save(profileId, checks, persist) {
      if (persist) { try { const all = read(); all[profileId] = checks; storage.setItem(key, JSON.stringify(all)); return true; } catch { return false; } }
      memory[profileId] = checks; return true;
    },
    clear(profileId) { memory[profileId] = []; try { const all = read(); delete all[profileId]; storage?.setItem(key, JSON.stringify(all)); } catch { /* storage unavailable */ } },
  };
}
