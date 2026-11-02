// Crewmate check: "your crewmate suddenly has chest pain (or pain somewhere else). What do you do?"
// The app gathers what the crew can observe in a few minutes (where and how it hurts, the warning
// signs public guidance lists, a camera minute for pulse, breathing and face cues, a short reading
// for speech) and turns it into how fast to involve the crew medical officer and flight surgeon,
// which body systems to look at on the twin, and a handoff they can read in one glance.
// It never names a condition or a medicine. Warning-sign lists follow public guidance:
//  - Heart attack warning signs: chest discomfort (pressure, squeezing, fullness, pain), discomfort in one
//    or both arms, the back, neck, jaw or stomach, shortness of breath, cold sweat, nausea or
//    lightheadedness (American Heart Association).
//  - Stroke: BE-FAST, balance, eyes, face drooping, arm weakness, speech difficulty, time to call (AHA/ASA).
//  - Blood clot in the lung: sudden shortness of breath, chest pain that is worse on breathing in, fast
//    heartbeat, one swollen or painful leg (NHLBI). A clot in the jugular vein was found in an ISS crew
//    member during flight (Marshall-Goebel et al., JAMA Netw Open 2019, 2:e1915011).
//  - Kidney stone: severe pain in the side or back that spreads to the lower belly or groin, in waves
//    (NIDDK). Kidney stone risk rises in spaceflight (NASA Human Research Program, renal stone risk).
//  - Back pain: about half of astronauts report back pain early in flight (Kerstman et al., Aviat Space
//    Environ Med 2012, 83:2-7), usually as the spine lengthens; new severe or tearing pain is not that.
// Camera and speech cues are observations only; when they disagree with the crewmate's own account, the
// account wins.

import { environmentFor } from "./missionEnvironment.js";

export const PAIN_SITES = Object.freeze([
  { key: "chest", label: "Chest", systems: ["cardiovascular", "muscle", "skeleton"], focus: "thorax" },
  { key: "upperBelly", label: "Upper belly", systems: ["cardiovascular", "multisystem"], focus: "thorax" },
  { key: "side", label: "Side or flank", systems: ["renal", "skeleton"], focus: "kidneys" },
  { key: "back", label: "Back", systems: ["skeleton", "muscle"], focus: "body" },
  { key: "head", label: "Head", systems: ["multisystem"], focus: "head" },
  { key: "arm", label: "Arm or shoulder", systems: ["muscle", "skeleton", "cardiovascular"], focus: "body" },
  { key: "leg", label: "Leg", systems: ["muscle", "skeleton", "cardiovascular"], focus: "legs" },
]);
export const siteFor = key => PAIN_SITES.find(s => s.key === key) ?? null;

export const QUALITIES = Object.freeze([["pressure", "Pressure, squeezing or heaviness"], ["sharp", "Sharp or stabbing"], ["tearing", "Tearing or ripping"], ["burning", "Burning"], ["cramp", "Cramping, comes in waves"], ["ache", "Dull ache"]]);
export const SPREADS = Object.freeze([["arm", "Arm or shoulder"], ["jaw", "Jaw or neck"], ["back", "Back"], ["groin", "Lower belly or groin"]]);
export const ASSOCIATED = Object.freeze([
  ["breathless", "Short of breath"], ["sweating", "Cold sweat"], ["nausea", "Nausea or vomiting"], ["lightheaded", "Lightheaded or fainted"],
  ["palpitations", "Racing or irregular heartbeat"], ["breathingHurts", "Hurts more on breathing in"], ["pressingHurts", "Hurts more when the spot is pressed or on moving"],
  ["legSwelling", "One leg swollen or painful"], ["faceDroop", "Face drooping on one side"], ["armWeak", "One arm weak or numb"], ["speech", "Slurred or confused speech"],
  ["vision", "Sudden vision loss or double vision"], ["balance", "Sudden loss of balance"], ["fever", "Fever or chills"], ["injury", "Recent knock, fall or strain"], ["exercise", "Started during or after exercise"],
]);
export const ONSETS = Object.freeze([["sudden", "Suddenly (seconds to minutes)"], ["gradual", "Gradually (hours)"]]);

export const LEVELS = Object.freeze({
  now: { rank: 3, word: "CONTACT NOW", text: "Involve the crew medical officer and the flight surgeon now." },
  today: { rank: 2, word: "CONTACT TODAY", text: "Tell the crew medical officer now and the flight surgeon today." },
  watch: { rank: 1, word: "WATCH", text: "Stay with your crewmate and repeat this check in 15 minutes." },
});

const has = (set, key) => Array.isArray(set) ? set.includes(key) : Boolean(set?.[key]);

// Pulse rules for a camera estimate the app trusted (quality gate passed). Resting limits follow the usual
// adult range; a large change from the person's own camera baseline matters even inside it.
export const PULSE_RULES = Object.freeze({ high: 120, low: 40, changeBpm: 20 });
export const BREATHING_RULES = Object.freeze({ high: 24, low: 8 });

