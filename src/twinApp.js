import { ELENA } from "./elenaMissionScenario.js";
import { createTwinScene, PICK_LABELS } from "./twinScene.js";
import {
  twinState, boneCapacityChange, CHECKPOINTS, CURRENT_DAY, MISSION_LENGTH, BONE_TINT_SCALE, TRACKS_PER_MGY, PROVENANCE, boneTint, predictedVsObserved, kneeSeries, latestCheckpoint, dcrBand,
} from "./twinModel.js";
import { IMPACT_SCENARIO, evaluateImpact, runMonteCarlo, eventDistributions, envelopeDistributions, bendingStressField } from "./twinImpact.js";
import { RISK_THRESHOLDS } from "./riskModel.js";
import { createSelfCheckPanel } from "./selfCheckPanel.js";
import { ELENA_HISTORY } from "./elenaSelfCheck.js";
import { EXPERIENCES, CAPTURE, experienceFromHash } from "./siteNav.js";

const SYSTEMS = [["body", "Body"], ["skeleton", "Skeleton"], ["muscle", "Muscle"], ["cardiovascular", "Cardiovascular"], ["renal", "Renal"], ["radiation", "Radiation"], ["multisystem", "Multisystem"]];
const SYSTEM_FOCUS = { body: "body", skeleton: "body", muscle: "body", cardiovascular: "thorax", renal: "kidneys", radiation: "body", multisystem: "body", functional: "legs", impact: "leftLeg" };
// Self-check step -> [scene system, camera focus].
const SELF_STEP_VIEW = { safety: ["multisystem", "body"], movement: ["functional", "legs"], reaction: ["multisystem", "head"], mind: ["multisystem", "head"], body: ["cardiovascular", "thorax"], result: ["multisystem", "body"] };
const PHYSIO_TABS = [["cardio", "Cardiovascular", "cardiovascular", "thorax"], ["renal", "Renal pathway", "renal", "kidneys"], ["radiation", "Radiation", "radiation", "body"], ["predicted", "Predicted vs observed", "skeleton", "legs"]];
const BAND_LABELS = { lower: "LOWER", monitor: "MONITOR", elevated: "ELEVATED", capacityExceeded: "CAPACITY EXCEEDED" };
const BAND_COLORS = { lower: "#46d7ff", monitor: "#ffd166", elevated: "#ff9f43", capacityExceeded: "#ff5a4f" };
// Canvas 2D cannot resolve CSS variables, so the mono stack is repeated here.
const MONO = '"JetBrains Mono", "Cascadia Code", Consolas, monospace';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "--");
const signed = (value, digits = 0) => (Number.isFinite(value) ? `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}` : "--");
const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value; else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else if (key === "style") node.style.cssText = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child?.nodeType ? child : String(child));
  return node;
}
// DOM replaceChildren() would print null children as text, so filter them first.
const fill = (node, ...children) => node.replaceChildren(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
const prov = kind => el("em", { class: `tw-prov tw-prov-${kind.toLowerCase()}`, title: PROVENANCE[kind] }, kind === "NONE" ? "NO DATA" : kind);

export function createTwinApp(root) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { experience: "mission", system: "multisystem", day: CURRENT_DAY, compare: false, physio: "cardio", impactDone: false, impactRunning: false, mc: null, engineCheck: null, demo: null, stressReady: false };
  const event = evaluateImpact();
  let simulation = null, research = null, current = twinState(state.day), stressField = null;

  const canvas = el("canvas", { id: "tw-canvas", "aria-label": "Interactive 3D digital twin of the synthetic astronaut Elena. Reference anatomy, not her measured anatomy." });
  const tooltip = el("div", { class: "tw-tooltip", role: "status", hidden: true });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("tw-links"); svg.setAttribute("aria-hidden", "true");
  const nav = el("nav", { class: "tw-nav", "aria-label": "AstroBone experiences" }, EXPERIENCES.map(([key, label]) =>
    el("button", { type: "button", "data-experience": key, onclick: () => { stopDemo(); setExperience(key); } }, label)));
  const liveLink = el("a", { class: "tw-live", href: CAPTURE.href, title: "Camera movement capture, crew records and research tools" }, el("i", { "aria-hidden": "true" }), CAPTURE.label);
  const dayValue = el("strong", { id: "tw-day" }, String(state.day));
  const startButton = el("button", { type: "button", class: "tw-start", onclick: () => (state.demo ? stopDemo() : runDemo()) }, "Start mission simulation");
  const header = el("header", { class: "tw-top" },
    el("a", { class: "tw-brand", href: "#", "aria-label": "AstroBone digital twin home", onclick: e => { e.preventDefault(); stopDemo(); setExperience("mission"); } },
      el("span", { class: "tw-mark", "aria-hidden": "true" }), el("span", {}, el("b", {}, "ASTROBONE"), el("small", {}, "DIGITAL PHYSIOLOGICAL TWIN"))),
    nav, liveLink,
    el("div", { class: "tw-ident" }, el("b", {}, "ELENA TORRES"), el("small", {}, `SYNTHETIC ASTRONAUT · ${ELENA.identity.mission.value}`)),
    el("div", { class: "tw-daybox", "aria-live": "polite" }, el("small", {}, "MISSION DAY"), el("span", {}, dayValue, el("i", {}, `/ ${MISSION_LENGTH}`))),
    startButton);
  const systemRail = el("aside", { class: "tw-systems", "aria-label": "Body systems" },
    el("span", { class: "tw-eyebrow" }, "SYSTEMS"),
    SYSTEMS.map(([key, label]) => el("button", { type: "button", "data-system": key, onclick: () => { stopDemo(); state.compare = false; setExperience("twin", { system: key }); } }, el("i", { "aria-hidden": "true" }), label)),
    el("button", { type: "button", class: "tw-compare", "aria-pressed": "false", onclick: () => { stopDemo(); toggleCompare(); } }, "Day 1 vs now"));
  const panels = el("section", { class: "tw-panels", "aria-label": "Selected system values", "aria-live": "polite" });
  const nodes = el("section", { class: "tw-nodes", "aria-label": "Multisystem status" });
  const drawer = el("section", { class: "tw-drawer", "aria-live": "polite" });
  const legend = el("div", { class: "tw-legend" });
  const labels = el("div", { class: "tw-labels", "aria-hidden": "true" });
  const caption = el("div", { class: "tw-caption", role: "status", "aria-live": "assertive", hidden: true });
  const loading = el("div", { class: "tw-loading" }, el("span", {}, "Loading reference anatomy"), el("div", { class: "tw-progress" }, el("i", {})));

  // Timeline
  const slider = el("input", { type: "range", min: 1, max: MISSION_LENGTH, step: 1, value: state.day, "aria-label": "Mission day" });
  const spark = el("canvas", { class: "tw-spark", "aria-hidden": "true" });
  const ticks = el("div", { class: "tw-ticks" }, CHECKPOINTS.map(day => el("button", {
    type: "button", "data-day": day, style: `left:${((day - 1) / (MISSION_LENGTH - 1)) * 100}%`, onclick: () => { stopDemo(); animateDay(day); },
    title: day > CURRENT_DAY ? "Authored scenario checkpoint, not a forecast" : "Recorded synthetic checkpoint",
  }, `D${day}`)));
  const playButton = el("button", { type: "button", class: "tw-play", onclick: () => { if (playing) stopPlay(); else { stopDemo(); play(); } } }, "Play");
  const timeline = el("footer", { class: "tw-timeline" },
    el("div", { class: "tw-tl-head" }, el("span", { class: "tw-eyebrow" }, "MISSION TIMELINE"),
      el("small", {}, "Observations step to the last recorded checkpoint. Model estimates are continuous. Days after 147 are authored scenarios, not forecasts."), playButton),
    el("div", { class: "tw-track" }, spark, el("div", { class: "tw-future", style: `left:${((CURRENT_DAY - 1) / (MISSION_LENGTH - 1)) * 100}%` }, el("span", {}, "AUTHORED SCENARIO")),
      el("div", { class: "tw-now", style: `left:${((CURRENT_DAY - 1) / (MISSION_LENGTH - 1)) * 100}%` }, el("span", {}, `NOW · D${CURRENT_DAY}`)),
      el("div", { class: "tw-event-mark", hidden: true, style: `left:${((IMPACT_SCENARIO.day.value - 1) / (MISSION_LENGTH - 1)) * 100}%` }, el("span", {}, "IMPACT")), slider, ticks));

  const intro = el("div", { class: "tw-intro", role: "dialog", "aria-label": "AstroBone introduction" },
    el("div", { class: "tw-intro-title" }, el("b", {}, "ASTROBONE"), el("span", {}, "DIGITAL PHYSIOLOGICAL TWIN")),
    el("ul", { class: "tw-intro-lines" }, ["ELENA", "SYNTHETIC ASTRONAUT", `MISSION DAY ${CURRENT_DAY}`, "DIGITAL TWIN ONLINE"].map(text => el("li", {}, text))),
    el("button", { type: "button", class: "tw-skip", onclick: () => finishIntro() }, "Skip"));
  const closing = el("div", { class: "tw-closing", hidden: true }, el("b", {}, "ASTROBONE"), el("p", {}, ["PREDICT.", "OBSERVE.", "UPDATE.", "PROTECT."].map(w => el("span", {}, w))),
    el("small", {}, "Synthetic demonstration · research models · human medical review required"));

  root.append(canvas, svg, labels, header, systemRail, panels, nodes, drawer, legend, timeline, tooltip, caption, closing, intro, loading);
  document.body.classList.add("tw-booting");

  const scene = createTwinScene(canvas, {
    onPick: name => { stopDemo(); navigateFromBody(name); },
    onHover: info => {
      if (!info) { tooltip.hidden = true; return; }
      tooltip.hidden = false; tooltip.textContent = info.label; tooltip.style.transform = `translate(${info.x + 14}px, ${info.y + 12}px)`;
    },
    onProgress: value => { loading.querySelector("i").style.width = `${Math.round(value * 100)}%`; },
    onFrame: project => updateOverlays(project),
  });

  state.selfStep = "safety";
  const selfCheck = createSelfCheckPanel({
    onStep: step => {
      state.selfStep = step; if (state.experience !== "selfcheck") return;
      if (step !== "result") scene.setAlerts({});
      const [system, focus] = SELF_STEP_VIEW[step]; scene.setSystem(system, { focusTarget: focus }); render();
    },
    onEvaluate: evaluation => { scene.setAlerts(Object.fromEntries(evaluation.domains.map(d => [d.key, d.status === "changed"]))); render(); },
  });

  // Body as navigation: the structure clicked selects the analysis.
  function navigateFromBody(name) {
    if (name === "tibiaL") setExperience("impact");
    else if (["heart", "major", "pulmonary"].includes(name)) setExperience("physiology", { physio: "cardio" });
    else if (name === "renal") setExperience("physiology", { physio: "renal" });
    else if (name === "radiation") setExperience("physiology", { physio: "radiation" });
    else if (["quadriceps", "hamstrings", "gluteal", "calf", "trunk"].includes(name)) setExperience("functional");
    else if (name === "lumbar") { setExperience("twin", { system: "skeleton" }); scene.focus("spine"); }
    else if (name === "pelvis") { setExperience("twin", { system: "skeleton" }); scene.focus("pelvis"); }
    else if (["femurL", "femurR", "tibiaR"].includes(name)) { setExperience("twin", { system: "skeleton" }); scene.focus("legs"); }
  }

  function sceneSystem() {
    if (state.compare) return "skeleton";
    if (state.experience === "mission" || state.experience === "evidence") return "multisystem";
    if (state.experience === "functional") return "functional";
    if (state.experience === "impact") return "impact";
    if (state.experience === "selfcheck") return SELF_STEP_VIEW[state.selfStep][0];
    if (state.experience === "physiology") return PHYSIO_TABS.find(([key]) => key === state.physio)[2];
    return state.system;
  }
  function sceneFocus(system) {
    if (state.experience === "physiology") return PHYSIO_TABS.find(([key]) => key === state.physio)[3];
    if (state.experience === "selfcheck") return SELF_STEP_VIEW[state.selfStep][1];
    return SYSTEM_FOCUS[system] ?? "body";
  }

  function setExperience(experience, { system, physio, focus = true } = {}) {
    const previous = state.experience;
    state.experience = experience;
    if (system) state.system = system;
    if (physio) state.physio = physio;
    if (experience !== "twin" && state.compare) { state.compare = false; scene.setCompare(false); }
    if (previous === "impact" && experience !== "impact") scene.resetImpact();
    if (previous === "selfcheck" && experience !== "selfcheck") { selfCheck.stop(); scene.setAlerts({}); }
    const target = sceneSystem();
    scene.setSystem(target, { focusTarget: focus ? sceneFocus(target) : undefined });
    if (experience === "impact" && state.impactDone && !state.impactRunning) { scene.showStress(true); scene.focus("leftLeg"); }
    if (experience === "impact" || experience === "functional") ensureSimulations();
    if (previous !== experience) drawer.scrollTop = 0;
    // The address names the section, so a link (or Back from Live Capture) returns to it.
    if (location.hash !== `#${experience}`) history.replaceState(null, "", `${location.pathname}${location.search}#${experience}`);
    render();
  }
  window.addEventListener("hashchange", () => { const key = experienceFromHash(location.hash); if (key && key !== state.experience) { stopDemo(); setExperience(key); } });

  function toggleCompare() {
    state.compare = !state.compare;
    if (state.compare && state.experience !== "twin") { state.experience = "twin"; scene.resetImpact(); }
    scene.setCompare(state.compare);
    if (!state.compare) scene.setSystem(sceneSystem(), { focusTarget: sceneFocus(sceneSystem()) });
    render();
  }

  function setDay(day, { travel = false } = {}) {
    const next = Math.min(MISSION_LENGTH, Math.max(1, Math.round(day)));
    if (next === state.day && current) return;
    if (travel || Math.abs(next - state.day) > 20) scene.timeTravel();
    state.day = next; current = twinState(next);
    scene.setState(current, { bonesSolidity: current.bone.evidence.solidity });
    render();
  }
  let dayAnimation = null;
  function animateDay(target, duration = 1100) {
    cancelAnimationFrame(dayAnimation); const from = state.day, start = performance.now();
    if (reduceMotion || from === target) { setDay(target, { travel: true }); return Promise.resolve(); }
    scene.timeTravel();
    return new Promise(resolve => {
      const step = now => {
        const t = Math.min(1, (now - start) / duration), k = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        setDay(from + (target - from) * k);
        if (t < 1) dayAnimation = requestAnimationFrame(step); else resolve();
      };
      dayAnimation = requestAnimationFrame(step);
    });
  }
  let playing = false;
  function play() {
    playing = true; playButton.textContent = "Pause";
    const startDay = state.day >= MISSION_LENGTH ? 1 : state.day; let last = performance.now(), position = startDay;
    const step = now => {
      if (!playing) return;
      position += (now - last) / 1000 * 22; last = now; setDay(position);
      if (position >= MISSION_LENGTH) { stopPlay(); return; }
      dayAnimation = requestAnimationFrame(step);
    };
    if (startDay === 1) setDay(1, { travel: true });
    dayAnimation = requestAnimationFrame(step);
  }
  function stopPlay() { playing = false; playButton.textContent = "Play"; cancelAnimationFrame(dayAnimation); }
  slider.addEventListener("input", () => { stopDemo(); stopPlay(); setDay(Number(slider.value)); });

  // ---------- Rendering ----------
  function card({ label, value, unit = "", detail, kind, quality, qualityLabel, tone }) {
    const q = Number.isFinite(quality) ? quality : null;
    return el("article", { class: "tw-card", "data-kind": kind.toLowerCase(), "data-tone": tone, style: q !== null ? `--q:${q}` : undefined },
      el("header", {}, el("span", {}, label), prov(kind)),
      el("strong", {}, value, unit ? el("small", {}, unit) : null),
      detail ? el("p", {}, detail) : null,
      q !== null ? el("div", { class: "tw-quality", title: "Visual solidity follows this indicator" }, el("i", { style: `width:${Math.round(q * 100)}%` }), el("span", {}, qualityLabel ?? `INPUT QUALITY ${q.toFixed(2)}`)) : null);
  }

  function systemCards() {
    const s = current, o = s.observation, rec = o.recordDay === s.day ? `Recorded Day ${o.recordDay}` : `Last record Day ${o.recordDay}`;
    const bone = card({ label: "Bone capacity change", value: `−${fmt(s.bone.lossFraction * 100)}`, unit: "%", kind: "MODEL", quality: s.bone.evidence.solidity, qualityLabel: `PARAMETER ${s.bone.evidence.id} · EVIDENCE ${s.bone.evidence.level.toUpperCase()}`,
      detail: `Weight-bearing set · 1.25 %/month capacity modifier × ${fmt(s.day / 30.4375, 2)} months. Not imaging, not site-specific.` });
    const knee = card({ label: "Knee extension", value: String(s.knee.extension), unit: "°", kind: "SYNTHETIC", quality: s.knee.quality, detail: `${signed(s.knee.delta)}° vs Day 1 · ${rec}` });
    const heart = card({ label: "Heart rate", value: String(s.heart.bpm), unit: "bpm", kind: "SYNTHETIC", quality: s.heart.quality, detail: `${signed(s.heart.delta)} bpm vs ${s.heart.baselineBpm} baseline · heart animates at ${fmt(s.heart.hz, 2)} Hz` });
    const dose = card({ label: "Cumulative dose", value: fmt(s.radiation.doseMgy, 2), unit: "mGy", kind: "SYNTHETIC", detail: `${s.radiation.eventIncluded ? `Includes +${ELENA.event.increment.value} mGy tabletop event · ` : ""}Illustrative dosimeter history, not effective dose` });
    const day = card({ label: "Mission day", value: String(s.day), unit: `/ ${MISSION_LENGTH}`, kind: "SYNTHETIC", detail: s.authoredScenario ? "Authored scenario checkpoint, not a forecast" : `${ELENA.identity.mission.value} · ${ELENA.identity.destination.value}` });
    const check = latestCheckpoint(s.day), pvo = predictedVsObserved(check);
    const trend = card({ label: `Trend check · Day ${check}`, value: pvo.forecast ? `${pvo.observed.value}°` : "--", unit: pvo.forecast ? ` vs ${fmt(pvo.forecast.predicted)}°` : "", kind: "DERIVED",
      tone: pvo.forecast && !pvo.inside ? "warn" : undefined, detail: pvo.forecast ? `${pvo.verdict} (95 % PI ${fmt(pvo.forecast.low)}–${fmt(pvo.forecast.high)}°) · linear fit to Days ${pvo.forecast.fitDays.join(", ")}` : "Needs three earlier usable observations." });
    const map = {
      body: [day, card({ label: "Outer form", value: "Atlas", kind: "ATLAS", detail: "Silhouette rendered from the muscle atlas. No skin mesh and no personal body scan." }), knee, heart, dose],
      skeleton: [bone, card({ label: "Weight-bearing set", value: "6", unit: "regions", kind: "ATLAS", detail: "Tibiae, femora, pelvis + sacrum, lumbar L1–L5 share one modeled tint. Other bones stay neutral." }), knee, day],
      muscle: [card({ label: "Muscle model", value: "683", unit: "structures", kind: "ATLAS", detail: "Full Z-Anatomy muscular system including hands, feet and face. Orange = quadriceps, hamstrings, gluteals, calves, trunk (typically recruited, not measured activation)." }),
        card({ label: "Knee range of motion", value: String(s.knee.rom), unit: "°", kind: "SYNTHETIC", quality: s.knee.quality, detail: `${signed(s.knee.rom - s.knee.baselineRom)}° vs Day 1 · ${rec}` }), knee,
        card({ label: "Muscle force", value: "Not measured", kind: "NONE", detail: "No dynamometry or EMG in this mission record." })],
      cardiovascular: [heart, card({ label: "Baseline heart rate", value: String(s.heart.baselineBpm), unit: "bpm", kind: "SYNTHETIC", detail: "Day 1, resting, restrained protocol" }),
        card({ label: "ΔHR", value: signed(s.heart.delta), unit: "bpm", kind: "DERIVED", detail: "Current minus Day 1 baseline" }),
        card({ label: "Model vs observed", value: "No model", kind: "NONE", detail: "AstroBone has no cardiovascular prediction model, so only the observed series is shown. No ECG acquired." })],
      renal: [card({ label: "Skeletal unloading", value: `−${fmt(s.bone.lossFraction * 100)}`, unit: "%", kind: "MODEL", quality: s.bone.evidence.solidity, qualityLabel: "EVIDENCE LOW", detail: "Capacity modifier only. Mineral release is not modeled." }),
        card({ label: "Urinary calcium", value: "No data", kind: "NONE", detail: "No urine chemistry in this mission record." }),
        card({ label: "Stone-risk proxy", value: "Not computed", kind: "NONE", detail: "Pathway shown from literature physiology; no Elena value exists." }),
        card({ label: "Renal vessels", value: "12", unit: "structures", kind: "ATLAS", detail: "Renal and intrarenal arteries and veins. Kidney tissue is not in the atlas." })],
      radiation: [dose, day, card({ label: "Tracks drawn", value: String(s.radiation.tracks), kind: "DERIVED", detail: `${TRACKS_PER_MGY} per mGy of cumulative dose. Paths are illustrative, not particle transport.` }),
        card({ label: "Biological burden", value: "Not modeled", kind: "NONE", detail: "No organ dose or radiation-effect model. Dose does not imply injury." })],
      multisystem: [day, bone, knee, heart, dose, trend],
    };
    return map[state.system] ?? map.multisystem;
  }

  const NODE_DEFS = [
    ["musculoskeletal", "Musculoskeletal", "lumbar", "left", "skeleton"], ["functional", "Functional", "quadriceps", "left", "functional"], ["behavioral", "Behavioral health", "head", "left", "selfcheck"],
    ["cardiovascular", "Cardiovascular", "heart", "right", "cardiovascular"], ["immune", "Immune", "heart", "right", "selfcheck"], ["radiation", "Radiation", "radiation", "right", "radiation"],
  ];
  function nodeContent(key) {
    const s = current;
    if (key === "musculoskeletal") return { status: `−${fmt(s.bone.lossFraction * 100)} %`, change: "model capacity change", conf: s.bone.evidence.solidity, confLabel: "EVIDENCE LOW", kind: "MODEL" };
    if (key === "functional") return { status: `${s.knee.extension}°`, change: `${signed(s.knee.delta)}° knee ext. vs D1`, conf: s.knee.quality, confLabel: `QUALITY ${s.knee.quality.toFixed(2)}`, kind: "SYNTHETIC" };
    if (key === "behavioral" || key === "immune") return selfCheckNode(key);
    if (key === "cardiovascular") return { status: `${s.heart.bpm} bpm`, change: `${signed(s.heart.delta)} bpm vs D1`, conf: s.heart.quality, confLabel: `QUALITY ${s.heart.quality.toFixed(2)}`, kind: "SYNTHETIC" };
    return { status: `${fmt(s.radiation.doseMgy, 2)} mGy`, change: s.radiation.eventIncluded ? "includes tabletop event" : "cumulative, synthetic", conf: 1, confLabel: "AUTHORED RECORD", kind: "SYNTHETIC" };
  }
  // Before Day 147 the nodes show Elena's authored self-check records; from Day 147 the evaluated self-check.
  function selfCheckNode(key) {
    const label = { changed: "REVIEW", stable: "STABLE", repeat: "REPEAT", baseline: "BASELINE", urgent: "URGENT", notChecked: "NOT CHECKED" };
    if (current.day < CURRENT_DAY) {
      const record = ELENA_HISTORY.filter(r => r.missionDay <= current.day).at(-1), v = record.values;
      return key === "behavioral"
        ? { status: `${fmt(v.sleepHours)} h sleep`, change: `${v.pvtLapses} reaction lapses · self-check D${record.missionDay}`, conf: .8, confLabel: "TEST + SELF-REPORT", kind: "SYNTHETIC" }
        : { status: "No symptoms", change: `self-report · D${record.missionDay}`, conf: .8, confLabel: "SELF-REPORT", kind: "SYNTHETIC" };
    }
    const evaluation = selfCheck.latestEvaluation("elena"), domain = evaluation?.domains.find(d => d.key === key);
    if (!domain) return { status: "Not checked", change: "Open Self-Check", conf: 0, confLabel: "NO DATA", kind: "NONE" };
    const changed = domain.indicators?.filter(r => r.status === "changed").map(r => r.def.label.toLowerCase()) ?? [];
    return { status: label[domain.status], change: key === "immune" ? (domain.symptoms?.length ? domain.symptoms.join(", ") : "no new symptoms") : changed.length ? changed.join(", ") : "within usual range",
      conf: .8, confLabel: key === "immune" ? "SELF-REPORT" : "TEST + SELF-REPORT", kind: "SYNTHETIC" };
  }
  function renderNodes() {
    nodes.replaceChildren(...["left", "right"].map(side => el("div", { class: `tw-node-col tw-${side}` }, NODE_DEFS.filter(d => d[3] === side).map(([key, label, anchor, , system]) => {
      const c = nodeContent(key);
      return el("button", { type: "button", class: "tw-node", "data-node": key, "data-anchor": anchor, "data-kind": c.kind.toLowerCase(), disabled: system ? undefined : true, style: `--q:${c.conf}`,
        onclick: () => { if (!system) return; stopDemo(); if (system === "functional" || system === "selfcheck") setExperience(system); else setExperience("twin", { system }); } },
      el("span", { class: "tw-node-head" }, label, prov(c.kind)), el("strong", {}, c.status), el("small", {}, c.change),
      el("span", { class: "tw-quality" }, el("i", { style: `width:${Math.round(c.conf * 100)}%` }), el("span", {}, c.confLabel)));
    }))));
  }

  function renderLegend() {
    legend.replaceChildren();
    const system = sceneSystem();
    if (state.experience === "impact" && state.impactDone) {
      legend.append(el("span", { class: "tw-eyebrow" }, "RELATIVE BENDING STRESS σ/σmax"), el("div", { class: "tw-ramp tw-ramp-stress" }), el("div", { class: "tw-ramp-labels" }, el("span", {}, "LOW"), el("span", {}, "HIGH")),
        el("small", {}, "Euler–Bernoulli beam, pinned at knee and ankle, section from atlas geometry. Shape only, not finite-element; magnitude not computed."));
    } else if (["skeleton", "multisystem"].includes(system) || state.compare) {
      const stops = [0, .25, .5, .75, 1].map(t => { const c = boneTint(BONE_TINT_SCALE.max * t); return `rgb(${c.map(v => Math.round(v * 255)).join(",")}) ${t * 100}%`; });
      legend.append(el("span", { class: "tw-eyebrow" }, "MODEL-ESTIMATED SKELETAL CHANGE"), el("div", { class: "tw-ramp", style: `background:linear-gradient(90deg,${stops.join(",")})` }),
        el("div", { class: "tw-ramp-labels" }, el("span", {}, "0 %"), el("span", {}, `−${BONE_TINT_SCALE.max * 100} % capacity`)),
        el("small", {}, `Now −${fmt(current.bone.lossFraction * 100)} % · uniform rate on weight-bearing bones (B-05, evidence low) · desaturated to show low confidence. Not imaging.`));
    } else if (system === "cardiovascular") {
      legend.append(el("span", { class: "tw-eyebrow" }, "PULSE-SYNCHRONIZED VISUAL"), el("small", {}, `Heart and vessel pulses run at ${current.heart.bpm} bpm (${fmt(current.heart.hz, 2)} Hz) from the recorded rate. Atlas geometry, no measured flow or cardiac mechanics.`));
    } else if (system === "radiation") {
      legend.append(el("span", { class: "tw-eyebrow" }, "RADIATION TRACKS"), el("small", {}, `${current.radiation.tracks} tracks = ${TRACKS_PER_MGY} × ${fmt(current.radiation.doseMgy, 2)} mGy cumulative synthetic dose. Paths are illustrative, not transport or tissue dose.`));
    } else if (system === "renal") {
      legend.append(el("span", { class: "tw-eyebrow" }, "RENAL VESSELS"), el("small", {}, "Renal and intrarenal vessels from the atlas. Kidney tissue is not in the atlas and no renal data exist for Elena."));
    } else if (system === "muscle") {
      legend.append(el("span", { class: "tw-eyebrow" }, "MUSCULAR SYSTEM · ATLAS"), el("small", {}, "Red: all atlas muscles, including the hands. Orange: key groups for the knee-extension test. Pale: tendons and sheaths. Fascia sheets are hidden so muscles stay visible. Reference anatomy, not measured size or activation."));
    } else if (system === "functional") {
      legend.append(el("span", { class: "tw-eyebrow" }, "REFERENCE MUSCLES"), el("small", {}, "Highlighted groups are typically recruited in knee extension. The pulse follows the diagram cycle, not measured activation."));
    }
    legend.hidden = !legend.childElementCount;
  }

  function render() {
    const s = current;
    root.dataset.experience = state.experience; root.dataset.system = sceneSystem(); root.dataset.compare = String(state.compare);
    dayValue.textContent = String(s.day); slider.value = String(s.day);
    slider.setAttribute("aria-valuetext", `Day ${s.day}${s.authoredScenario ? ", authored scenario" : ""}`);
    nav.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.experience === state.experience)));
    systemRail.querySelectorAll("[data-system]").forEach(b => b.setAttribute("aria-pressed", String(state.experience === "twin" && !state.compare && b.dataset.system === state.system)));
    systemRail.querySelector(".tw-compare").setAttribute("aria-pressed", String(state.compare));
    ticks.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.day) === latestCheckpoint(s.day))));
    timeline.querySelector(".tw-event-mark").hidden = !state.impactDone;
    if (state.experience === "twin") panels.replaceChildren(...(state.compare ? compareCards() : systemCards()));
    else panels.replaceChildren();
    if (state.experience === "mission") renderNodes(); else nodes.replaceChildren();
    renderDrawer(); renderLegend(); drawSpark();
  }

  function compareCards() {
    const s = current, b = twinState(1);
    const row = (label, a, c, unit, kind) => card({ label, value: `${a} → ${c}`, unit, kind });
    return [
      row("Bone capacity (model)", "0.0", `−${fmt(s.bone.lossFraction * 100)}`, "%", "MODEL"),
      row("Knee extension", b.knee.extension, s.knee.extension, "°", "SYNTHETIC"),
      row("Knee ROM", b.knee.rom, s.knee.rom, "°", "SYNTHETIC"),
      row("Heart rate", b.heart.bpm, s.heart.bpm, "bpm", "SYNTHETIC"),
      row("Cumulative dose", "0", fmt(s.radiation.doseMgy, 2), "mGy", "SYNTHETIC"),
      card({ label: "Not recorded", value: "Hip · velocity · function score", kind: "NONE", detail: "These metrics are not in Elena's fixture, so no before/after is shown." }),
    ];
  }

  // ---------- Drawer experiences ----------
  function renderDrawer() {
    const exp = state.experience;
    drawer.hidden = !["selfcheck", "functional", "impact", "physiology", "evidence"].includes(exp);
    if (drawer.hidden) { fill(drawer); drawer.dataset.view = ""; return; }
    // The self-check keeps live camera and test state, so its element is never rebuilt.
    if (exp === "selfcheck") {
      if (drawer.dataset.view !== "selfcheck" || !drawer.contains(selfCheck.element)) fill(drawer, drawerHead("DAILY SELF-CHECK", "Gather · evaluate · act"), selfCheck.element);
      drawer.dataset.view = "selfcheck"; return;
    }
    drawer.dataset.view = exp;
    if (exp === "impact") renderImpact();
    else if (exp === "functional") renderFunctional();
    else if (exp === "physiology") renderPhysiology();
    else renderEvidence();
  }

  function drawerHead(eyebrow, title, kind) { return el("header", { class: "tw-drawer-head" }, el("span", { class: "tw-eyebrow" }, eyebrow), el("h2", {}, title), kind ? prov(kind) : null); }

  function renderImpact() {
    const ev = event, s = IMPACT_SCENARIO, phases = ["OBJECT TRAJECTORY", "IMPACT POINT", "LOAD TRANSFER", "TIBIA MODEL", "STRESS PROPAGATION"];
    const params = [["Mass", `${fmt(s.massKg.value)} kg`], ["Velocity", `${fmt(s.speedMps.value)} m/s`], ["Impact angle", `${s.angleFromSurfacePlaneDegrees.value}°`, "from surface plane · 90° = normal"], ["Contact area", `${s.contactAreaMm2.value} mm²`], ["Pulse", `${s.impactDurationMs.value} ms`]];
    const run = el("button", { type: "button", class: "tw-primary", disabled: state.impactRunning || !state.stressReady || undefined, onclick: () => { stopDemo(); runImpact(); } },
      state.impactRunning ? "Reconstructing…" : state.impactDone ? "Replay reconstruction" : state.stressReady ? "Run reconstruction" : "Preparing model…");
    const results = state.impactDone ? el("section", { class: "tw-results" },
      el("h3", {}, "Level-A structural result"), el("dl", {},
        el("dt", {}, "Normal impact speed"), el("dd", {}, `${fmt(ev.normalImpactSpeedMps, 2)} m/s`),
        el("dt", {}, "Average contact force"), el("dd", {}, `${fmt(ev.averageForceN, 0)} N`),
        el("dt", {}, "Nominal contact stress"), el("dd", {}, `${fmt(ev.contactStressPa / 1e6, 1)} MPa`),
        el("dt", {}, `Capacity at Day ${s.day.value}`), el("dd", {}, `${fmt(ev.adjustedCapacity / 1e6, 1)} MPa (${s.baselineCapacityMPa.value} × ${fmt(ev.capacityFactors.microgravity, 3)})`),
        el("dt", {}, "Demand / capacity ratio"), el("dd", { class: `tw-band tw-band-${ev.band.key}` }, `${fmt(ev.demandCapacityRatio, 3)} · ${ev.band.label}`)),
      el("p", { class: "tw-note" }, "PEAK MODELED STRESS REGION marks the highest relative bending stress in the beam idealization. It is not a detected crack or a damage measurement."),
      el("details", {}, el("summary", {}, "Assumptions and scope warnings"), el("ul", {}, [...ev.assumptions, ...ev.warnings.map(w => `${w} The Level-A reference uses an effective research-envelope capacity (25 MPa), not the calculator's tissue-level range.`)].map(t => el("li", {}, t))))) : null;
    const mcSection = el("section", { class: "tw-mc" }, el("header", {}, el("h3", {}, "Monte Carlo · 10,000 runs"), prov("MODEL")),
      el("button", { type: "button", class: "tw-secondary", disabled: !state.impactDone || !simulation || mcRunning || undefined, onclick: () => { stopDemo(); runMonteCarloView(); } }, state.mc ? "Run again" : "Run Monte Carlo"),
      mcCanvas, mcSummary());
    fill(drawer, drawerHead("IMPACT LAB · RECONSTRUCTED EVENT", `Day ${s.day.value} · ${s.label.value}`, "SYNTHETIC"),
      el("ol", { class: "tw-phases" }, phases.map((p, i) => el("li", { "data-done": String(state.impactDone || impactPhaseIndex > i), "data-active": String(state.impactRunning && impactPhaseIndex === i) }, p))),
      el("div", { class: "tw-params" }, params.map(([k, v, note]) => el("div", {}, el("small", {}, k), el("b", {}, v), note ? el("i", {}, note) : null))),
      run, results, mcSection, postEventSection(),
      el("p", { class: "tw-boundary" }, s.boundary));
    if (state.mc && !mcRunning) drawMonteCarlo(1);
  }

  const mcCanvas = el("canvas", { class: "tw-mc-canvas", role: "img", "aria-label": "Monte Carlo run distribution" });
  function mcSummary() {
    if (!state.mc) return el("p", { class: "tw-note" }, state.impactDone ? "Samples reconstruction uncertainty and the Level-A capacity and loss-rate distributions; every run calls the same calculateRisk() engine." : "Run the reconstruction first.");
    const mc = state.mc, check = state.engineCheck, ref = simulation?.monteCarlo;
    return el("div", { class: "tw-mc-summary" },
      el("ul", { class: "tw-bands" }, mc.order.map(key => el("li", { style: `--c:${BAND_COLORS[key]}` }, el("span", {}, BAND_LABELS[key]), el("b", {}, pct(mc.fractions[key])), el("small", {}, `${Math.round(mc.fractions[key] * mc.runs).toLocaleString()} runs`)))),
      el("p", {}, `DCR median ${fmt(mc.summary.median, 2)} · 5th–95th percentile ${fmt(mc.summary.p05, 2)}–${fmt(mc.summary.p95, 2)} · seed ${mc.seed}`),
      el("p", { class: "tw-note" }, mc.interpretation),
      check ? el("p", { class: "tw-check" }, el("b", {}, "ENGINE CHECK "), `Same engine on the stored research envelope: capacity exceeded ${pct(check.fractions.capacityExceeded)} vs ${pct(ref.scenarioFractions.capacityExceeded)}, lower ${pct(check.fractions.lower)} vs ${pct(ref.scenarioFractions.lower)} in the stored ${ref.runs.toLocaleString()}-run reference (public/simulations/astrobone-level-a-v1.json).`) : null,
      el("details", {}, el("summary", {}, "Input distributions"), el("ul", {}, Object.entries(eventDistributions(IMPACT_SCENARIO, simulation.monteCarlo.assumedInputDistributions)).map(([k, d]) =>
        el("li", {}, `${k}: ${d.distribution}${d.distribution === "fixed" ? ` ${fmt(d.value, 3)}` : d.distribution === "truncated normal" ? ` ${d.mean} ± ${d.standardDeviation} [${d.minimum}, ${d.maximum}]` : ` [${fmt(d.minimum, 3)}, ${d.mode !== undefined ? `${fmt(d.mode, 3)}, ` : ""}${fmt(d.maximum, 3)}]`}${d.note ? ` · ${d.note}` : ""}`)))));
  }

  function postEventSection() {
    if (!state.impactDone) return null;
    const pe = IMPACT_SCENARIO.postEventCheck, result = postEvent();
    return el("section", { class: "tw-post" }, el("header", {}, el("h3", {}, `Post-event functional check · Day ${pe.day.value}`), prov("SYNTHETIC")),
      el("p", {}, `Knee extension ${pe.kneeExtension.value}° observed vs ${fmt(result.forecast.predicted)}° predicted from Days ${result.forecast.fitDays.join(", ")} (95 % PI ${fmt(result.forecast.low)}–${fmt(result.forecast.high)}°).`),
      el("strong", { class: result.inside ? "" : "tw-warn" }, result.inside ? "Within prediction interval" : "Outside prediction interval → human medical review"),
      el("button", { type: "button", class: "tw-secondary", onclick: () => setExperience("functional") }, "Open functional comparison"));
  }
  const postEvent = () => { const pe = IMPACT_SCENARIO.postEventCheck; return predictedVsObserved(pe.day.value, [{ day: pe.day.value, value: pe.kneeExtension.value, quality: pe.trackingQuality.value, source: "SYNTHETIC DEMO" }]); };

  let impactPhaseIndex = -1;
  async function runImpact() {
    if (state.impactRunning || !state.stressReady) return;
    state.impactRunning = true; impactPhaseIndex = 0; state.mc = null;
    if (state.experience !== "impact") setExperience("impact");
    if (state.day !== IMPACT_SCENARIO.day.value) await animateDay(IMPACT_SCENARIO.day.value, 700);
    render();
    const phaseMap = { focus: 0, trajectory: 0, impact: 1, stress: 3, hotspot: 4, done: 5 };
    const captions = { trajectory: "RECONSTRUCTED EVENT · object trajectory (synthetic)", impact: "IMPACT · load transfer from the Level-A force estimate", stress: "STRUCTURAL SIMULATION RUNNING · relative bending stress", hotspot: "PEAK MODELED STRESS REGION · not a detected crack" };
    await scene.playImpact({ onPhase: phase => { impactPhaseIndex = phaseMap[phase] ?? impactPhaseIndex; if (phase === "impact") impactPhaseIndex = 2; if (captions[phase]) showCaption(captions[phase], state.demo ? 0 : 2600); renderDrawer(); } });
    state.impactRunning = false; state.impactDone = true; impactPhaseIndex = 5;
    render();
  }

  // ---------- Monte Carlo view ----------
  let mcRunning = false, mcAnim = null;
  async function ensureSimulations() {
    if (simulation) return simulation;
    try { simulation = await (await fetch(`${import.meta.env.BASE_URL}simulations/astrobone-level-a-v1.json`)).json(); }
    catch { simulation = null; }
    render(); return simulation;
  }
  async function runMonteCarloView() {
    if (mcRunning || !state.impactDone) return;
    const sim = await ensureSimulations(); if (!sim) return;
    mcRunning = true; renderDrawer();
    await sleep(30);
    state.mc = runMonteCarlo({ runs: 10000, seed: sim.monteCarlo.randomSeed, distributions: eventDistributions(IMPACT_SCENARIO, sim.monteCarlo.assumedInputDistributions) });
    state.engineCheck ??= runMonteCarlo({ runs: 10000, seed: sim.monteCarlo.randomSeed, distributions: envelopeDistributions(sim) });
    renderDrawer();
    await new Promise(resolve => {
      const start = performance.now(), duration = reduceMotion ? 1 : 2800;
      const frame = now => { const t = Math.min(1, (now - start) / duration); drawMonteCarlo(t); if (t < 1) mcAnim = requestAnimationFrame(frame); else resolve(); };
      mcAnim = requestAnimationFrame(frame);
    });
    mcRunning = false; renderDrawer();
  }
  // Particles are decorative; each one's destination row is that run's actual band.
  function drawMonteCarlo(t) {
    const mc = state.mc; if (!mc || !mcCanvas.isConnected) return;
    const width = mcCanvas.clientWidth || 360, height = 170, ratio = Math.min(devicePixelRatio || 1, 2);
    if (mcCanvas.width !== Math.round(width * ratio)) { mcCanvas.width = Math.round(width * ratio); mcCanvas.height = height * ratio; }
    const ctx = mcCanvas.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const rows = mc.order, rowH = 26, top = 10, left = 108, right = width - 8, sourceX = 14, sourceY = top + rowH * 2;
    const landed = Math.floor(Math.min(1, t / .82) * mc.runs), counts = [0, 0, 0, 0];
    for (let i = 0; i < landed; i++) counts[mc.bands[i]]++;
    ctx.font = `600 10px ${MONO}`; ctx.textBaseline = "middle";
    rows.forEach((key, r) => {
      const y = top + r * rowH + rowH / 2;
      ctx.fillStyle = "rgba(160,200,255,.55)"; ctx.fillText(BAND_LABELS[key], left - 100, y);
      ctx.fillStyle = "rgba(120,170,230,.10)"; ctx.fillRect(left, y - 8, right - left, 16);
      const dots = Math.round(counts[r] / 50), per = Math.floor((right - left) / 5);
      ctx.fillStyle = BAND_COLORS[key];
      for (let d = 0; d < dots; d++) { const x = left + 2 + (d % per) * 5, yy = y - 5 + Math.floor(d / per) * 5; ctx.fillRect(x, yy, 3, 3); }
    });
    ctx.globalCompositeOperation = "lighter";
    const inFlight = 700, travel = .16;
    for (let i = Math.max(0, landed - inFlight); i < Math.min(mc.runs, landed + inFlight); i++) {
      const born = (i / mc.runs) * .82, p = (t - born) / travel; if (p < 0 || p > 1) continue;
      const r = mc.bands[i], ty = top + r * rowH + rowH / 2, e = p * p * (3 - 2 * p);
      const x = sourceX + (left - sourceX) * e, y = sourceY + (ty - sourceY) * e + Math.sin((i % 17) + p * 6) * (1 - p) * 6;
      ctx.fillStyle = BAND_COLORS[rows[r]]; ctx.globalAlpha = .55; ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    // Histogram of the real DCR distribution once streaming is mostly complete.
    if (t > .7) {
      const alpha = Math.min(1, (t - .7) / .3), hy = top + rowH * 4 + 18, hh = height - hy - 14, bins = 48, max = 2.4, hist = new Array(bins).fill(0);
      for (const v of mc.ratios) hist[Math.min(bins - 1, Math.floor(Math.min(v, max - 1e-9) / max * bins))]++;
      const peak = Math.max(...hist); ctx.globalAlpha = alpha;
      for (let b = 0; b < bins; b++) { const v = (b + .5) / bins * max, key = dcrBand(v).key, h = (hist[b] / peak) * hh; ctx.fillStyle = BAND_COLORS[key]; ctx.fillRect(left + b * (right - left) / bins, hy + hh - h, (right - left) / bins - 1, h); }
      ctx.fillStyle = "rgba(160,200,255,.6)"; ctx.fillText("DCR", left - 100, hy + hh / 2);
      for (const mark of [RISK_THRESHOLDS.monitor, RISK_THRESHOLDS.elevated, RISK_THRESHOLDS.capacityExceeded]) { const x = left + mark / max * (right - left); ctx.fillRect(x, hy - 2, 1, hh + 4); }
      ctx.fillText("0", left, height - 6); ctx.fillText("1.0", left + 1 / max * (right - left) - 6, height - 6); ctx.fillText(`${max}`, right - 16, height - 6);
      ctx.globalAlpha = 1;
    }
    mcCanvas.setAttribute("aria-label", `Monte Carlo, ${mc.runs} runs: ${mc.order.map(k => `${BAND_LABELS[k]} ${pct(mc.fractions[k])}`).join(", ")}`);
  }

  // ---------- Functional scan ----------
  const kneeCanvas = el("canvas", { class: "tw-knee", role: "img" });
  function renderFunctional() {
    const s = current, check = latestCheckpoint(s.day), pvo = predictedVsObserved(check), pe = IMPACT_SCENARIO.postEventCheck, post = state.impactDone ? postEvent() : null;
    const rows = [
      ["Knee extension", `${s.baseline.kneeExtension}°`, `${s.knee.extension}°`, `${signed(s.knee.delta)}°`],
      ["Knee range of motion", `${s.baseline.kneeRom}°`, `${s.knee.rom}°`, `${signed(s.knee.rom - s.knee.baselineRom)}°`],
      ["Tracking quality", s.baseline.trackingQuality.toFixed(2), s.knee.quality.toFixed(2), ""],
    ];
    fill(drawer, drawerHead("FUNCTIONAL SCAN · RESTRAINED KNEE EXTENSION", `Day 1 vs Day ${s.observation.recordDay}`, "SYNTHETIC"),
      kneeCanvas,
      el("table", { class: "tw-table" }, el("thead", {}, el("tr", {}, ["Metric", "Day 1", `Day ${s.observation.recordDay}`, "Δ"].map(h => el("th", {}, h)))), el("tbody", {}, rows.map(r => el("tr", {}, r.map(c => el("td", {}, c)))))),
      el("section", { class: "tw-pvo" }, el("header", {}, el("h3", {}, `Predicted vs observed · Day ${check}`), prov("DERIVED")),
        pvo.forecast ? el("p", {}, `Observed ${pvo.observed.value}° vs ${fmt(pvo.forecast.predicted)}° (95 % PI ${fmt(pvo.forecast.low)}–${fmt(pvo.forecast.high)}°) → ${pvo.verdict.toLowerCase()}.`) : el("p", {}, "Insufficient earlier observations for a trend."),
        post ? el("p", { class: "tw-warn" }, `Post-event Day 148: ${pe.kneeExtension.value}° (ROM ${pe.kneeRom.value}°) vs ${fmt(post.forecast.predicted)}° predicted (${fmt(post.forecast.low)}–${fmt(post.forecast.high)}°) → outside interval. The twin flags the deviation for human review; it does not diagnose the cause.`) : null),
      el("p", { class: "tw-note" }, "Hip angle, movement velocity, symmetry and a function score are not recorded in Elena's fixture, so they are not shown."),
      el("a", { class: "tw-primary tw-link", href: `${import.meta.env.BASE_URL}#movement-capture` }, "Open live camera twin ↗"),
      el("p", { class: "tw-note" }, "Live MediaPipe pose tracking with 3D rig mirroring runs in the Movement capture workspace. This view replays the recorded synthetic angles."));
    kneeCanvas.setAttribute("aria-label", `Knee extension diagram: Day 1 ${s.baseline.kneeExtension} degrees, now ${s.knee.extension} degrees${post ? `, post-event ${pe.kneeExtension.value} degrees` : ""}`);
  }
  // Seated knee extension diagram: thigh fixed, shank swings between (extension − ROM) and extension.
  // Interior hip-knee-ankle angle: 180° is a straight leg.
  function drawKnee(now) {
    if (!kneeCanvas.isConnected) { scene.setMusclePulse(0); return; }
    const width = kneeCanvas.clientWidth || 360, height = 170, ratio = Math.min(devicePixelRatio || 1, 2);
    if (kneeCanvas.width !== Math.round(width * ratio)) { kneeCanvas.width = Math.round(width * ratio); kneeCanvas.height = height * ratio; }
    const ctx = kneeCanvas.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const s = current, cycle = (Math.sin(now / 1300 * Math.PI) + 1) / 2, knee = { x: Math.max(width * .52, 190), y: 30 }, hip = { x: 22, y: 30 }, shank = height - 48;
    const sets = [[s.baseline.kneeExtension, s.baseline.kneeRom, "rgba(90,215,255,.95)", "DAY 1"], [s.knee.extension, s.knee.rom, "rgba(255,190,110,.95)", `DAY ${s.observation.recordDay}`]];
    if (state.impactDone) sets.push([IMPACT_SCENARIO.postEventCheck.kneeExtension.value, IMPACT_SCENARIO.postEventCheck.kneeRom.value, "rgba(255,95,80,.95)", "POST-EVENT D148"]);
    const toRad = a => (180 - a) * Math.PI / 180;
    ctx.lineCap = "round"; ctx.strokeStyle = "rgba(200,230,255,.85)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.stroke();
    sets.forEach(([ext, rom, color, label], i) => {
      const min = ext - rom, angle = min + (ext - min) * cycle, last = i === sets.length - 1;
      // Motion path: arc swept by the ankle across the recorded range.
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(i === 0 ? [4, 4] : []);
      ctx.beginPath(); ctx.arc(knee.x, knee.y, shank - i * 6, toRad(ext), toRad(min)); ctx.stroke(); ctx.setLineDash([]);
      const a = toRad(angle); ctx.globalAlpha = last ? 1 : .4; ctx.lineWidth = last ? 6 : 3;
      ctx.beginPath(); ctx.moveTo(knee.x, knee.y); ctx.lineTo(knee.x + Math.cos(a) * shank, knee.y + Math.sin(a) * shank); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = color; ctx.fillRect(12, 66 + i * 18, 8, 8);
      ctx.font = `600 10px ${MONO}`; ctx.fillText(`${label} ${ext}° · ROM ${rom}°`, 26, 74 + i * 18);
    });
    ctx.fillStyle = "#e9f6ff"; ctx.beginPath(); ctx.arc(knee.x, knee.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(160,200,255,.6)"; ctx.font = `600 10px ${MONO}`; ctx.fillText("HIP", hip.x, hip.y - 10); ctx.fillText("KNEE", knee.x - 12, knee.y - 10);
    ctx.fillText("REPLAY OF RECORDED ANGLES", width - 168, height - 10);
    scene.setMusclePulse(.1 + .4 * Math.abs(Math.cos(now / 1300 * Math.PI)));
  }

  // ---------- Physiology ----------
  const chartCanvas = el("canvas", { class: "tw-chart", role: "img" });
  function renderPhysiology() {
    const s = current, tabs = el("div", { class: "tw-subtabs", role: "group", "aria-label": "Physiology views" }, PHYSIO_TABS.map(([key, label]) =>
      el("button", { type: "button", "aria-pressed": String(state.physio === key), onclick: () => { stopDemo(); setExperience("physiology", { physio: key }); } }, label)));
    let body;
    if (state.physio === "cardio") body = [chartCanvas, el("div", { class: "tw-mini" }, card({ label: "Current HR", value: String(s.heart.bpm), unit: "bpm", kind: "SYNTHETIC", quality: s.heart.quality }), card({ label: "Baseline", value: String(s.heart.baselineBpm), unit: "bpm", kind: "SYNTHETIC" }), card({ label: "ΔHR", value: signed(s.heart.delta), unit: "bpm", kind: "DERIVED" })),
      el("p", { class: "tw-note" }, `The 3D heart beats at ${fmt(s.heart.hz, 2)} Hz = ${s.heart.bpm} bpm / 60. Input quality ${s.heart.quality.toFixed(2)} is a synthetic rPPG-style indicator. No ECG and no cardiovascular prediction model, so no model-vs-observed comparison exists.`)];
    else if (state.physio === "renal") body = [renalPathway(), el("p", { class: "tw-note" }, "Pathway from spaceflight physiology literature for context. Only the first step has an AstroBone value (the capacity modifier); the rest have no data for Elena and are not computed.")];
    else if (state.physio === "radiation") body = [chartCanvas, el("div", { class: "tw-mini" }, card({ label: "Cumulative", value: fmt(s.radiation.doseMgy, 2), unit: "mGy", kind: "SYNTHETIC" }), card({ label: "Record rate", value: "0.15", unit: "mGy/day", kind: "DERIVED" }), card({ label: "Burden", value: "Not modeled", kind: "NONE" })),
      el("p", { class: "tw-note" }, `Tracks around Elena: ${s.radiation.tracks} (= ${TRACKS_PER_MGY} × dose). Dose history is illustrative and is not effective dose, organ dose or a transport calculation.`)];
    else body = [chartCanvas, predictedText()];
    fill(drawer, drawerHead("PHYSIOLOGY", PHYSIO_TABS.find(([k]) => k === state.physio)[1], state.physio === "renal" ? "NONE" : state.physio === "predicted" ? "DERIVED" : "SYNTHETIC"), tabs, ...body);
    requestAnimationFrame(drawChart);
  }
  // After the impact branch runs, the comparison target is the authored post-event check.
  const pvoTarget = () => (state.impactDone && current.day >= IMPACT_SCENARIO.day.value ? IMPACT_SCENARIO.postEventCheck.day.value : latestCheckpoint(current.day));
  function predictedText() {
    const check = pvoTarget(), pvo = predictedVsObserved(check, state.impactDone ? postEventPoint() : []);
    return el("p", { class: "tw-note" }, pvo.forecast ? `Day ${check}: observed ${pvo.observed.value}° vs predicted ${fmt(pvo.forecast.predicted)}° (95 % PI ${fmt(pvo.forecast.low)}–${fmt(pvo.forecast.high)}°). Prediction = ordinary least-squares trend on earlier usable observations only; a statistical extrapolation, not a physiological model.` : "Needs at least three earlier observations.");
  }
  const postEventPoint = () => { const pe = IMPACT_SCENARIO.postEventCheck; return [{ day: pe.day.value, value: pe.kneeExtension.value, quality: pe.trackingQuality.value, source: "SYNTHETIC DEMO" }]; };
  function renalPathway() {
    const steps = [["Skeletal unloading", `Model −${fmt(current.bone.lossFraction * 100)} % capacity`, "MODEL"], ["Mineral mobilization", "Not modeled", "NONE"], ["Urinary calcium trend", "No data", "NONE"], ["Renal-stone-risk proxy", "Not computed", "NONE"]];
    return el("ol", { class: "tw-pathway" }, steps.map(([name, value, kind]) => el("li", { "data-kind": kind.toLowerCase() }, el("b", {}, name), el("span", {}, value), prov(kind))));
  }
  function drawChart() {
    if (!chartCanvas.isConnected) return;
    const width = chartCanvas.clientWidth || 360, height = 190, ratio = Math.min(devicePixelRatio || 1, 2);
    chartCanvas.width = Math.round(width * ratio); chartCanvas.height = height * ratio;
    const ctx = chartCanvas.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const pad = { l: 38, r: 10, t: 12, b: 24 }, x = d => pad.l + (d - 1) / (MISSION_LENGTH - 1) * (width - pad.l - pad.r);
    const axis = (min, max) => v => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
    ctx.font = `10px ${MONO}`; ctx.strokeStyle = "rgba(120,170,230,.18)"; ctx.fillStyle = "rgba(160,200,255,.6)";
    const grid = (min, max, step, y, unit) => { for (let v = min; v <= max; v += step) { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(width - pad.r, y(v)); ctx.stroke(); ctx.fillText(`${v}${unit}`, 2, y(v) + 3); } };
    ctx.fillText("DAY", width - 30, height - 6); [1, 60, 120, 180, 240].forEach(d => ctx.fillText(String(d), x(d) - 6, height - 8));
    ctx.fillStyle = "rgba(255,200,120,.08)"; ctx.fillRect(x(CURRENT_DAY), pad.t, width - pad.r - x(CURRENT_DAY), height - pad.t - pad.b);
    const nowX = x(current.day); ctx.strokeStyle = "rgba(127,227,255,.6)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(nowX, pad.t); ctx.lineTo(nowX, height - pad.b); ctx.stroke(); ctx.setLineDash([]);
    const dots = (points, y, color) => { ctx.fillStyle = color; points.forEach(p => { ctx.beginPath(); ctx.arc(x(p.day), y(p.value), 3.5, 0, Math.PI * 2); ctx.fill(); }); };
    const line = (points, y, color, width_ = 1.6) => { ctx.strokeStyle = color; ctx.lineWidth = width_; ctx.beginPath(); points.forEach((p, i) => (i ? ctx.lineTo(x(p.day), y(p.value)) : ctx.moveTo(x(p.day), y(p.value)))); ctx.stroke(); ctx.lineWidth = 1; };
    const obs = ELENA.observations.filter(r => r.day.value <= current.day);
    if (state.physio === "cardio") {
      const y = axis(60, 80); ctx.strokeStyle = "rgba(120,170,230,.18)"; ctx.fillStyle = "rgba(160,200,255,.6)"; grid(60, 80, 5, y, "");
      ctx.strokeStyle = "rgba(127,227,255,.5)"; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(pad.l, y(64)); ctx.lineTo(width - pad.r, y(64)); ctx.stroke(); ctx.setLineDash([]);
      const pts = obs.map(r => ({ day: r.day.value, value: r.heartRate.value })); line(pts, y, "rgba(255,90,130,.8)"); dots(pts, y, "#ff5a86");
      chartCanvas.setAttribute("aria-label", `Heart rate by day: ${pts.map(p => `Day ${p.day} ${p.value} bpm`).join(", ")}`);
    } else if (state.physio === "radiation") {
      const y = axis(0, 50); grid(0, 50, 10, y, "");
      ctx.strokeStyle = "rgba(200,184,255,.9)"; ctx.beginPath(); obs.forEach((r, i) => { const px = x(r.day.value), py = y(r.absorbedDose.value); if (i) { ctx.lineTo(px, y(obs[i - 1].absorbedDose.value)); ctx.lineTo(px, py); } else ctx.moveTo(px, py); }); ctx.lineTo(nowX, y(obs.at(-1).absorbedDose.value)); ctx.stroke();
      if (current.radiation.eventIncluded) { ctx.fillStyle = "#ffc46b"; ctx.fillRect(x(IMPACT_SCENARIO.day.value) - 1, y(current.radiation.doseMgy), 3, y(current.radiation.recordedDoseMgy) - y(current.radiation.doseMgy)); }
      chartCanvas.setAttribute("aria-label", `Cumulative synthetic dose: ${obs.map(r => `Day ${r.day.value} ${r.absorbedDose.value} mGy`).join(", ")}`);
    } else if (state.physio === "predicted") {
      const y = axis(130, 175); grid(130, 175, 10, y, "°");
      const target = pvoTarget(), extra = state.impactDone ? postEventPoint() : [], series = kneeSeries(extra).filter(p => p.day <= Math.max(current.day, target));
      const pvo = predictedVsObserved(target, extra);
      if (pvo.forecast) {
        const f = pvo.forecast, from = f.fitDays[0], to = Math.min(MISSION_LENGTH, target + 30), band = [];
        for (let d = from; d <= to; d += 3) band.push(f.at(d));
        ctx.fillStyle = "rgba(127,227,255,.12)"; ctx.beginPath(); band.forEach((p, i) => (i ? ctx.lineTo(x(p.day), y(p.high)) : ctx.moveTo(x(p.day), y(p.high)))); [...band].reverse().forEach(p => ctx.lineTo(x(p.day), y(p.low))); ctx.closePath(); ctx.fill();
        line(band.map(p => ({ day: p.day, value: p.predicted })), y, "rgba(127,227,255,.95)", 2.2); ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(160,200,255,.75)"; ctx.fillText("PREDICTED (trend)", x(from) + 4, y(f.at(from).high) - 6);
      }
      dots(series.filter(p => p.day < target || !pvo.forecast), y, "#ffd27a");
      const obsPoint = series.find(p => p.day === target); if (obsPoint) dots([obsPoint], y, pvo.inside === false ? "#ff5a4f" : "#ffd27a");
      ctx.fillStyle = "rgba(255,210,122,.85)"; ctx.fillText("● OBSERVED", width - 92, pad.t + 10);
      chartCanvas.setAttribute("aria-label", `Knee extension observed vs trend prediction at Day ${target}`);
    }
  }

  // ---------- Evidence ----------
  function renderEvidence() {
    const sources = research ? ["cardiovascular", "radiation", "bone"].map(key => research[key]).filter(Boolean) : [];
    if (!research) loadResearch();
    fill(drawer, drawerHead("EVIDENCE", "What every visual is built from"),
      el("ul", { class: "tw-truth" }, Object.entries(PROVENANCE).map(([kind, text]) => el("li", {}, prov(kind), el("span", {}, text)))),
      section("Synthetic astronaut", ["Elena Torres and every reading: src/elenaMissionScenario.js (schema astrobone-elena-synthetic-v1).", ELENA.boundary, `Impact branch: src/twinImpact.js. ${IMPACT_SCENARIO.boundary}`]),
      section("Models in this view", [
        "Bone tint: capacity modifier months × 1.25 %/month (parameter B-05, evidence low), the same function calculateRisk() applies.",
        "Impact: Level-A demand/capacity model (src/riskModel.js). Event inputs reproduce the stored reference scenario; at 6 months the browser result equals the stored DCR 0.696.",
        "Stress map: Euler–Bernoulli relative bending stress on the atlas tibia (src/twinImpact.js). Shape only; Mechanics V2 remains inactive.",
        "Monte Carlo: 10,000 seeded calculateRisk() runs. Engine check against the stored 5,000-run reference is shown in Impact Lab.",
        "Predicted vs observed: ordinary least-squares trend with a 95 % prediction interval, fitted only to earlier observations.",
      ]),
      el("section", { class: "tw-ev" }, el("h3", {}, "NASA research (external populations)"),
        sources.length ? el("ul", {}, sources.map(src => el("li", {}, el("a", { href: src.url, target: "_blank", rel: "noopener noreferrer" }, `${src.accession} · ${src.title}`), el("small", {}, `${src.population}. Never Elena's data.`))))
          : el("p", { class: "tw-note" }, research === false ? "Prepared research summaries unavailable." : "Loading prepared summaries…")),
      section("Self-check instruments", [
        "Reaction test: PVT-B, 3 minutes, 2–5 s intervals, 355 ms lapse threshold (Basner, Mollicone & Dinges, Acta Astronautica 2011). Browser timing adds about one display frame.",
        "Fatigue: Samn–Perelli 7-point checklist (USAF School of Aerospace Medicine, 1982). Mood and stress: single 0–10 self-ratings.",
        "Movement: the same MediaPipe pose model, filter and knee-extension definition as the Movement capture workspace; quality ≥ 0.70 and ≥ 12 samples before any comparison.",
        "Review trigger: outside 2× the person's own spread or a minimum change, after 3 usable checks of the same protocol. Engineering default, not a clinical threshold.",
      ]),
      section("Anatomy", ["Z-Anatomy / BodyParts3D atlas, CC BY-SA 4.0 (public/models/anatomy/SOURCE-LICENSE.txt). Reference geometry, not Elena's anatomy.", "Cardiovascular groups are vessels only: kidney and lung tissue are not in the atlas."]),
      section("Not used here", ["No LLM or retrieval model runs in this view; citations are a fixed local index.", "No live sensors: the live camera twin is in the Movement capture workspace.", "No clinical validation. Human medical review is required for any decision."]),
      el("a", { class: "tw-secondary tw-link", href: `${import.meta.env.BASE_URL}#mission-demo` }, "Open Mission Intelligence review ↗"));
  }
  const section = (title, items) => el("section", { class: "tw-ev" }, el("h3", {}, title), el("ul", {}, items.map(t => el("li", {}, t))));
  async function loadResearch() {
    if (research !== null) return; research = undefined;
    try { research = await (await fetch(`${import.meta.env.BASE_URL}data/mission-research.json`)).json(); } catch { research = false; }
    if (state.experience === "evidence") renderDrawer();
  }

  // ---------- Overlays updated every frame ----------
  const anchorLabels = new Map();
  function anchorLabel(key, text, cls) {
    if (!anchorLabels.has(key)) { const node = el("span", { class: `tw-anchor ${cls ?? ""}` }, text); labels.append(node); anchorLabels.set(key, node); }
    const node = anchorLabels.get(key); node.textContent = text; return node;
  }
  let lastSvg = "";
  function updateOverlays(project) {
    const lines = [];
    if (state.experience === "mission" && !nodes.hidden) {
      nodes.querySelectorAll(".tw-node").forEach(node => {
        const p = project(node.dataset.anchor); if (!p || !p.visible) return;
        const r = node.getBoundingClientRect(); if (!r.width) return;
        const left = node.closest(".tw-left"), x1 = left ? r.right : r.left, y1 = r.top + r.height / 2;
        lines.push(`<path d="M${x1},${y1} C${(x1 + p.x) / 2},${y1} ${(x1 + p.x) / 2},${p.y} ${p.x},${p.y}" /><circle cx="${p.x}" cy="${p.y}" r="3" />`);
      });
    }
    const markup = lines.join(""); if (markup !== lastSvg) { svg.innerHTML = markup; lastSvg = markup; }
    const show = new Set();
    const place = (key, anchor, text, cls) => { const p = project(anchor); if (!p?.visible) return; const node = anchorLabel(key, text, cls); node.style.transform = `translate(${p.x}px, ${p.y}px)`; show.add(key); };
    if (state.experience === "impact" && state.impactDone) { place("peak", "peak", "PEAK MODELED STRESS REGION", "tw-anchor-hot"); place("impact", "impact", "IMPACT POINT · RECONSTRUCTED", "tw-anchor-impact"); }
    if (state.compare) { place("ghost", "ghostHead", "DAY 1 · MODEL BASELINE", ""); place("now", "head", `DAY ${current.day} · −${fmt(current.bone.lossFraction * 100)} % MODEL`, "tw-anchor-warm"); }
    for (const [key, node] of anchorLabels) node.hidden = !show.has(key);
    if (state.experience === "functional" && performance.now() - lastKnee > 33) { lastKnee = performance.now(); drawKnee(lastKnee); }
    else if (state.experience !== "functional") scene.setMusclePulse(0);
  }
  let lastKnee = 0;

  function drawSpark() {
    const width = spark.clientWidth, height = spark.clientHeight; if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2); spark.width = width * ratio; spark.height = height * ratio;
    const ctx = spark.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const x = d => (d - 1) / (MISSION_LENGTH - 1) * width;
    // Model curve (continuous) and recorded knee extension (steps) behind the slider.
    ctx.strokeStyle = "rgba(255,190,110,.55)"; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let d = 1; d <= MISSION_LENGTH; d += 2) { const y = 4 + boneCapacityChange(d).lossFraction / BONE_TINT_SCALE.max * (height - 8); d === 1 ? ctx.moveTo(x(d), y) : ctx.lineTo(x(d), y); } ctx.stroke();
    ctx.fillStyle = "rgba(127,227,255,.75)";
    ELENA.observations.forEach(r => { const y = height - 4 - (r.kneeExtension.value - 140) / 30 * (height - 8); ctx.fillRect(x(r.day.value) - 1.5, y - 1.5, 3, 3); });
    ctx.fillStyle = "rgba(127,227,255,.10)"; ctx.fillRect(0, 0, x(current.day), height);
  }
  window.addEventListener("resize", () => { drawSpark(); if (state.experience === "physiology") drawChart(); });

  // ---------- Captions, intro, guided demo ----------
  let captionTimer = null;
  function showCaption(text, ms = 3000) {
    clearTimeout(captionTimer); caption.hidden = false; caption.textContent = text; caption.classList.remove("tw-in"); void caption.offsetWidth; caption.classList.add("tw-in");
    if (ms) captionTimer = setTimeout(() => { caption.hidden = true; }, ms);
  }

  let introDone = false;
  function finishIntro() {
    if (introDone) return; introDone = true;
    intro.classList.add("tw-out"); setTimeout(() => intro.remove(), 500);
    document.body.classList.remove("tw-booting"); try { sessionStorage.setItem("astrobone-twin-intro", "1"); } catch { /* storage unavailable */ }
  }
  intro.addEventListener("click", event => { if (event.target === intro) finishIntro(); });
  window.addEventListener("keydown", event => { if (!introDone && (event.key === "Escape" || event.key === "Enter" || event.key === " ")) finishIntro(); });

  async function runDemo() {
    stopPlay(); const token = {}; state.demo = token; startButton.textContent = "Stop simulation"; root.dataset.demo = "true";
    const alive = () => state.demo === token;
    const step = async (fn, caption_, wait) => { if (!alive()) throw new Error("stopped"); await fn?.(); if (caption_) showCaption(caption_, 0); if (wait) await sleep(reduceMotion ? Math.min(wait, 1500) : wait); if (!alive()) throw new Error("stopped"); };
    try {
      state.compare = false; scene.setCompare(false); scene.resetImpact(); state.impactDone = false; state.mc = null;
      await step(() => { setExperience("mission"); setDay(1, { travel: true }); }, "DAY 1 · BASELINE SCAN · synthetic personal baseline locked", 3400);
      await step(async () => { setExperience("twin", { system: "skeleton" }); await animateDay(30); }, `DAY 30 · MODEL-ESTIMATED SKELETAL CHANGE −${fmt(twinState(30).bone.lossFraction * 100)} % · weight-bearing bones`, 3600);
      await step(async () => { setExperience("mission"); await animateDay(60); }, "DAY 60 · MULTISYSTEM · knee extension −2°, heart rate +2 bpm, 9 mGy (synthetic records)", 4000);
      await step(async () => { setExperience("twin", { system: "cardiovascular" }); await animateDay(90); }, "DAY 90 · HEART RATE 69 bpm (+5) · the heart beats at the recorded rate", 4200);
      await step(async () => { setExperience("functional"); await animateDay(120); }, "DAY 120 · FUNCTIONAL ASSESSMENT · knee extension 157° (−8° vs Day 1)", 4200);
      const pvo = predictedVsObserved(CURRENT_DAY);
      await step(async () => { setExperience("physiology", { physio: "predicted" }); await animateDay(CURRENT_DAY); }, `DAY ${CURRENT_DAY} · PREDICTED ${fmt(pvo.forecast.predicted)}° vs OBSERVED ${pvo.observed.value}° · within the 95 % interval`, 5000);
      await step(() => { selfCheck.setProfile("elena"); selfCheck.reset(); setExperience("selfcheck"); }, "DAILY SELF-CHECK · Elena gathers her own health indicators", 3200);
      await step(() => selfCheck.go(1), "MOVEMENT · seated knee extension on camera", 1400);
      await step(() => selfCheck.demoCapture("poor"), "POOR FRAMING · tracking 0.35 · comparison withheld, repeat requested", 4400);
      await step(() => selfCheck.demoCapture("usable"), "REPEAT · usable capture · knee extension 151°", 3400);
      await step(() => { selfCheck.go(2); selfCheck.applyDemoPvt(); }, "REACTION TEST (PVT-B) · 9 attention lapses · her usual is 2–4", 3800);
      await step(() => selfCheck.go(3), "SLEEP & MOOD · 5.2 h sleep · fatigue 4/7 (synthetic answers)", 3200);
      await step(() => selfCheck.go(4), "BODY · no new immune symptoms · resting heart rate 76 bpm", 3000);
      await step(() => selfCheck.go(5), "EVALUATE · bone & muscle, cardiovascular and behavioral health are outside her usual range", 5400);
      await step(() => selfCheck.saveCheck(), "ACT · re-check in 24 h and log for medical review at the next communication window", 4400);
      await step(async () => { setExperience("impact"); }, "UNEXPECTED EVENT · reconstructed from authored inputs", 1600);
      await step(() => runImpact(), null, 900);
      await step(() => runMonteCarloView(), null, 0);
      const mc = state.mc;
      await step(null, mc ? `MONTE CARLO · 10,000 RUNS · capacity exceeded in ${pct(mc.fractions.capacityExceeded)} of simulated runs · not a clinical probability` : "MONTE CARLO unavailable · simulation reference did not load", 5200);
      await step(() => setExperience("functional"), "POST-EVENT CHECK · Day 148 knee extension 141° · outside the prediction interval → human medical review", 5600);
      await step(() => { caption.hidden = true; closing.hidden = false; closing.classList.add("tw-in"); }, null, 4600);
      closing.hidden = true; closing.classList.remove("tw-in"); setExperience("mission");
    } catch { /* stopped by the user */ }
    if (alive()) stopDemo();
  }
  function stopDemo() {
    if (!state.demo) return; state.demo = null; startButton.textContent = "Start mission simulation"; delete root.dataset.demo;
    caption.hidden = true; closing.hidden = true; closing.classList.remove("tw-in"); cancelAnimationFrame(dayAnimation);
  }
  window.addEventListener("keydown", event => { if (event.key === "Escape" && state.demo) stopDemo(); });

  // ---------- Boot ----------
  const skipIntro = (() => { try { return sessionStorage.getItem("astrobone-twin-intro") === "1"; } catch { return false; } })() || reduceMotion;
  if (skipIntro) { introDone = true; intro.remove(); }
  const linked = experienceFromHash(location.hash);
  if (linked) state.experience = linked;
  current = twinState(state.day); render();
  scene.load().then(async () => {
    loading.classList.add("tw-done"); setTimeout(() => loading.remove(), 600);
    scene.setState(current, { bonesSolidity: current.bone.evidence.solidity }); scene.setSystem(sceneSystem(), { focusTarget: linked ? sceneFocus(sceneSystem()) : "body", animate: false });
    const positions = scene.tibiaPositions();
    if (positions && scene.impactLocal) {
      const result = bendingStressField(positions, { impactPoint: scene.impactLocal.toArray(), loadDirection: scene.impactOutward.toArray() });
      stressField = result; scene.setStressField(result.field, result.peakIndex); state.stressReady = true;
    }
    ensureSimulations();
    if (!skipIntro) {
      intro.classList.add("tw-play");
      await scene.intro(); await sleep(400); finishIntro();
    } else { document.body.classList.remove("tw-booting"); scene.intro(); }
    render();
  }).catch(error => {
    loading.classList.add("tw-error"); loading.querySelector("span").textContent = "3D anatomy unavailable. Values, timeline and evidence remain usable.";
    canvas.dataset.error = error.message; finishIntro(); console.error(error);
  });
  return { scene, state, setDay, setExperience, selfCheck, get stressField() { return stressField; } };
}
