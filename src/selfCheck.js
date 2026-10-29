// Astronaut daily self-check: gather indicators, evaluate against the person's own
// baseline, and choose a bounded next action. Review triggers are engineering
// defaults for prompting a re-check or human review, not clinical thresholds.

export const SELF_CHECK_SCHEMA = "astrobone-self-check-v1";

// PVT-B parameters: 3-minute psychomotor vigilance test, 1-4 s from a response to the next stimulus
// including 1 s of reaction-time feedback, 355 ms lapse threshold, responses under 100 ms are false
// starts, 30 s without a response is a lapse (Basner, Mollicone & Dinges, Acta Astronautica 2011,
// 69:949-959). v2: these intervals and stimulus onset timed to the frame that draws it; v1 used 2-5 s.
export const PVT_B = Object.freeze({ durationMs: 180000, practiceDurationMs: 60000, isiMinMs: 1000, isiMaxMs: 4000, feedbackMs: 1000, lapseMs: 355, falseStartMs: 100, timeoutMs: 30000 });
export const PVT_PROTOCOL = Object.freeze({ full: "pvt-b-3min-v2", practice: "pvt-practice-v2" });

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
// the personal spread is tiny; `direction` says which way is a worsening. `about` is the plain
// explanation shown beside the measurement: what it is and why it matters in space.
export const INDICATORS = Object.freeze({
  kneeExtension: { domain: "musculoskeletal", label: "Knee extension", unit: "°", floor: 5, direction: "down", source: "CAMERA",
    about: "How straight your knee gets when you lift your lower leg. The legs lose the most bone and muscle in weightlessness, so a falling value is a reason to re-check." },
  kneeRom: { domain: "musculoskeletal", label: "Knee range of motion", unit: "°", floor: 8, direction: "down", source: "CAMERA",
    about: "How far the knee moves from bent to straight in the same test. Stiffness or weaker thigh muscles narrow it." },
  restingHr: { domain: "cardiovascular", label: "Resting heart rate", unit: "bpm", floor: 8, direction: "both", source: "DEVICE",
    about: "Beats per minute while sitting still. Fluid shifts and deconditioning in space change it; a large change from your own usual is worth a re-check." },
  systolicBp: { domain: "cardiovascular", label: "Blood pressure, systolic", short: "Systolic", unit: "mmHg", floor: 15, direction: "both", source: "DEVICE",
    about: "The top number: the pressure while the heart beats. In weightlessness fluid moves toward the head, and 24-hour blood pressure fell on long ISS flights (Norsk et al., J Physiol 2015)." },
  diastolicBp: { domain: "cardiovascular", label: "Blood pressure, diastolic", short: "Diastolic", unit: "mmHg", floor: 10, direction: "both", source: "DEVICE",
    about: "The bottom number: the pressure between beats. Measure seated after 5 minutes of rest, at the same time each day." },
  spo2: { domain: "cardiovascular", label: "Oxygen saturation", unit: "%", floor: 3, direction: "down", source: "DEVICE",
    about: "How much of your blood's oxygen-carrying capacity is in use, from a finger clip. It should stay steady; a drop can come from the cabin air, the lungs or the sensor. Cold fingers, nail polish and skin pigmentation can affect the reading (FDA)." },
  // Floor 15 mg/dL: the EFLM reference change value for glucose (15.2 %, CVI 4.89 %) near 95 mg/dL.
  glucose: { domain: "metabolic", label: "Blood sugar", unit: "mg/dL", floor: 15, direction: "both", source: "DEVICE",
    about: "Sugar in your blood from a finger-prick meter. Six-month ISS flights showed signs of insulin resistance (Hughson et al., Am J Physiol 2016), so it is worth watching over months. Fasting readings are compared only with fasting readings." },
  bodyTemp: { domain: "immune", label: "Body temperature", unit: "°C", floor: 0.6, direction: "both", source: "DEVICE", digits: 1,
    about: "Resting core temperature rose about 1 °C over 2.5 months on the ISS (Stahn et al., Sci Rep 2017), so your own trend matters as well as the fever limit. Use the same thermometer and site each day." },
  pvtSpeed: { domain: "behavioral", label: "Reaction speed", unit: "/s", floor: 0.3, direction: "down", source: "TEST", digits: 2,
    about: "How quickly you respond on the 3-minute reaction test (PVT-B, built for spaceflight by Basner et al. 2011). It slows with sleep loss and fatigue." },
  pvtLapses: { domain: "behavioral", label: "Attention lapses", unit: "", floor: 3, direction: "up", source: "TEST",
    about: "Responses slower than 355 ms on the reaction test. Lapses rise with sleep loss and fatigue." },
  sleepHours: { domain: "behavioral", label: "Sleep", unit: "h", floor: 1.5, direction: "down", source: "SELF-REPORT", digits: 1,
    about: "Hours slept in the last 24 h. Astronauts averaged about 6 hours a night on the ISS (Barger et al., Lancet Neurol 2014)." },
  fatigue: { domain: "behavioral", label: "Fatigue (Samn-Perelli)", unit: "/7", floor: 2, direction: "up", source: "SELF-REPORT",
    about: "A 7-point fatigue scale from aviation research: 1 is fully alert, 7 is completely exhausted." },
  mood: { domain: "behavioral", label: "Mood", unit: "/10", floor: 3, direction: "down", source: "SELF-REPORT",
    about: "Your own 0-10 rating. Isolation and confinement are one of NASA's five hazards of human spaceflight." },
  stress: { domain: "behavioral", label: "Stress", unit: "/10", floor: 3, direction: "up", source: "SELF-REPORT",
    about: "Your own 0-10 rating. Workload, isolation and distance from home raise stress on long missions." },
});