export function assessCrewmate(input = {}) {
  const { site, onset, qualities = [], spreads = [], associated = [], severity = null, minutes = null, measures = {}, environment = "station" } = input;
  const reasons = []; let level = "watch";
  const raise = (to, text, kind = "account") => { reasons.push({ level: to, text, kind }); if (LEVELS[to].rank > LEVELS[level].rank) level = to; };
  const chestLike = ["chest", "upperBelly", "arm"].includes(site) || has(spreads, "jaw") || has(spreads, "arm");

  // Heart warning signs (AHA).
  if (chestLike) {
    const companions = ["breathless", "sweating", "nausea", "lightheaded"].filter(k => has(associated, k));
    if (has(qualities, "pressure")) raise("now", "Chest pressure or squeezing is a heart warning sign (AHA).");
    if (has(spreads, "arm") || has(spreads, "jaw") || (site === "chest" && has(spreads, "back"))) raise("now", "Pain spreading to the arm, jaw, neck or back is a heart warning sign (AHA).");
    if (companions.length) raise("now", `Chest discomfort with ${companions.map(k => ASSOCIATED.find(([key]) => key === k)[1].toLowerCase()).join(", ")}: heart warning signs (AHA).`);
  }
  if (has(qualities, "tearing")) raise("now", "Sudden tearing or ripping pain needs a doctor's assessment straight away.");
  // Clot warning signs (NHLBI); a jugular clot was found in flight (Marshall-Goebel 2019).
  if ((site === "chest" && (has(associated, "breathingHurts") || has(associated, "breathless")) && onset === "sudden") || has(associated, "legSwelling"))
    raise("now", "Sudden breathlessness or chest pain on breathing in, or one swollen leg, are blood-clot warning signs (NHLBI); a clot has been found in flight before.");
  // Stroke (BE-FAST).
  const fast = ["faceDroop", "armWeak", "speech", "vision", "balance"].filter(k => has(associated, k));
  if (fast.length) raise("now", "Face, arm, speech, eye or balance changes are stroke warning signs (BE-FAST): note the time they started.");
  if (site === "head" && onset === "sudden" && Number(severity) >= 7) raise("now", "A sudden, severe headache needs a doctor's assessment straight away.");
  // Kidney stone pattern (NIDDK); risk rises in flight (HRP).
  if (site === "side" && (has(qualities, "cramp") || has(spreads, "groin"))) raise("today", "Waves of side pain spreading to the groin match kidney-stone warning signs (NIDDK); kidney-stone risk rises in spaceflight.");
  if (Number.isFinite(Number(severity)) && Number(severity) >= 7) raise("now", `Pain ${severity} out of 10.`);
  else if (Number.isFinite(Number(severity)) && Number(severity) >= 4) raise("today", `Pain ${severity} out of 10.`);
  if (has(associated, "lightheaded")) raise("now", "Fainting or nearly fainting.");
  if (has(associated, "palpitations")) raise("today", "Racing or irregular heartbeat.");
  if (has(associated, "fever")) raise("today", "Fever or chills with pain.");
  if (site && level === "watch") raise("today", "New pain: the crew medical officer should know.");
  if (site === "back" && !has(qualities, "tearing") && onset !== "sudden" && level !== "now")
    reasons.push({ level: "watch", kind: "context", text: "About half of astronauts get back pain early in flight as the spine lengthens (Kerstman 2012); still tell the crew medical officer." });
  if (chestLike && has(associated, "pressingHurts") && !reasons.some(r => r.level === "now"))
    reasons.push({ level: "watch", kind: "context", text: "Pain that changes when the spot is pressed or on moving often comes from muscle or ribs, but that alone does not rule out the heart." });

  // Measurements (trusted ones only).
  const p = measures.pulse;
  if (p?.status === "estimated" && Number.isFinite(p.bpm)) {
    if (p.bpm >= PULSE_RULES.high || p.bpm <= PULSE_RULES.low) raise("now", `Camera pulse ${Math.round(p.bpm)} bpm at rest: confirm with a finger sensor or by hand now.`, "measured");
    const base = measures.baselineHr;
    if (Number.isFinite(base) && Math.abs(p.bpm - base) >= PULSE_RULES.changeBpm) raise("today", `Camera pulse ${Math.round(p.bpm)} bpm, ${p.bpm > base ? "up" : "down"} ${Math.round(Math.abs(p.bpm - base))} from this crewmate's usual ${Math.round(base)}.`, "measured");
  }
  const br = measures.breathing;
  if (Number.isFinite(br?.rate) && (br.rate >= BREATHING_RULES.high || br.rate <= BREATHING_RULES.low)) raise("today", `Breathing about ${Math.round(br.rate)} a minute from head movement (experimental): count breaths for 30 s to confirm.`, "measured");
  for (const c of measures.face ?? []) if (c.status === "changed") raise(c.key === "mouthAsymmetry" ? "now" : "today", `Camera: ${c.text}.`, "measured");
  for (const c of measures.speech ?? []) if (c.status === "changed") raise("today", `Speech: ${c.text}.`, "measured");

  const siteInfo = siteFor(site);
  const systems = new Set(siteInfo?.systems ?? ["multisystem"]);
  if (chestLike) systems.add("cardiovascular");
  if (fast.length || site === "head") systems.add("nervous");
  if (has(associated, "legSwelling")) systems.add("cardiovascular");
  const env = environmentFor(environment) ?? environmentFor("station");
  return { level, word: LEVELS[level].word, headline: LEVELS[level].text, reasons, systems: [...systems], focus: siteInfo?.focus ?? "body", steps: nextSteps(level, env, { chestLike, fast: fast.length > 0 }), environment: env.key, minutes };
}