// Fixed safety limits. Personal review triggers need 3 earlier checks; these apply from the first
// reading, because a dangerous value is dangerous without a baseline. Each bound is [operator, value,
// optional first step], and the first step points to the mission's own procedure, never a dose.
// Defaults follow public guidance; a crew's flight surgeon can set their own before flight.
//  - Blood pressure: AHA categories, stage 2 hypertension 140/90 or higher, hypertensive crisis higher
//    than 180/120 ("wait five minutes ... take your blood pressure again"); low below 90/60 (AHA).
//  - Blood sugar: below 54 mg/dL, the ADA's clinically significant low and close to the 55 mg/dL used to
//    document low blood sugar in people without diabetes (Endocrine Society 2009); above 240 mg/dL the
//    ADA advises checking ketones; 200 mg/dL is the ADA's random-glucose threshold. The ADA's 70 mg/dL
//    alert level is for people treated for diabetes: replayed on real Inspiration4 crew glucose it fired
//    on 4 of 12 healthy pre-flight draws, so it is not used (scripts/replay-i4-glucose-limits.mjs).
//  - Temperature: fever 37.8 °C (100 °F) oral or higher, call a provider at 39.4 °C (103 °F),
//    hypothermia below 35 °C (Mayo Clinic).
//  - Oxygen saturation: 93-94 % contact a clinician, 92 % or less urgent (NHS England pulse oximetry).
export const SAFETY_LIMITS = Object.freeze({
  systolicBp: { urgent: [[">", 180]], attention: [[">=", 140], ["<", 90]], recheck: "Sit quietly for 5 minutes and measure again." },
  diastolicBp: { urgent: [[">", 120]], attention: [[">=", 90], ["<", 60]], recheck: "Sit quietly for 5 minutes and measure again." },
  glucose: { urgent: [["<", 54, "Follow your mission's low blood sugar procedure now."], [">", 240]], attention: [[">=", 200]], recheck: "Recheck in 15 minutes with a fresh finger prick." },
  bodyTemp: { urgent: [[">=", 39.4], ["<", 35]], attention: [[">=", 37.8]], recheck: "Measure again in 30 minutes at the same site." },
  spo2: { urgent: [["<=", 92]], attention: [["<=", 94]], recheck: "Warm your hands, sit still and measure again on another finger." },
});
export const SAFETY_LIMIT_SOURCES = Object.freeze([
  "AHA blood pressure categories and low blood pressure (heart.org)", "ADA hypoglycemia and hyperglycemia guidance (diabetes.org)",
  "Mayo Clinic fever and hypothermia", "NHS England COVID Oximetry @home guidance (C1671)",
]);

const OPS = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b };
const OP_WORDS = { ">": "above", ">=": "at or above", "<": "below", "<=": "at or below" };
export const describeBound = ([op, value], unit = "") => `${OP_WORDS[op]} ${value}${unit ? ` ${unit}` : ""}`;

// The most serious fixed limit a value crosses, or null.
export function safetyLimit(key, value, limits = SAFETY_LIMITS) {
  const rule = limits[key];
  if (!rule || !Number.isFinite(value)) return null;
  for (const level of ["urgent", "attention"]) {
    const bound = (rule[level] ?? []).find(([op, limit]) => OPS[op](value, limit));
    if (bound) return { level, bound: bound.slice(0, 2), text: describeBound(bound, INDICATORS[key]?.unit), recheck: rule.recheck, first: bound[2] ?? null };
  }
  return null;
}

export const DOMAINS = Object.freeze([
  ["musculoskeletal", "Bone & muscle", "Bone loss and deconditioning under altered gravity"],
  ["cardiovascular", "Cardiovascular", "Fluid shifts and cardiovascular change"],
  ["metabolic", "Metabolic", "Insulin resistance and nutrition on a closed food system"],
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
  const protocol = durationMs >= PVT_B.durationMs ? PVT_PROTOCOL.full : PVT_PROTOCOL.practice;
  const usable = completed && valid.length >= (protocol === PVT_PROTOCOL.full ? 20 : 8) && falseStarts <= 10;
  const stimuli = trials.filter(t => !t.falseStart).length, lapses = valid.filter(t => t.rtMs >= PVT_B.lapseMs).length;
  return {
    protocol, durationMs, completed, stimuli, validResponses: valid.length, falseStarts, lapses,
    // Basner 2011: 100 % minus lapses and false starts relative to valid stimuli plus false starts.
    performanceScore: stimuli + falseStarts ? round(100 * (1 - (lapses + falseStarts) / (stimuli + falseStarts)), 1) : null,
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

// Drift detection. A rolling baseline follows a slow decline, so gradual change (the way bone and
// muscle are lost in flight) never leaves it. Each indicator therefore also keeps a locked baseline,
// its first usable checks, and runs a one-sided CUSUM (Page, Biometrika 1954) of standardized
// worsening against it. k = 1 SD and h = 6 SD were chosen with `scripts/simulate-detection.mjs`:
// textbook k = 0.5, h = 4 raised a confirmed alarm in about 1 in 5 stable astronauts over 180 days. Sigma is floored at half the review floor so a
// suspiciously tight baseline does not turn noise into alarms.
export const DRIFT = Object.freeze({ k: 1, h: 6, reset: false });

export function lockedReference(history, key, protocol, count = BASELINE_WINDOW) {
  const values = usableValues(history, key, protocol).slice(0, count);
  if (values.length < MIN_BASELINE) return { ready: false, count: values.length, needed: MIN_BASELINE };
  return { ready: true, count: values.length, mean: mean(values), sd: sd(values) };
}

// `def` lets a caller run the same rule on a measure outside INDICATORS (the Inspiration4 blood
// replay in crewReplay.js); `baselineCount` locks the baseline to a known pre-mission set.
export function driftCheck(key, value, history, protocol, { k = DRIFT.k, h = DRIFT.h, reset = DRIFT.reset, floor, def = INDICATORS[key], baselineCount, movingRange = def === INDICATORS[key] } = {}) {
  const locked = lockedReference(history, key, protocol, baselineCount);
  if (!locked.ready) return { ready: false };
  const all = usableValues(history, key, protocol), later = all.slice(locked.count);
  // Sigma: for daily checks, the larger of the locked checks' SD and the moving-range spread of every
  // usable check, so five lucky-tight first checks cannot set it. The locked mean is itself estimated
  // from a few checks; widen sigma for that uncertainty.
  const sigma = Math.max(locked.sd, movingRange ? movingRangeSd([...all, value]) : 0, (floor ?? def.floor) / 2) * Math.sqrt(1 + 1 / locked.count);
  const directions = def.direction === "both" ? ["up", "down"] : [def.direction];
  let cusum = 0, drift = false;
  for (const direction of directions) {
    let s = 0;
    for (const [i, x] of [...later, value].entries()) {
      const z = (direction === "down" ? locked.mean - x : x - locked.mean) / sigma;
      s = Math.max(0, s + z - k);
      // An alarm raised on an earlier check restarts the sum, so a sustained drift re-alarms
      // periodically instead of flagging every day after the first alarm.
      if (reset && s >= h && i < later.length) s = 0;
    }
    if (s >= h) drift = true;
    cusum = Math.max(cusum, s);
  }
  return { ready: true, cusum: round(cusum, 2), drift, lockedMean: locked.mean, sinceBaseline: value - locked.mean, checks: later.length + 1 };
}

// Daily-check multirule, after laboratory quality control (Westgard et al., Clin Chem 1981;27:493-501):
// one value beyond the usual range is a warning, "recheck", measured again at the next check. It counts as
// a change for review only when it is far beyond the range (more than `big` times it, about 3 SD) or the
// previous usable check was also beyond its own range on the same side. With the single-value rule, a
// healthy astronaut who checked all 14 indicators daily was told something changed on 31 % of checks
// (scripts/simulate-false-alarms.mjs).
export const MULTIRULE = Object.freeze({ big: 1.5 });

// What scripts/simulate-false-alarms.mjs measured for these rules: 1,000 simulated healthy astronauts
// doing all 14 checks daily for 60 days, then a real step change on day 31 (400 astronauts each). The
// day-to-day spreads behind it are assumptions until measured on volunteers. The app shows these
// numbers; src/falseAlarms.test.js keeps them in step with the code.
export const SIMULATED_RELIABILITY = Object.freeze({
  astronauts: 1000, days: 60, reviewPct: 7.2, singleRuleReviewPct: 31.2, recheckPct: 31.5,
  detected: Object.freeze([
    ["kneeExtension", "knee extension 10° lower", 91, 100], ["pvtLapses", "6 more attention lapses", 94.5, 100],
    ["systolicBp", "systolic 20 mmHg higher", 82.5, 100], ["glucose", "fasting blood sugar 20 mg/dL higher", 74.3, 99.5],
    ["sleepHours", "2 h less sleep", 56.8, 93],
  ].map(([key, label, withinThree, withinTwoWeeks]) => Object.freeze({ key, label, withinThree, withinTwoWeeks }))),
});

// Day-to-day spread from consecutive differences: mean |x[i] - x[i-1]| / 1.128, the individuals-chart
// estimate (Montgomery, Introduction to Statistical Quality Control). A slow drift barely moves it.
function movingRangeSd(values) {
  const ranges = values.slice(1).map((x, i) => Math.abs(x - values[i]));
  return ranges.length ? mean(ranges) / 1.128 : 0;
}

// The day rule on its own: is `value` beyond the usual range of the last few usable values (mean ±
// 2 SD, at least the floor), and on which side (-1 worse low, 1 worse high, 0 inside)?
function dayJudgement(values, value, def, floor) {
  const window = values.slice(-BASELINE_WINDOW);
  if (window.length < MIN_BASELINE) return null;
  const m = mean(window), tolerance = Math.max(2 * sd(window), floor ?? def.floor), delta = value - m;
  const side = def.direction !== "up" && delta < -tolerance ? -1 : def.direction !== "down" && delta > tolerance ? 1 : 0;
  return { mean: m, tolerance, delta, side };
}

function usableValues(history, key, protocol) {
  return history.filter(check => check.values?.[key] !== undefined && check.values[key] !== null && (!protocol || check.protocols?.[key] === protocol) && check.quality?.[key] !== false)
    .map(check => check.values[key]);
}

// A caller's own `def` (the crew replay's lab measures, a few draws months apart) keeps the original
// single-value rule and drift sigma, and gets no fixed limits unless it passes some: a lab result beyond
// its reference change value is already a two-point comparison.
export function evaluateIndicator(key, value, history, { protocol, usable = true, floor, drift: driftParams, def = INDICATORS[key], limits = def === INDICATORS[key] ? SAFETY_LIMITS : {}, multirule = def === INDICATORS[key] } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return { key, status: "notChecked", def };
  // A fixed safety limit is reported even on a result that must be repeated, so the repeat is not skipped.
  const limit = safetyLimit(key, value, limits);
  if (!usable) return { key, value, status: "repeat", limit, def };
  const ref = personalReference(history, key, protocol);
  if (!ref.ready) return { key, value, status: limit ? limit.level : "baseline", limit, ref, def };
  const series = usableValues(history, key, protocol), today = dayJudgement(series, value, def, floor);
  const { tolerance, delta } = today;
  // Two in a row: the previous check and this one both beyond the range that held before the previous
  // check, on the same side, so a real change is not hidden by the rolling range moving towards it.
  const previous = multirule && series.length ? dayJudgement(series.slice(0, -1), series.at(-1), def, floor) : null;
  const twice = Boolean(previous?.side) && dayJudgement(series.slice(0, -1), value, def, floor)?.side === previous.side;
  const confirmed = (today.side !== 0 && (!multirule || Math.abs(delta) > MULTIRULE.big * tolerance)) || twice;
  const drift = driftCheck(key, value, history, protocol, { floor, def, movingRange: multirule, ...driftParams });
  const reason = limit ? "limit" : confirmed ? "day" : drift.drift ? "drift" : today.side ? "once" : null;
  const status = limit ? limit.level : reason === "once" ? "recheck" : reason ? "changed" : "stable";
  return { key, value, status, reason, limit, ref, delta, tolerance, drift, series, def };
}

// "attention" = a fixed safety limit crossed: tell the crew medical officer today. "recheck" = beyond the
// usual range once: measure again at the next check before anything is logged.
export const STATUS_RANK = Object.freeze({ urgent: 7, attention: 6, changed: 5, recheck: 4, repeat: 3, baseline: 2, stable: 1, notChecked: 0 });
const worst = statuses => statuses.reduce((best, status) => (STATUS_RANK[status] > STATUS_RANK[best] ? status : best), "notChecked");

// `multirule: false` gives the original single-value rule, for comparison (scripts/simulate-false-alarms.mjs).
export function evaluateSelfCheck(check, history = [], { floors = {}, limits = SAFETY_LIMITS, environment = null, multirule = true } = {}) {
  const prior = history.filter(h => h.id !== check.id);
  const values = check.values || {}, protocols = check.protocols || {}, quality = check.quality || {};
  const indicators = Object.keys(INDICATORS).map(key => evaluateIndicator(key, values[key], prior, { protocol: protocols[key], usable: quality[key] !== false, floor: floors[key], limits, multirule }));
  const redFlags = RED_FLAGS.filter(([key]) => check.redFlags?.[key]).map(([, label]) => label);
  const symptoms = IMMUNE_SYMPTOMS.filter(([key]) => check.symptoms?.[key]).map(([, label]) => label);
  const domains = DOMAINS.map(([key, label, hazard]) => {
    const rows = indicators.filter(row => row.def.domain === key);
    let status = worst(rows.map(row => row.status));
    // Immune also counts the symptom checklist: any new symptom is a change.
    if (key === "immune") status = worst([status, check.symptoms ? (symptoms.length ? "changed" : "stable") : "notChecked"]);
    return { key, label, hazard, status, indicators: rows, symptoms: key === "immune" ? symptoms : undefined };
  });
  const overall = redFlags.length ? "urgent" : worst(domains.map(d => d.status));
  return { schema: SELF_CHECK_SCHEMA, id: check.id, at: check.at, overall, redFlags, domains, environment: environment?.key ?? null, actions: recommendActions(domains, redFlags, check, environment) };
}

// Bounded actions only: repeat, re-check, log for human review, tell the crew medical officer, or
// contact now. AstroBone does not prescribe treatment or exercise changes. `environment` (from
// missionEnvironment.js) words who reviews a logged change and when.
const BP_KEYS = ["systolicBp", "diastolicBp"];
const valueText = row => `${Number(row.value.toFixed(row.def.digits ?? 0))}${row.def.unit ? ` ${row.def.unit}` : ""}`;
const join = items => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);
const ESCALATE = { urgent: "contact your crew medical officer now", attention: "tell your crew medical officer today" };

// One action per measurement that crossed a fixed limit; systolic and diastolic are one blood pressure reading.
function limitActions(rows) {
  const actions = [], groups = [];
  const bp = rows.filter(r => BP_KEYS.includes(r.key));
  if (bp.length) groups.push(bp);
  for (const row of rows.filter(r => !BP_KEYS.includes(r.key))) groups.push([row]);
  for (const group of groups) {
    const level = group.some(r => r.limit.level === "urgent") ? "urgent" : "attention", lead = group.find(r => r.limit.level === level);
    const repeat = group.every(r => r.status === "repeat");
    const isBp = BP_KEYS.includes(lead.key);
    const what = isBp ? `Blood pressure ${group.map(r => (r.key === "systolicBp" ? "systolic" : "diastolic") + ` ${r.value} mmHg is ${r.limit.text}`).join(" and ")}`
      : `${lead.def.label} ${valueText(lead)} is ${lead.limit.text}`;
    const bound = lead.limit.text, kind = level === "urgent" ? "the urgent safety limit" : "outside the safety limit for this check";
    const first = lead.limit.first ? `${lead.limit.first} ` : "";
    const text = repeat
      ? `${what}, but this reading did not pass its quality check. ${lead.limit.recheck} If it is still ${bound}, ${ESCALATE[level]}.`
      : `${what}, ${kind}. ${first}${lead.limit.recheck} If it is still ${bound}, ${ESCALATE[level]}.`;
    actions.push({ id: `limit-${isBp ? "bp" : lead.key}`, priority: level, text, due: 0 });
  }
  return actions.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "urgent" ? -1 : 1));
}