// What the crew does next. Practical, observation-only steps; never a medicine or a dose.
export function nextSteps(level, env, { chestLike = false, fast = false } = {}) {
  const steps = [];
  if (level === "now") {
    steps.push("Stay with your crewmate. Have them stop work and rest in a position they find comfortable.");
    steps.push(`Call the crew medical officer now. ${env.surgeon}`);
    if (env.now) steps.push(env.now);
    if (chestLike) steps.push("Take blood pressure and oxygen saturation with the medical kit, and record an ECG if your vehicle has one.");
    if (fast) steps.push("Write down the time the first sign appeared: the medical team will ask.");
    steps.push("Follow your mission's medical checklist. Repeat this check every 5 minutes until the medical officer takes over.");
  } else if (level === "today") {
    steps.push("Tell the crew medical officer now and pause exercise until they agree.");
    steps.push(`Send the summary below to the flight surgeon: ${env.reviewText}.`);
    steps.push("Repeat this check in 15 minutes, and straight away if anything new appears.");
  } else {
    steps.push("Stay with your crewmate and repeat this check in 15 minutes.");
    steps.push("If any warning sign appears, start again: the level will rise.");
  }
  return steps;
}

// Plain-text handoff for the medical officer or flight surgeon: who, what, when, what was measured.
export function handoffText({ name = "Crewmate", assessment, input = {}, measured = {}, at = new Date() }) {
  const lab = (list, key) => list.find(([k]) => k === key)?.[1] ?? key;
  const lines = [
    `AstroBone crewmate check · ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `${name}: ${assessment.word}. ${assessment.headline}`,
    `Pain: ${siteFor(input.site)?.label ?? "not given"}${input.onset ? `, started ${input.onset}` : ""}${Number.isFinite(Number(input.minutes)) ? ` ${input.minutes} min ago` : ""}${input.severity != null ? `, ${input.severity}/10` : ""}.`,
    input.qualities?.length ? `Feels like: ${input.qualities.map(k => lab(QUALITIES, k).toLowerCase()).join("; ")}.` : null,
    input.spreads?.length ? `Spreads to: ${input.spreads.map(k => lab(SPREADS, k).toLowerCase()).join("; ")}.` : null,
    input.associated?.length ? `Also: ${input.associated.map(k => lab(ASSOCIATED, k).toLowerCase()).join("; ")}.` : null,
    measured.pulse ? `Camera pulse: ${measured.pulse}.` : null,
    measured.breathing ? `Breathing (head movement, experimental): ${measured.breathing}.` : null,
    measured.face ? `Face: ${measured.face}.` : null,
    measured.speech ? `Speech: ${measured.speech}.` : null,
    "Why: " + assessment.reasons.filter(r => r.kind !== "context").map(r => r.text).join(" "),
    "Camera and speech values are observations compared with this crewmate's own earlier checks; the app does not identify a condition.",
  ];
  return lines.filter(Boolean).join("\n");
}

// Synthetic demonstration case for the tour and the video: Daniel Okoye (the crew view's Daniel),
// chest pressure after a treadmill session. All values are authored, not measured, and labelled so.
export const DEMO_CREWMATE = Object.freeze({
  name: "Daniel Okoye (synthetic)",
  input: { site: "chest", onset: "sudden", qualities: ["pressure"], spreads: ["arm"], associated: ["sweating", "breathless", "exercise"], severity: 6, minutes: 10, environment: "marsTransit" },
  measures: {
    pulse: { status: "estimated", bpm: 112, quality: 0.46 }, baselineHr: 64,
    breathing: { rate: 22 },
    face: [{ key: "painExpression", label: "Pain-like expression", status: "changed", text: "Pain-like expression: more brow lowering, squinting and nose wrinkling than usual" },
      { key: "perclos", label: "Eyes closed (PERCLOS)", status: "stable", text: "Eyes closed (PERCLOS): close to usual" }],
    speech: [{ key: "pauseShare", label: "Time spent pausing", status: "changed", text: "Time spent pausing: more of the reading spent in pauses than usual" }],
  },
  measured: { pulse: "112 bpm (usual 64), quality 0.46", breathing: "about 22 a minute", face: "pain-like expression above usual; eye closure usual", speech: "pauses 31 % of the reading (usual 14 %)" },
});