export function recommendActions(domains, redFlags, check = {}, environment = null) {
  const actions = [];
  if (redFlags.length) actions.push({ id: "contact-now", priority: "urgent", text: "Contact your crew medical officer now and follow your mission's emergency procedure.", due: 0 });
  const rows = domains.flatMap(d => d.indicators);
  actions.push(...limitActions(rows.filter(r => r.limit)));
  const review = environment?.reviewText ?? "log it for medical review at the next communication window";
  for (const domain of domains) {
    const repeats = domain.indicators.filter(row => row.status === "repeat" && !row.limit);
    for (const row of repeats) actions.push({ id: `repeat-${row.key}`, priority: "repeat", text: `Repeat the ${row.def.label.toLowerCase()} measurement. This result did not pass its quality check, so it was not compared.`, due: 0 });
    const changed = domain.indicators.filter(r => r.status === "changed");
    const symptoms = domain.key === "immune" ? domain.symptoms ?? [] : [];
    if (!changed.length && !symptoms.length) continue;
    const day = changed.filter(r => r.reason !== "drift").map(r => r.def.label.toLowerCase());
    const drift = changed.filter(r => r.reason === "drift").map(r => r.def.label.toLowerCase());
    const parts = [symptoms.length ? `new symptoms reported (${symptoms.join(", ").toLowerCase()})` : null,
      day.length ? `${join(day)} ${day.length > 1 ? "are" : "is"} outside your usual range` : null,
      drift.length ? `${join(drift)} ${drift.length > 1 ? "have" : "has"} drifted steadily from your starting baseline` : null].filter(Boolean);
    actions.push({ id: `review-${domain.key}`, priority: "review", text: `${domain.label}: ${parts.join("; ")}. Re-check in 24 h at the same time and ${review}.`, due: 24 });
  }
  // One value just outside the usual range is a warning, not a change: measure it again first.
  const rechecks = rows.filter(r => r.status === "recheck").map(r => r.def.label.toLowerCase());
  if (rechecks.length) actions.push({ id: "recheck", priority: "recheck", text: `Check ${join(rechecks)} again at your next self-check. ${rechecks.length > 1 ? "Each is" : "It is"} just outside your usual range today. One value like this is not logged as a change; two in a row, or one far outside, is.`, due: 24 });
  if (rows.some(r => r.status === "baseline")) actions.push({ id: "baseline", priority: "info", text: `Keep checking daily. Comparisons start after ${MIN_BASELINE} usable checks of each test.`, due: 24 });
  if (!actions.length) actions.push({ id: "routine", priority: "info", text: "No change outside your usual range. Next self-check in 24 h.", due: 24 });
  if (check.notes) actions.push({ id: "note", priority: "info", text: "Your note is attached to this record for the reviewer.", due: null });
  return actions;
}

// Typed vital signs -> indicator values, protocols and quality. Blood pressure is the mean of the
// readings given (AHA: two readings about a minute apart); one taken without 5 minutes' seated rest
// fails quality, so it is repeated, never compared. Blood sugar is stored in mg/dL and temperature in
// °C; fasting and non-fasting blood sugar, and each thermometer site, are separate protocols.
export const GLUCOSE_MG_PER_MMOL = 18.016;
export const TEMP_SITES = Object.freeze([["oral", "Mouth"], ["ear", "Ear"], ["forehead", "Forehead"], ["armpit", "Armpit"]]);
const VITAL_KEYS = ["systolicBp", "diastolicBp", "spo2", "glucose", "bodyTemp"];
const finite = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

// What a typed vital sign may be, by unit. A value outside it gets a message instead of being dropped
// silently, with a hint when it fits the other unit (5.5 typed as mg/dL is a mmol/L reading; 98.6 °C is
// °F), and a blood pressure reading whose top number is not the larger is not used: swapped, 80/120
// would read as low blood pressure.
export const VITAL_RANGES = Object.freeze({ systolic: [50, 260, "mmHg"], diastolic: [30, 160, "mmHg"], spo2: [50, 100, "%"], "mg/dL": [20, 600, "mg/dL"], "mmol/L": [1, 33, "mmol/L"], "°C": [30, 45, "°C"], "°F": [86, 113, "°F"] });
const OTHER_UNIT = { "mg/dL": "mmol/L", "mmol/L": "mg/dL", "°C": "°F", "°F": "°C" };

export function vitalEntryProblem(kind, value, { unit, diastolic } = {}) {
  if (!Number.isFinite(value)) return null;
  const [min, max, label] = VITAL_RANGES[unit ?? kind], other = OTHER_UNIT[unit];
  if (value < min || value > max) {
    const [a, b] = VITAL_RANGES[other] ?? [];
    return other && value >= a && value <= b ? `${value} ${label} is outside ${min}–${max}. It looks like a ${other} reading: change the unit.` : `${value} is outside ${min}–${max} ${label}. Check the number.`;
  }
  if (kind === "systolic" && Number.isFinite(diastolic) && value <= diastolic) return `${value}/${diastolic}: the top number (systolic) is the larger one. Check the order; this reading is not used.`;
  return null;
}

export function applyVitals(check, vitals = {}) {
  const set = (key, value, protocol, quality = true) => {
    if (value === null) { delete check.values[key]; delete check.protocols[key]; delete check.quality[key]; return; }
    check.values[key] = value; check.protocols[key] = protocol; check.quality[key] = quality;
  };
  const readings = (vitals.bp?.readings ?? []).filter(([s, d] = []) => finite(s) !== null && finite(d) !== null && s > d);
  const avg = i => (readings.length ? Math.round(readings.reduce((sum, r) => sum + r[i], 0) / readings.length) : null);
  set("systolicBp", avg(0), "bp-seated-5min-v1", vitals.bp?.rested === true);
  set("diastolicBp", avg(1), "bp-seated-5min-v1", vitals.bp?.rested === true);
  set("spo2", finite(vitals.spo2?.value), "spo2-rest-v1");
  const g = finite(vitals.glucose?.value);
  set("glucose", g === null ? null : Math.round(vitals.glucose.unit === "mmol/L" ? g * GLUCOSE_MG_PER_MMOL : g), vitals.glucose?.fasting === false ? "glucose-random-v1" : "glucose-fasting-v1");
  const t = finite(vitals.temp?.value), site = TEMP_SITES.some(([k]) => k === vitals.temp?.site) ? vitals.temp.site : "oral";
  set("bodyTemp", t === null ? null : Number((vitals.temp.unit === "°F" ? (t - 32) * 5 / 9 : t).toFixed(1)), `temp-${site}-v1`);
  if (VITAL_KEYS.some(key => key in check.values)) check.sources = { ...check.sources, vitals: vitals.source ?? "Typed readings" };
  return check;
}

// The raw entries that reproduce a record's vital-sign values (to pre-fill a form).
export function vitalsFromValues(values = {}, protocols = {}) {
  return {
    bp: { readings: Number.isFinite(values.systolicBp) ? [[values.systolicBp, values.diastolicBp]] : [], rested: true },
    spo2: { value: values.spo2 ?? null },
    glucose: { value: values.glucose ?? null, unit: "mg/dL", fasting: protocols.glucose !== "glucose-random-v1" },
    temp: { value: values.bodyTemp ?? null, unit: "°C", site: /^temp-(\w+)-v1$/.exec(protocols.bodyTemp ?? "")?.[1] ?? "oral" },
  };
}

export function newCheck(profileId, at = new Date().toISOString()) {
  return { schema: SELF_CHECK_SCHEMA, id: `${profileId}-${at}`, profileId, at, values: {}, protocols: {}, quality: {}, sources: {}, redFlags: null, symptoms: null, notes: "" };
}

// A backup of every saved check, so a baseline survives a cleared browser or a new device. Restoring
// merges by id (a check already here is kept) and reads only the fields the evaluation uses, as numbers,
// strings and booleans, so a damaged or foreign file cannot inject anything else.
export const BACKUP_SCHEMA = "astrobone-self-check-backup-v1";
export function backupPacket(checks, exportedAt = new Date().toISOString()) {
  return { schema: BACKUP_SCHEMA, profile: "This device", exportedAt, checks, boundary: "Self-monitoring record. Not a diagnosis." };
}
const pick = (obj, ok) => Object.fromEntries(Object.entries(obj && typeof obj === "object" ? obj : {}).filter(([key, value]) => key in INDICATORS && ok(value)));
function readCheck(raw) {
  if (!raw || typeof raw.id !== "string" || !Number.isFinite(Date.parse(raw.at))) return null;
  const values = pick(raw.values, Number.isFinite);
  if (!Object.keys(values).length) return null;
  const flags = list => (raw[list] && typeof raw[list] === "object" ? Object.fromEntries(Object.entries(raw[list]).filter(([, v]) => typeof v === "boolean")) : null);
  return { schema: SELF_CHECK_SCHEMA, id: raw.id, profileId: "you", at: raw.at, ...(Number.isFinite(raw.missionDay) ? { missionDay: raw.missionDay } : {}), values,
    protocols: pick(raw.protocols, v => typeof v === "string"), quality: pick(raw.quality, v => typeof v === "boolean"), sources: pick(raw.sources, v => typeof v === "string"),
    redFlags: flags("redFlags"), symptoms: flags("symptoms"), notes: typeof raw.notes === "string" ? raw.notes.slice(0, 2000) : "" };
}
// Accepts a backup or a single exported check ("Export for reviewer").
export function restoreBackup(saved, packet) {
  const incoming = packet?.schema === BACKUP_SCHEMA && Array.isArray(packet.checks) ? packet.checks : packet?.schema === "astrobone-self-check-export-v1" && packet.check ? [packet.check] : null;
  if (!incoming) throw new Error("This file is not an AstroBone self-check backup.");
  const ids = new Set(saved.map(c => c.id)), added = [];
  for (const check of incoming.map(readCheck)) if (check && !ids.has(check.id)) { ids.add(check.id); added.push(check); }
  return { checks: [...saved, ...added].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), added: added.length, skipped: incoming.length - added.length };
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
