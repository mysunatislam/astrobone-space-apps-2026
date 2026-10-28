import {
  PVT_B, PVT_PROTOCOL, SAMN_PERELLI, RED_FLAGS, IMMUNE_SYMPTOMS, INDICATORS, newCheck, summarizePvt, evaluateSelfCheck, createSelfCheckStore,
  safetyLimit, applyVitals, vitalsFromValues, TEMP_SITES, GLUCOSE_MG_PER_MMOL, SAFETY_LIMIT_SOURCES, STATUS_RANK,
} from "./selfCheck.js";
import { ELENA_HISTORY, ELENA_POOR_CAPTURE, ELENA_USABLE_CAPTURE, ELENA_PVT, ELENA_SELF_CHECK_BOUNDARY, ELENA_CHECK_DAYS, elenaDay147 } from "./elenaSelfCheck.js";
import { ENVIRONMENTS, DEFAULT_ENVIRONMENT, environmentFor, escalationPlan } from "./missionEnvironment.js";
import { guidanceFor, GUIDANCE_BOUNDARY } from "./countermeasures.js";
import { hazardsForDomain } from "./hazards.js";
import { ROUTINE, routineStatus, nextDue, dayNumber, newBadges } from "./routine.js";
import { createSelfCheckCamera } from "./selfCheckCamera.js";
import { createCameraPulse, CAMERA_PULSE, RESTING_CAMERA_PROTOCOL } from "./cameraPulse.js";
import { cameraViewFor } from "./functionalAssessment.js";
import { sparklineSvg } from "./trendSpark.js";
import { surgeonReport, byteSize } from "./surgeonReport.js";
import { STATUS_MARKS, indicatorHistory, historyChartSvg, legendFor, chartableKeys, pointLabel } from "./historyChart.js";
import { HOLD, REFERENCE_TYPES, summarizeHold, agreement, calibratedFloors, pairsToCsv, createAngleCheckStore } from "./angleCheck.js";
import { ELENA } from "./elenaMissionScenario.js";
import { loadNasaEvidence, nasaWatchPlan } from "./nasaWatch.js";
import { loadCrewBlood, replayCrew, crewReplayCard } from "./crewReplay.js";

const STEPS = [["safety", "Safety"], ["movement", "Movement"], ["reaction", "Reaction"], ["mind", "Sleep & mood"], ["body", "Body"], ["result", "Result & action"]];
const STATUS = {
  urgent: ["URGENT", "Contact now"], attention: ["CONTACT TODAY", "Outside a safety limit"], changed: ["REVIEW", "Outside your usual range"], repeat: ["REPEAT", "Quality check failed · not compared"],
  baseline: ["BASELINE", "Building your baseline"], stable: ["STABLE", "Within your usual range"], notChecked: ["NOT CHECKED", "No data this check"],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RULE_STATUS = { active: "On", scheduled: "Scheduled", "on-return": "On return", routine: "Routine", "no-alarm": "No alarm" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value; else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child?.nodeType ? child : String(child));
  return node;
}
const fmt = (v, d = 1) => (Number.isFinite(v) ? Number(v).toFixed(d) : "--");
// Which knee the result describes: both (the worse one is compared) or the one leg a side-on camera saw.
const kneeView = cap => !cap.view ? "" : cap.view === "bilateral"
  ? ` · both knees seen, comparing the ${cap.worseSide} (left ${fmt(cap.sides.left.extension)}°, right ${fmt(cap.sides.right.extension)}°)`
  : ` · ${cap.view} knee only (side-on view); compared only with ${cap.view}-knee checks`;
// The knee model behind the numbers: the validated hybrid, or the pose model's 3D angle alone.
const kneeMethod = cap => cap.angleMethod === "hybrid" ? ` · hybrid knee model (${fmt(100 * (cap.hybridShare ?? 0), 0)} % learned, rest fixed rule)` : "";
// Live position cue: the same position every day keeps the camera's error the same.
const VIEW_CUE = { front: "facing camera", side: "side-on", oblique: "turned partway: face the camera or turn fully side-on" };

export function createSelfCheckPanel({ onEvaluate = () => {}, onStep = () => {}, onTimedTest = () => {} } = {}) {
  const store = createSelfCheckStore();
  const state = { profile: "elena", environment: DEFAULT_ENVIRONMENT.elena, persist: false, step: 0, check: null, capture: null, pvt: null, evaluation: null, captures: 0, followUps: [], saved: false, failed: {}, earned: [], chartKey: null, report: false };
  const element = el("div", { class: "sc" });
  const video = el("video", { class: "sc-video", playsinline: true, muted: true, "aria-label": "Camera preview" });
  const overlay = el("canvas", { class: "sc-overlay", "aria-hidden": "true" });
  const camStatus = el("small", { class: "sc-cam-status", role: "status" }, "Camera off");
  let camera = null, liveAngle = el("b", {}, "--");
  // Resting pulse from the face: ME-rPPG-led hybrid with POS (src/cameraPulse.js).
  const pulseVideo = el("video", { class: "sc-video", playsinline: true, muted: true, "aria-label": "Face camera preview" });
  const pulseStatus = el("small", { class: "sc-cam-status", role: "status" }, "Camera off");
  const pulse = { engine: null, measuring: false, result: null, progress: null };
  const angleStore = createAngleCheckStore();
  const check = { open: false, participant: "P1", side: "left", referenceType: REFERENCE_TYPES[0], reference: null, hold: null, holding: false, pairs: [] };
  try { state.persist = localStorage.getItem("astrobone-self-check-consent") === "1"; } catch { /* storage unavailable */ }
  check.pairs = angleStore.load(state.persist);
  // NASA life-science data sets what this check asks for and when (src/nasaWatch.js).
  let evidence = null, evidenceError = null;
  loadNasaEvidence(import.meta.env.BASE_URL).then(data => { evidence = data; render(); }).catch(error => { evidenceError = error.message; render(); });
  // The rule itself, replayed on the four Inspiration4 crew members' real blood (src/crewReplay.js).
  let crew = null;
  loadCrewBlood(import.meta.env.BASE_URL).then(data => { crew = replayCrew(data, { permutations: 500 }); render(); }).catch(() => { /* card is optional */ });
  // Elena reaches Mars (back in gravity) at the end of the transit; "You" has no mission timing.
  const missionContext = () => (state.profile === "elena" ? { missionDay: 147, returnDay: ELENA.identity.duration.value } : {});
  const plan = () => (evidence ? nasaWatchPlan(evidence, missionContext()) : null);
  const ruleFor = id => plan()?.find(rule => rule.id === id) ?? null;
  const why = (id, text) => { const rule = ruleFor(id); return rule ? el("p", { class: "sc-why" }, el("b", {}, rule.sources[0]), ` ${text ?? rule.rule}`) : null; };
  function planCard() {
    const rules = plan();
    if (!rules) return evidenceError ? el("p", { class: "sc-note" }, `NASA evidence unavailable (${evidenceError}); checks run in their standard order.`) : null;
    return el("section", { class: "sc-plan", "aria-label": "Today's checks, set by NASA data" },
      el("header", {}, el("b", {}, "Today's checks · set by NASA data"), el("small", {}, "Priority and timing only. Your own baseline sets every threshold.")),
      rules.map(rule => el("div", { class: `sc-rule sc-rule-${rule.status}` },
        el("div", { class: "sc-rule-head" }, el("strong", {}, rule.check), el("span", { class: "sc-pill" }, RULE_STATUS[rule.status] ?? rule.status)),
        el("p", { class: "sc-rule-text" }, rule.rule),
        rule.note ? el("p", { class: "sc-rule-when" }, rule.note) : null,
        el("p", { class: "sc-rule-finding" }, rule.finding),
        el("div", { class: "sc-src" }, rule.sources.map(source => el("span", {}, source))))),
      crewCard());
  }
  function crewCard() {
    if (!crew) return null;
    const card = crewReplayCard(crew), wide = card.values.crewWide[0];
    // One line per crew member for the clearest crew-wide signal: pre-flight draws, then each return visit.
    const spark = wide ? crew.crew.map(c => {
      const a = c.analytes.find(x => x.key === wide.key), r = a.results.find(x => x.visit === wide.visit);
      const node = el("div", { class: "sc-crew-row" }, el("span", {}, c.id), el("span", { class: "sc-crew-v" }, `${fmt(r.value)} vs ${fmt(r.preMean)} ${a.unit}`));
      node.insertAdjacentHTML("beforeend", sparklineSvg({ series: a.points.slice(0, a.points.findIndex(([v]) => v === wide.visit)).map(([, v]) => v), value: r.value, start: r.preMean, changed: r.status === "changed", label: `${c.id} ${a.label} at ${wide.visit}` }));
      return node;
    }) : [];
    return el("details", { class: "sc-rule sc-rule-tested" },
      el("summary", { class: "sc-rule-head" }, el("strong", {}, card.check), el("span", { class: "sc-pill" }, "Tested")),
      el("p", { class: "sc-rule-text" }, card.rule),
      el("p", { class: "sc-rule-finding" }, card.finding),
      wide ? el("div", { class: "sc-crew" }, el("small", {}, `${wide.label} at ${wide.visit}, each crew member against their own pre-flight mean`), spark) : null,
      el("div", { class: "sc-src" }, card.sources.map(source => el("span", {}, source))));
  }

  const history = () => (state.profile === "elena" ? [...ELENA_HISTORY, ...(store.load("DEMO-ELENA", false))] : store.load("you", state.persist));
  function reset() {
    stopCamera(); stopPvt(true);
    state.step = 0; state.capture = null; state.pvt = null; state.evaluation = null; state.captures = 0; state.saved = false; state.failed = {}; state.earned = []; state.report = false;
    if (state.profile === "elena") {
      state.check = elenaDay147(); state.check.id = `DEMO-ELENA-day-147-${Date.now()}`;
      // Movement and reaction results arrive through the demo capture buttons.
      for (const key of ["kneeExtension", "kneeRom", "pvtSpeed", "pvtLapses"]) delete state.check.values[key];
      // Elena's authored answers: no red flags and no new symptoms on Day 147.
      state.check.redFlags = {}; state.check.symptoms = {};
      state.check.dosimeter = ELENA.observations.find(r => r.day.value === 147).absorbedDose.value;
      state.check.vitals = { ...vitalsFromValues(state.check.values, state.check.protocols), source: "SYNTHETIC DEMO" };
    } else { state.check = newCheck("you"); state.check.vitals = {}; }
    render(); onStep(STEPS[0][0]);
  }
  function switchProfile(profile) { if (state.profile === profile) return; state.profile = profile; state.environment = DEFAULT_ENVIRONMENT[profile]; reset(); }
  const environment = () => environmentFor(state.environment);
  function go(step) { state.step = Math.max(0, Math.min(STEPS.length - 1, step)); if (STEPS[state.step][0] !== "movement") stopCamera(); if (STEPS[state.step][0] !== "body") stopPulse(); if (STEPS[state.step][0] === "result") evaluate(); render(); onStep(STEPS[state.step][0]); }

  function evaluate() {
    state.evaluation = evaluateSelfCheck(state.check, history(), { floors: state.profile === "elena" ? {} : calibratedFloors(check.pairs, INDICATORS.kneeExtension.floor), environment: environment() });
    onEvaluate(state.evaluation, state.profile);
  }

  // ---------- Movement ----------
  function applyCapture(capture, source) {
    state.capture = { ...capture, source }; state.captures++;
    const usable = capture.status !== "insufficient" && capture.trackingQuality >= 0.7 && capture.sampleCount >= 12 && Number.isFinite(capture.kneeExtension);
    noteRepeat("movement", usable);
    Object.assign(state.check.values, { kneeExtension: capture.kneeExtension, kneeRom: capture.kneeRom });
    Object.assign(state.check.quality, { kneeExtension: usable, kneeRom: usable });
    const protocol = state.profile === "elena" ? "restrained-knee-extension-demo-v1" : capture.protocol;
    Object.assign(state.check.protocols, { kneeExtension: protocol, kneeRom: protocol });
    state.check.sources.movement = source; render();
  }
  async function demoCapture(kind) {
    state.capture = { capturing: true }; render(); await sleep(1400);
    applyCapture({ ...(kind === "poor" ? ELENA_POOR_CAPTURE : ELENA_USABLE_CAPTURE), status: kind === "poor" ? "insufficient" : "complete" }, "SYNTHETIC DEMO");
  }
  async function startCamera() {
    camera ??= createSelfCheckCamera({ video, overlay, onStatus: text => { camStatus.textContent = text; }, onFrame: frame => {
      // Show only knees the camera can see; a far knee in a side-on view is guesswork.
      const seen = frame?.angles ? ["left", "right"].filter(side => (frame.sideUsable ? frame.sideUsable[side] : true) && Number.isFinite(frame.angles[side]?.knee)) : [];
      const view = cameraViewFor(frame?.bodyYawDeg), shown = view === "side" && frame.nearSide ? seen.filter(side => side === frame.nearSide) : seen;
      liveAngle.textContent = view === "oblique" ? VIEW_CUE.oblique
        : shown.length ? `${shown.map(side => `${side[0].toUpperCase()} ${Math.round(frame.kneeHybrid?.[side]?.angle ?? frame.angles[side].knee)}°`).join(" · ")}${view ? ` · ${VIEW_CUE[view]}` : ""}` : "--";
    } });
    try { await camera.start(); } catch (error) { camStatus.textContent = `Camera unavailable: ${error.message}`; }
    render();
  }
  async function recordCamera() {
    if (!camera?.running) return;
    state.capture = { capturing: true }; render();
    const result = await camera.record(10000);
    applyCapture(result, "CAMERA · this device");
  }
  function stopCamera() { camera?.stop(); }

  // ---------- Resting pulse from the camera ----------
  async function measurePulse() {
    if (pulse.measuring) return;
    pulse.engine ??= createCameraPulse({ video: pulseVideo, onStatus: text => { pulseStatus.textContent = text; } });
    // The 3D scene pauses while measuring, as for the reaction test: on a phone it competes with the
    // pulse models for the processor, and fewer frames a second make a noisier pulse wave.
    pulse.measuring = true; pulse.result = null; onTimedTest(true); render();
    try {
      await pulse.engine.start();
      pulseStatus.textContent = `Hold still, face the camera, steady light · ${CAMERA_PULSE.seconds} s`;
      const result = await pulse.engine.measure(CAMERA_PULSE.seconds, progress => { pulse.progress = progress; pulseStatus.textContent = `${Math.floor(progress.elapsed)} / ${progress.seconds} s${progress.live?.bpm ? ` · about ${progress.live.bpm} bpm` : ""}${progress.faceShare < 0.8 ? " · face not found" : ""}`; });
      pulse.result = result;
      if (result.status === "estimated") {
        const c = state.check;
        c.values.restingHr = result.bpm; c.protocols.restingHr = RESTING_CAMERA_PROTOCOL; c.sources.restingHr = "Camera (rPPG hybrid)";
        c.quality = { ...(c.quality || {}), restingHr: true };
      }
    } catch (error) { pulse.result = { status: "insufficient", reason: `Camera unavailable: ${error.message}` }; }
    finally { pulse.engine?.stop(); pulse.measuring = false; onTimedTest(false); render(); }
  }
  function stopPulse() { pulse.engine?.stop(); pulse.measuring = false; onTimedTest(false); }

  // ---------- Accuracy check (camera vs goniometer) ----------
  async function holdAngle() {
    if (!camera?.running || check.holding) return;
    check.holding = true; check.hold = null; render();
    try { check.hold = summarizeHold(await camera.hold(HOLD.durationMs), check.side); }
    catch (error) { check.hold = { usable: false, reason: error.message }; }
    check.holding = false; render();
  }
  function savePair() {
    if (!check.hold?.usable || !Number.isFinite(check.reference)) return;
    check.pairs = [...check.pairs, { participant: check.participant.trim() || "P?", side: check.side, referenceType: check.referenceType, referenceFlexion: check.reference,
      cameraFlexion: check.hold.flexion, holdSd: check.hold.sd, samples: check.hold.samples, cameraView: check.hold.cameraView ?? null, bodyYawDeg: check.hold.bodyYawDeg ?? null, at: new Date().toISOString() }];
    angleStore.save(check.pairs, state.persist);
    check.hold = null; check.reference = null; render();
  }
  function exportPairs() {
    const url = URL.createObjectURL(new Blob([pairsToCsv(check.pairs)], { type: "text/csv" }));
    const a = el("a", { href: url, download: `AstroBone-angle-check-${Date.now()}.csv` }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function accuracyCheck() {
    const camOn = camera?.running, h = check.hold, a = agreement(check.pairs);
    const details = el("details", { class: "sc-validate", open: check.open || undefined, ontoggle: e => { check.open = e.target.open; } },
      el("summary", {}, `Accuracy check · camera vs goniometer (${check.pairs.length} pairs)`),
      el("p", { class: "sc-note" }, "For validating the camera, not part of the daily check. Hold one knee still at any bend, read it with a goniometer or phone inclinometer (0° = straight), and capture the camera angle for the same knee."),
      el("div", { class: "sc-validate-grid" },
        el("label", { class: "sc-text" }, "Participant code", el("input", { type: "text", maxlength: 12, value: check.participant, oninput: e => { check.participant = e.target.value; } })),
        el("label", { class: "sc-text" }, "Knee", el("select", { onchange: e => { check.side = e.target.value; check.hold = null; render(); } },
          [["left", "Left"], ["right", "Right"]].map(([v, l]) => el("option", { value: v, selected: check.side === v || undefined }, l)))),
        el("label", { class: "sc-text" }, "Reference", el("select", { onchange: e => { check.referenceType = e.target.value; } },
          REFERENCE_TYPES.map(t => el("option", { selected: check.referenceType === t || undefined }, t))))),
      number("Reference reading (knee flexion)", "°", check.reference, 0, 160, 0.5, value => { check.reference = value; }),
      el("div", { class: "sc-row" },
        el("button", { type: "button", class: "sc-secondary", disabled: !camOn || check.holding || undefined, onclick: holdAngle }, check.holding ? "Hold still…" : camOn ? "Capture camera angle (3 s hold)" : "Start the camera first"),
        el("button", { type: "button", class: "sc-primary", disabled: !(h?.usable) || undefined, onclick: savePair }, "Save pair")),
      h ? el("p", { class: h.usable ? "sc-note" : "sc-note sc-bad" }, h.usable ? `Camera: ${h.flexion}° flexion (SD ${h.sd}°, ${h.samples} frames). Enter the reference reading, then save.` : `Not paired: ${h.reason}.`) : null,
      a.ready ? el("div", { class: "sc-result" },
        el("strong", {}, `Bias ${a.bias > 0 ? "+" : ""}${a.bias}° · 95% limits ${a.loa[0]}° to ${a.loa[1]}°`),
        el("p", {}, `${a.n} pairs from ${a.people} ${a.people === 1 ? "person" : "people"} · mean absolute difference ${a.meanAbsError}° · conservative detectable change ${a.mdc95}° ${a.triggerAboveNoise ? "is below" : "is not below"} the ${a.reviewTrigger}° review trigger.`),
        a.caution ? el("small", {}, a.caution) : el("small", {}, `Agreement for this camera, lighting and setup only. Differences are camera minus reference.${calibratedFloors(check.pairs, a.reviewTrigger).kneeExtension ? ` The knee review trigger is raised to ${a.mdc95}° to match.` : ""}`))
        : el("p", { class: "sc-note" }, a.reason),
      check.pairs.length ? el("div", { class: "sc-row" },
        el("button", { type: "button", class: "sc-secondary", onclick: exportPairs }, "Export pairs (CSV)"),
        el("button", { type: "button", class: "sc-link", onclick: () => { if (confirm("Delete all accuracy-check pairs on this device?")) { check.pairs = []; angleStore.clear(); render(); } } }, "Clear pairs")) : null);
    return details;
  }

  // ---------- Reaction test (PVT-B) ----------
  const pvt = { running: false, trials: [], timer: null, raf: null, onset: null, start: 0, duration: PVT_B.durationMs, feedback: "" };
  const pvtStage = el("button", { type: "button", class: "sc-pvt-stage", "aria-label": "Reaction test response area. Tap or press space when the counter appears." });
  function startPvt(duration) {
    Object.assign(pvt, { running: true, trials: [], onset: null, start: performance.now(), duration, feedback: "Wait for the counter, then tap or press space." });
    // The host pauses its 3D rendering: a busy main thread delays the frame that shows the stimulus.
    onTimedTest(true); render(); pvtStage.focus(); schedule();
  }
  function schedule() {
    clearTimeout(pvt.timer);
    if (performance.now() - pvt.start >= pvt.duration) { finishPvt(true); return; }
    const isi = PVT_B.isiMinMs + Math.random() * (PVT_B.isiMaxMs - PVT_B.isiMinMs);
    pvt.timer = setTimeout(() => {
      // Onset is first stamped when the stimulus is set, so a tap can never count as early, then moved to
      // the start of the frame that draws it: on a slow frame the stimulus appears later than it was set,
      // and that wait is the device's, not the astronaut's. Animation frames also drive the counter.
      pvtStage.classList.add("sc-on"); pvt.onset = performance.now(); pvt.onsetMethod = "set";
      const shown = pvt.onset, tick = time => {
        if (pvt.onset === null) return;
        if (pvt.onsetMethod === "set" && time) { pvt.onset = Math.max(shown, time); pvt.onsetMethod = "frame"; }
        pvtStage.dataset.count = String(Math.round(performance.now() - pvt.onset)); pvt.raf = requestAnimationFrame(tick);
      };
      pvt.raf = requestAnimationFrame(tick);
      pvt.timer = setTimeout(() => { if (pvt.onset !== null) record(PVT_B.timeoutMs); }, PVT_B.timeoutMs);
    }, isi);
  }
  function record(rtMs) {
    cancelAnimationFrame(pvt.raf); pvtStage.classList.remove("sc-on");
    pvt.trials.push({ rtMs, onset: pvt.onsetMethod }); pvt.onset = null; pvt.feedback = `${Math.round(rtMs)} ms`; pvtStage.dataset.count = pvt.feedback;
    // The reaction time shows for the 1 s feedback period, which is part of the 1-4 s interval.
    clearTimeout(pvt.feedbackTimer); pvt.feedbackTimer = setTimeout(() => { if (pvt.onset === null && pvt.running) pvtStage.dataset.count = ""; }, PVT_B.feedbackMs);
    schedule();
  }
  function respond(event) {
    if (!pvt.running) return;
    event.preventDefault();
    if (pvt.onset === null) { pvt.trials.push({ falseStart: true }); pvtStage.dataset.count = "Too early"; return; }
    record(Math.max(0, event.timeStamp - pvt.onset));
  }
  pvtStage.addEventListener("pointerdown", respond);
  pvtStage.addEventListener("keydown", event => { if (event.code === "Space" || event.key === " ") respond(event); });
  function finishPvt(completed) {
    clearTimeout(pvt.timer); cancelAnimationFrame(pvt.raf); pvtStage.classList.remove("sc-on");
    if (!pvt.running) return; pvt.running = false; onTimedTest(false);
    applyPvt(summarizePvt(pvt.trials, { durationMs: pvt.duration, completed }), "TEST · this device");
  }
  function stopPvt(silent) { if (pvt.running) { if (silent) { pvt.running = false; clearTimeout(pvt.timer); cancelAnimationFrame(pvt.raf); onTimedTest(false); } else finishPvt(false); } }
  function applyPvt(summary, source) {
    state.pvt = { ...summary, source }; noteRepeat("reaction", summary.usable);
    Object.assign(state.check.values, { pvtSpeed: summary.meanSpeed, pvtLapses: summary.lapses });
    Object.assign(state.check.quality, { pvtSpeed: summary.usable, pvtLapses: summary.usable });
    Object.assign(state.check.protocols, { pvtSpeed: summary.protocol, pvtLapses: summary.protocol });
    state.check.sources.reaction = source; render();
  }

  // A usable result after one that failed its quality gate earns the "Quality first" badge on saving.
  function noteRepeat(kind, usable) { if (!usable) state.failed[kind] = true; else if (state.failed[kind]) state.check.repeatedAfterFail = true; }

  // ---------- Routine ----------
  const isComplete = evaluation => evaluation.domains.every(d => d.status !== "notChecked");
  function routine() {
    if (state.profile === "elena") {
      const saved = store.load("DEMO-ELENA", false).map(c => ({ day: 147, complete: Boolean(c.complete), repeatedAfterFail: Boolean(c.repeatedAfterFail) }));
      return { status: routineStatus([...ELENA_CHECK_DAYS.map(day => ({ day, complete: ELENA_HISTORY.some(r => r.missionDay === day) })), ...saved], 147), due: null };
    }
    const checks = history();
    return { status: routineStatus(checks.map(c => ({ day: dayNumber(c.at), complete: Boolean(c.complete), repeatedAfterFail: Boolean(c.repeatedAfterFail) })), dayNumber()), due: nextDue(checks.at(-1)?.at) };
  }
  function routineCard() {
    const { status, due } = routine();
    return el("section", { class: "sc-routine", "aria-label": "Mission routine" },
      el("header", {}, el("b", {}, "Mission routine"), el("small", {}, state.profile === "elena" ? `Mission day 147 · ${status.doneToday ? "today's check saved" : "today's check not saved yet"}` : due.label)),
      el("div", { class: "sc-streak" }, el("strong", {}, String(status.streak)), el("span", {}, `day streak${status.doneToday ? "" : " · check today to keep it"}`),
        el("small", {}, `longest ${status.longest} · ${status.total} ${status.total === 1 ? "check" : "checks"}${state.profile === "elena" ? " · synthetic log" : ""}`)),
      el("ol", { class: "sc-routine-list" }, ROUTINE.map(slot => el("li", {}, el("b", {}, slot.when), el("span", {}, slot.items.join(" · ")),
        el("button", { type: "button", class: "sc-link", onclick: () => go(STEPS.findIndex(([key]) => key === slot.step)) }, "Go")))),
      el("div", { class: "sc-badges", role: "list", "aria-label": "Badges" }, status.badges.map(b => el("span", { role: "listitem", class: `sc-badge ${b.earned ? "sc-earned" : ""}`, title: b.detail }, b.earned ? "★ " : "☆ ", b.label))),
      el("small", { class: "sc-note" }, "Badges reward doing the checks, never a health value."));
  }

  // ---------- Save & follow-up ----------
  function saveCheck() {
    if (state.saved || !state.evaluation) return;
    const profileId = state.profile === "elena" ? "DEMO-ELENA" : "you";
    const checks = state.profile === "elena" ? store.load(profileId, false) : history(), before = routine().status;
    checks.push({ ...state.check, at: new Date().toISOString(), complete: isComplete(state.evaluation), evaluation: { overall: state.evaluation.overall, domains: state.evaluation.domains.map(d => ({ key: d.key, status: d.status })) } });
    store.save(profileId, checks, state.profile === "elena" ? false : state.persist);
    const now = Date.now();
    state.followUps = [...element.querySelectorAll("[data-action]:checked")].map(input => {
      const action = state.evaluation.actions.find(a => a.id === input.dataset.action);
      return { ...action, recordedAt: new Date(now).toISOString(), dueAt: action.due === null ? null : new Date(now + action.due * 3600e3).toISOString(), status: "open" };
    });
    state.saved = true; state.earned = newBadges(before, routine().status); render();
  }
  function exportPacket() {
    return { schema: "astrobone-self-check-export-v1", profile: state.profile === "elena" ? "DEMO-ELENA (synthetic)" : "This device", environment: environment(), check: state.check, evaluation: state.evaluation, followUps: state.followUps,
      boundary: "Self-monitoring record. Review triggers are engineering defaults, not clinical thresholds. Not a diagnosis.", exportedAt: new Date().toISOString() };
  }
  function download(text, type, name) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el("a", { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() { download(JSON.stringify(exportPacket(), null, 2), "application/json", `AstroBone-self-check-${state.profile}-${Date.now()}.json`); }

  // The same result as a short plain-text message for the flight surgeon, readable without AstroBone.
  function reportSection() {
    const text = surgeonReport(state.evaluation, state.check, { environment: environment(), profile: state.profile === "elena" ? "DEMO-ELENA (synthetic)" : "This device",
      followUps: state.saved ? state.followUps : null });
    const kb = n => `${(n / 1024).toFixed(1)} kB`, size = byteSize(text), full = byteSize(JSON.stringify(exportPacket(), null, 2));
    const copied = el("small", { role: "status" });
    return el("section", { class: "sc-report", "aria-label": "Report for flight surgeon" },
      el("header", {}, el("b", {}, "Report for flight surgeon"), el("small", {}, `${kb(size)} of plain text, ${Math.round(full / size)}× smaller than the full JSON record (${kb(full)}). Readable on any ground terminal.`)),
      el("pre", { tabindex: "0" }, text),
      el("div", { class: "sc-row" },
        el("button", { type: "button", class: "sc-secondary", onclick: async () => { try { await navigator.clipboard.writeText(text); copied.textContent = "Copied."; } catch { copied.textContent = "Copy is blocked here; use Download."; } } }, "Copy"),
        el("button", { type: "button", class: "sc-secondary", onclick: () => download(text, "text/plain;charset=utf-8", `AstroBone-report-${state.profile}-${Date.now()}.txt`) }, "Download .txt"),
        copied));
  }

  // ---------- Vital signs ----------
  // Typed readings from a cuff, finger clip, glucose meter and thermometer. A live note under each one
  // says at once whether it crosses a fixed safety limit, before the check is evaluated.
  function vitalsBlock() {
    const c = state.check, vt = c.vitals ??= {}, chips = [];
    const sync = () => { applyVitals(c, vt); chips.forEach(update => update()); };
    const num = (value, min, max, step, aria, onValue) => el("input", { type: "number", min, max, step, inputmode: "decimal", "aria-label": aria, value: Number.isFinite(value) ? value : "",
      oninput: e => { const n = e.target.value === "" ? null : Number(e.target.value); const ok = n === null || (Number.isFinite(n) && n >= min && n <= max); e.target.toggleAttribute("aria-invalid", !ok); onValue(ok ? n : null); sync(); } });
    const chip = keys => {
      const node = el("small", { class: "sc-limit", role: "status" });
      const update = () => {
        const hits = keys.filter(k => Number.isFinite(c.values[k])).map(k => ({ k, limit: safetyLimit(k, c.values[k]) }));
        const hit = hits.find(h => h.limit?.level === "urgent") ?? hits.find(h => h.limit);
        node.className = `sc-limit${hits.length ? ` sc-${hit ? hit.limit.level : "ok"}` : ""}`;
        node.textContent = !hits.length ? "" : !hit ? "Within the safety limits"
          : `${INDICATORS[hit.k].short ?? INDICATORS[hit.k].label} ${hit.limit.text}: ${hit.limit.level === "urgent" ? "urgent safety limit" : "tell your crew medical officer today"}`;
        if (keys.some(k => k === "systolicBp") && hits.length && c.quality.systolicBp === false) node.textContent += " · sit for 5 minutes first, or it will be repeated";
      };
      chips.push(update); update(); return node;
    };
    const about = key => el("small", { class: "sc-about" }, INDICATORS[key].about);
    const bp = vt.bp ??= { readings: [], rested: false };
    const reading = (i, label) => el("span", { class: "sc-bp" },
      num(bp.readings[i]?.[0], 50, 260, 1, `${label} systolic`, n => { (bp.readings[i] ??= [null, null])[0] = n; }), el("i", {}, "/"),
      num(bp.readings[i]?.[1], 30, 160, 1, `${label} diastolic`, n => { (bp.readings[i] ??= [null, null])[1] = n; }), el("i", {}, "mmHg"));
    const glucose = vt.glucose ??= { value: null, unit: "mg/dL", fasting: true }, temp = vt.temp ??= { value: null, unit: "°C", site: "oral" }, spo2 = vt.spo2 ??= { value: null };
    const gRange = () => (glucose.unit === "mmol/L" ? [1, 33, 0.1] : [20, 600, 1]), tRange = () => (temp.unit === "°F" ? [86, 113, 0.1] : [30, 45, 0.1]);
    return el("fieldset", { class: "sc-fieldset sc-vitals" }, el("legend", {}, "Vital signs · type what you measured today, leave blank to skip"),
      el("div", { class: "sc-vital" }, el("b", {}, "Blood pressure"), reading(0, "Reading 1"), el("small", {}, "Second reading a minute later (optional, averaged)"), reading(1, "Reading 2"),
        checkbox("sc-bp-rested", "Seated with my back supported, rested for 5 minutes", bp.rested, value => { bp.rested = value; sync(); }), chip(["systolicBp", "diastolicBp"]), about("systolicBp")),
      el("div", { class: "sc-vital" }, el("b", {}, "Oxygen saturation"), el("span", { class: "sc-bp" }, num(spo2.value, 50, 100, 1, "Oxygen saturation", n => { spo2.value = n; }), el("i", {}, "%")), chip(["spo2"]), about("spo2")),
      el("div", { class: "sc-vital" }, el("b", {}, "Blood sugar"),
        el("span", { class: "sc-bp" }, num(glucose.value, ...gRange(), "Blood sugar", n => { glucose.value = n; }),
          el("select", { "aria-label": "Blood sugar unit", onchange: e => { const was = glucose.unit; glucose.unit = e.target.value; if (Number.isFinite(glucose.value) && was !== glucose.unit) glucose.value = Number((was === "mg/dL" ? glucose.value / GLUCOSE_MG_PER_MMOL : glucose.value * GLUCOSE_MG_PER_MMOL).toFixed(glucose.unit === "mg/dL" ? 0 : 1)); sync(); render(); } },
            ["mg/dL", "mmol/L"].map(u => el("option", { selected: glucose.unit === u || undefined }, u)))),
        el("span", { class: "sc-row" }, [[true, "Fasting (before breakfast)"], [false, "Not fasting"]].map(([fasting, label]) => el("label", { class: "sc-radio" },
          el("input", { type: "radio", name: "sc-glucose-fasting", checked: glucose.fasting === fasting || undefined, onchange: () => { glucose.fasting = fasting; sync(); } }), label))),
        chip(["glucose"]), about("glucose")),
      el("div", { class: "sc-vital" }, el("b", {}, "Body temperature"),
        el("span", { class: "sc-bp" }, num(temp.value, ...tRange(), "Body temperature", n => { temp.value = n; }),
          el("select", { "aria-label": "Temperature unit", onchange: e => { const was = temp.unit; temp.unit = e.target.value; if (Number.isFinite(temp.value) && was !== temp.unit) temp.value = Number((was === "°C" ? temp.value * 9 / 5 + 32 : (temp.value - 32) * 5 / 9).toFixed(1)); sync(); render(); } },
            ["°C", "°F"].map(u => el("option", { selected: temp.unit === u || undefined }, u))),
          el("select", { "aria-label": "Thermometer site", onchange: e => { temp.site = e.target.value; sync(); } }, TEMP_SITES.map(([k, label]) => el("option", { value: k, selected: temp.site === k || undefined }, label)))),
        chip(["bodyTemp"]), about("bodyTemp")),
      el("small", { class: "sc-note" }, `Safety limits apply from the first reading and follow public guidance (${SAFETY_LIMIT_SOURCES.join("; ")}). Your flight surgeon can set their own. Each value is also compared with your own usual range once you have 3 checks.`));
  }

  // ---------- Rendering ----------
  function stepBody() {
    const [key] = STEPS[state.step], c = state.check, demo = state.profile === "elena";
    if (key === "safety") {
      return [routineCard(), planCard(), el("p", { class: "sc-lead" }, "Right now, do you have any of these?"),
        el("div", { class: "sc-checks" }, RED_FLAGS.map(([k, label]) => checkbox(`rf-${k}`, label, Boolean(c.redFlags?.[k]), value => { c.redFlags = { ...(c.redFlags || {}), [k]: value }; render(); }))),
        Object.values(c.redFlags || {}).some(Boolean) ? el("p", { class: "sc-urgent", role: "alert" }, "Contact your crew medical officer now. Finish the check only if it is safe to do so.") : null,
        el("button", { type: "button", class: "sc-secondary", onclick: () => { c.redFlags = {}; go(1); } }, "None of these · continue")];
    }
    if (key === "movement") {
      const cap = state.capture, usable = cap && !cap.capturing && c.quality.kneeExtension;
      const camOn = camera?.running;
      return [why("bone", "In spaceflight the legs lose the most bone, so this test comes first."),
        el("p", { class: "sc-lead" }, "Seated knee extension, 10 seconds. Sit fully side-on to the camera (most accurate on real video: the near knee is measured), or face it with both legs visible. Use the same position every day. Straighten and bend your knees slowly."),
        demo ? el("div", { class: "sc-row" },
          el("button", { type: "button", class: "sc-secondary", "data-demo": "poor", onclick: () => demoCapture("poor") }, "Demo capture · poor framing"),
          el("button", { type: "button", class: "sc-secondary", "data-demo": "usable", onclick: () => demoCapture("usable") }, "Demo capture · usable"))
          : el("div", { class: "sc-camera" }, video, overlay, el("div", { class: "sc-cam-hud" }, camStatus, el("span", {}, "KNEE ", liveAngle)),
            el("div", { class: "sc-row" }, camOn ? null : el("button", { type: "button", class: "sc-secondary", onclick: startCamera }, "Start camera"),
              camOn ? el("button", { type: "button", class: "sc-primary", disabled: cap?.capturing || undefined, onclick: recordCamera }, cap?.capturing ? "Recording 10 s…" : "Record 10 s") : null,
              camOn ? el("button", { type: "button", class: "sc-secondary", onclick: () => { stopCamera(); render(); } }, "Stop camera") : null)),
        cap?.capturing && demo ? el("p", { class: "sc-note" }, "Capturing demo movement…") : null,
        cap && !cap.capturing ? el("div", { class: `sc-result ${usable ? "" : "sc-bad"}` },
          el("strong", {}, usable ? "Capture usable" : "Comparison withheld · repeat the capture"),
          el("p", {}, usable ? `Knee extension ${fmt(cap.kneeExtension)}° · range of motion ${fmt(cap.kneeRom)}° · tracking quality ${fmt(cap.trackingQuality, 2)} · ${cap.sampleCount} samples${kneeView(cap)}${kneeMethod(cap)}`
            : cap.reason === "oblique" ? `You were turned partway (${fmt(cap.bodyYawDeg, 0)}° from facing the camera). Face the camera, or turn fully side-on, and repeat: a part-turned reading matches neither position's baseline.`
            : `Tracking quality ${fmt(cap.trackingQuality, 2)} with ${cap.sampleCount} usable samples is below the quality rule (≥ 0.70 and ≥ 12 samples). A worse-looking number from a poor capture is not treated as a health change.`),
          el("small", {}, `${cap.source} · attempt ${state.captures}`)) : null,
        el("p", { class: "sc-note" }, "Video stays on this device. Only the summary angles are kept."),
        demo ? null : accuracyCheck()];
    }
    if (key === "reaction") {
      const result = state.pvt;
      return [el("p", { class: "sc-lead" }, "Reaction test (PVT-B): a counter appears at random intervals. Tap or press space as soon as you see it. Sensitive to sleep loss and fatigue."),
        demo ? el("button", { type: "button", class: "sc-secondary", "data-demo": "pvt", onclick: () => applyPvt(ELENA_PVT, "SYNTHETIC DEMO") }, "Use demo result (3-minute test)")
          : el("div", {}, pvtStage, el("div", { class: "sc-row" },
            pvt.running ? el("button", { type: "button", class: "sc-secondary", onclick: () => stopPvt(false) }, "Stop test")
              : [el("button", { type: "button", class: "sc-primary", onclick: () => startPvt(PVT_B.durationMs) }, "Start 3-minute test"),
                el("button", { type: "button", class: "sc-secondary", onclick: () => startPvt(PVT_B.practiceDurationMs) }, "1-minute practice")]),
            pvt.running ? el("p", { class: "sc-note", "aria-live": "polite" }, pvt.feedback) : null),
        result ? el("div", { class: `sc-result ${result.usable ? "" : "sc-bad"}` },
          el("strong", {}, result.usable ? `${result.lapses} lapses · speed ${fmt(result.meanSpeed, 2)}/s` : `Not compared · ${result.reason}`),
          el("p", {}, `${result.validResponses} valid responses · ${result.falseStarts} early · median ${result.medianRtMs ?? "--"} ms · ${Number.isFinite(result.performanceScore) ? `performance score ${result.performanceScore} % · ` : ""}${result.protocol === PVT_PROTOCOL.full ? "3-minute protocol" : "practice length (only compared with practice runs)"}`),
          el("small", {}, result.source)) : null,
        el("p", { class: "sc-note" }, "Browser timing adds about one display frame of uncertainty. Results are compared only with your own runs on the same protocol.")];
    }
    if (key === "mind") {
      const v = c.values;
      return [number("Sleep in the last 24 h", "h", v.sleepHours, 0, 16, 0.5, value => { v.sleepHours = value; }),
        el("fieldset", { class: "sc-fieldset" }, el("legend", {}, "How do you feel right now? (Samn-Perelli)"),
          SAMN_PERELLI.map((label, i) => el("label", { class: "sc-radio" }, el("input", { type: "radio", name: "sc-fatigue", value: i + 1, checked: v.fatigue === i + 1 || undefined, onchange: () => { v.fatigue = i + 1; } }), `${i + 1} · ${label}`))),
        slider("Mood", v.mood, value => { v.mood = value; }, "0 very low", "10 very good"),
        slider("Stress", v.stress, value => { v.stress = value; }, "0 none", "10 extreme"),
        el("label", { class: "sc-text" }, "Anything else for your reviewer? (optional)", el("textarea", { rows: 2, oninput: e => { c.notes = e.target.value; } }, c.notes || "")),
        demo ? el("p", { class: "sc-note" }, "Pre-filled with Elena's authored Day 147 answers.") : null];
    }
    if (key === "body") {
      const v = c.values;
      const immune = ruleFor("immune");
      return [immune ? why("immune", immune.status === "active" ? `Daily now: ${immune.cadence.toLowerCase()}.` : `${immune.rule}${immune.note ? ` ${immune.note}` : ""}`) : null,
        el("fieldset", { class: "sc-fieldset" }, el("legend", {}, "New since your last check"),
          IMMUNE_SYMPTOMS.map(([k, label]) => checkbox(`sym-${k}`, label, Boolean(c.symptoms?.[k]), value => { c.symptoms = { ...(c.symptoms || {}), [k]: value }; })),
          el("button", { type: "button", class: "sc-link", onclick: () => { c.symptoms = {}; render(); } }, "None of these")),
        el("section", { class: "sc-pulse" },
          el("p", { class: "sc-lead" }, `Resting pulse from your face: sit still for ${CAMERA_PULSE.seconds} s, facing the camera in steady light. It is compared only with your own earlier camera readings, to show whether your resting heart rate is drifting up or down.`),
          demo ? null : el("div", { class: "sc-camera" }, pulseVideo, el("div", { class: "sc-cam-hud" }, pulseStatus)),
          demo ? null : el("div", { class: "sc-row" }, pulse.measuring ? el("button", { type: "button", class: "sc-secondary", onclick: () => { stopPulse(); render(); } }, "Stop")
            : el("button", { type: "button", class: "sc-primary", onclick: measurePulse }, pulse.result ? "Measure again" : `Measure resting pulse (${CAMERA_PULSE.seconds} s)`)),
          pulse.result ? el("div", { class: `sc-result ${pulse.result.status === "estimated" ? "" : "sc-bad"}` },
            el("strong", {}, pulse.result.status === "estimated" ? `${pulse.result.bpm} bpm · camera hybrid` : `Not measured · ${pulse.result.reason}`),
            pulse.result.status === "estimated" ? el("p", {}, `Signal agreement ${Math.round(pulse.result.quality * 100)} % · ${pulse.result.parts?.map(p => `${p.name} ${p.bpm}`).join(" · ")} · ${Math.round(pulse.result.fps)} frames/s`) : null,
            el("small", {}, "ME-rPPG deep model, cross-checked with the POS colour method. Tested on 40 people at rest and after squats against a finger sensor (docs/real-video-validation.md). Not a medical device.")) : null),
        number("Resting heart rate", "bpm", v.restingHr, 30, 200, 1, value => { v.restingHr = value; c.protocols.restingHr = c.protocols.restingHr === RESTING_CAMERA_PROTOCOL ? "resting-self-reported-v1" : c.protocols.restingHr ?? "resting-self-reported-v1"; c.sources.restingHr = c.sources.restingHr === "Camera (rPPG hybrid)" ? "Manual pulse count" : c.sources.restingHr; }),
        el("label", { class: "sc-text" }, "Heart-rate source",
          el("select", { onchange: e => { c.sources.restingHr = e.target.value; } }, ["Wearable or chest strap", "Pulse oximeter", "Manual pulse count", "Camera (rPPG hybrid)", "Synthetic demo"].map(s => el("option", { selected: (c.sources.restingHr ?? (demo ? "Synthetic demo" : "Wearable or chest strap")) === s || undefined }, s)))),
        vitalsBlock(),
        number("Personal dosimeter, cumulative (context only)", "mGy", c.dosimeter, 0, 10000, 0.01, value => { c.dosimeter = value; }),
        why("heart", "showed no consistent heart effect from radiation, so dose never raises an alarm. It is logged beside heart rate for the medical reviewer.")
          ?? el("p", { class: "sc-note" }, "Radiation dose is recorded as mission context. It is never turned into a health status.")];
    }
    return resultBody();
  }

  function resultBody() {
    const ev = state.evaluation; if (!ev) return [];
    const [label, detail] = STATUS[ev.overall];
    const measured = d => d.indicators.filter(r => r.status !== "notChecked");
    const charted = chartableKeys(history(), state.check);
    return [el("div", { class: `sc-overall sc-${ev.overall}` }, el("strong", {}, label), el("span", {}, ev.overall === "stable" ? "No change outside your usual range" : detail)),
      ev.redFlags.length ? el("p", { class: "sc-urgent", role: "alert" }, `Reported: ${ev.redFlags.join("; ")}.`) : null,
      ladder(ev),
      el("div", { class: "sc-domains" }, ev.domains.map(d => el("section", { class: `sc-domain sc-${d.status}` },
        el("header", {}, el("b", {}, d.label), el("em", {}, STATUS[d.status][0])), el("small", {}, d.hazard),
        el("div", { class: "sc-hazards" }, hazardsForDomain(d.key).map(h => el("span", { title: h.effect }, h.name))),
        d.key === "immune" ? el("p", {}, d.status === "notChecked" && !measured(d).length ? "Symptoms not answered." : d.symptoms.length ? d.symptoms.join(", ") : "No new symptoms reported.") : null,
        measured(d).length ? el("ul", {}, measured(d).map(r => el("li", { class: `sc-${r.status}`, title: r.def.about },
            el("span", {}, charted.includes(r.key) ? el("button", { type: "button", class: "sc-rowlink", "aria-label": `Chart ${r.def.label} over time`, onclick: () => showChart(r.key) }, r.def.label) : r.def.label,
              el("em", { class: `sc-word sc-${r.status}` }, `${STATUS_MARKS[r.status].glyph} ${STATUS[r.status][0]}`)), el("b", {}, `${fmt(r.value, r.def.digits ?? 0)}${r.def.unit === "°" || !r.def.unit ? r.def.unit : ` ${r.def.unit}`}`),
            el("small", {}, r.limit ? `safety limit: ${r.limit.text}` : r.status === "baseline" ? `baseline ${r.ref.count}/${r.ref.needed}` : r.status === "repeat" ? "quality failed"
              : r.reason === "drift" ? `gradual drift · start ${fmt(r.drift.lockedMean, r.def.digits ?? 0)}` : `usual ${fmt(r.ref.mean, r.def.digits ?? 0)} ± ${fmt(r.tolerance, r.def.digits ?? 1)}`),
            trend(r)))) : d.key !== "immune" ? el("p", {}, "Not checked.") : null,
        helps(d)))),
      overTime(ev, charted),
      el("section", { class: "sc-actions" }, el("h3", {}, "Your next step"),
        ev.actions.map(a => el("label", { class: `sc-action sc-${a.priority}` }, el("input", { type: "checkbox", "data-action": a.id, checked: (a.priority !== "info" || a.id === "routine") || undefined, disabled: state.saved || undefined }), el("span", {}, a.text)))),
      state.saved ? el("div", { class: "sc-result" }, el("strong", {}, `Saved · ${routine().status.streak}-day streak`), el("p", {}, state.followUps.length ? state.followUps.map(f => `${f.text.split(".")[0]}${f.dueAt ? ` · due ${new Date(f.dueAt).toLocaleString()}` : ""}`).join(" | ") : "No follow-up selected."),
        state.earned.length ? el("div", { class: "sc-badges", role: "status" }, state.earned.map(b => el("span", { class: "sc-badge sc-earned sc-new", title: b.detail }, `★ New badge: ${b.label}`))) : null,
        el("small", {}, state.profile === "elena" ? "Demo record kept in memory for this tab." : state.persist ? "Saved on this device." : "Kept in memory for this tab (saving on this device is off)."))
        : el("button", { type: "button", class: "sc-primary", onclick: saveCheck }, "Save check & selected actions"),
      el("div", { class: "sc-row" },
        el("button", { type: "button", class: "sc-secondary", "aria-expanded": String(state.report), onclick: () => { state.report = !state.report; render(); if (state.report) element.querySelector(".sc-report")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }, "Report for flight surgeon"),
        el("button", { type: "button", class: "sc-secondary", onclick: exportJson }, "Export for reviewer (JSON)"), el("button", { type: "button", class: "sc-secondary", onclick: reset }, "New check")),
      state.report ? reportSection() : null,
      el("p", { class: "sc-note" }, "Review triggers: outside 2× your own spread or a minimum change, whichever is larger, after 3 usable checks; or a steady drift from your first checks (CUSUM). Engineering defaults, not clinical thresholds. AstroBone does not diagnose or prescribe."),
      state.profile === "elena" ? el("p", { class: "sc-note" }, ELENA_SELF_CHECK_BOUNDARY) : null];
  }

  // Who to tell, for this result in this place: the escalation ladder with the active rung explained.
  function ladder(ev) {
    const env = environment(), plan = escalationPlan(ev.overall, env);
    return el("section", { class: "sc-ladder", "aria-label": "Who to tell" },
      el("header", {}, el("b", {}, "Who to tell"), el("small", {}, `${env.label} · ${env.place} · ${env.gravity} · message to Earth ${env.delayText} one way`)),
      el("ol", {}, plan.steps.map(step => el("li", { class: step.active ? "sc-active" : undefined, "aria-current": step.active ? "step" : undefined, title: step.detail },
        el("strong", {}, step.title), el("span", {}, step.who), step.active ? el("p", {}, step.detail) : null))));
  }
  // Over time: the full-size chart for one indicator, every check re-judged as it was on its own day.
  function overTime(ev, charted) {
    if (!charted.length) return null;
    const rows = ev.domains.flatMap(d => d.indicators);
    // Default: the most serious measured indicator.
    const pick = charted.includes(state.chartKey) ? state.chartKey
      : (rows.filter(r => charted.includes(r.key)).sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0]?.key ?? charted[0]);
    const floors = state.profile === "elena" ? {} : calibratedFloors(check.pairs, INDICATORS.kneeExtension.floor);
    const hist = indicatorHistory(pick, history(), state.saved ? null : state.check, { floors });
    const box = el("div", { class: "sc-hchart-box" }); box.innerHTML = historyChartSvg(hist);
    const d = hist.def;
    return el("section", { class: "sc-over", "aria-label": "Over time" },
      el("header", {}, el("b", {}, "Over time"),
        el("label", {}, el("span", {}, "Measure"), el("select", { "aria-label": "Measurement to chart", onchange: e => { state.chartKey = e.target.value; render(); } },
          charted.map(key => el("option", { value: key, selected: key === pick || undefined }, INDICATORS[key].label))))),
      el("small", {}, `${d.about ?? ""} Each point is judged against the checks before it, as it was on that day.`),
      box,
      el("ul", { class: "sc-legend", "aria-label": "Legend" },
        legendFor(hist).map(m => el("li", { class: `sc-${m.status}` }, el("i", {}, m.glyph), m.word)),
        hist.points.some(p => p.band) ? el("li", { class: "sc-legend-band" }, el("i", {}), "usual range that day") : null,
        Number.isFinite(hist.start) ? el("li", { class: "sc-legend-start" }, el("i", {}), "starting level") : null,
        hist.limitLines.length ? el("li", { class: "sc-legend-limit" }, el("i", {}), "safety limit") : null),
      el("details", { class: "sc-htable" }, el("summary", {}, "Show as a table"),
        el("ol", {}, hist.points.map(p => el("li", {}, pointLabel(p, d))))));
  }
  function showChart(key) {
    state.chartKey = key; render();
    element.querySelector(".sc-over")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // What helps: general guidance for the domain, open when the domain needs attention.
  function helps(d) {
    const g = guidanceFor(d.key); if (!g) return null;
    return el("details", { class: "sc-helps", open: ["changed", "attention", "urgent"].includes(d.status) || undefined },
      el("summary", {}, g.title), el("ul", {}, g.helps.map(text => el("li", {}, text))),
      el("small", {}, `${g.sources.join(" · ")}. ${GUIDANCE_BOUNDARY}`));
  }

  // Trend under each compared indicator: shaded usual range, dashed starting level, today's dot.
  function trend(r) {
    if (r.status !== "stable" && r.status !== "changed") return null;
    const d = r.def.digits ?? 0, start = r.drift?.ready ? r.drift.lockedMean : null;
    const svg = sparklineSvg({ series: r.series, value: r.value, band: [r.ref.mean - r.tolerance, r.ref.mean + r.tolerance], start, changed: r.status === "changed",
      label: `${r.def.label}: ${r.series.length + 1} checks, ${start === null ? "" : `start ${fmt(start, d)}, `}today ${fmt(r.value, d)}${r.def.unit}` });
    if (!svg) return null;
    const box = el("div", { class: "sc-trend" }); box.innerHTML = svg; return box;
  }

  function checkbox(id, label, checked, change) {
    return el("label", { class: "sc-check" }, el("input", { type: "checkbox", id, checked: checked || undefined, onchange: e => change(e.target.checked) }), label);
  }
  function number(label, unit, value, min, max, step, change) {
    return el("label", { class: "sc-number" }, label, el("span", {}, el("input", { type: "number", min, max, step, value: Number.isFinite(value) ? value : "", inputmode: "decimal",
      oninput: e => { const n = e.target.value === "" ? null : Number(e.target.value); change(Number.isFinite(n) && n >= min && n <= max ? n : null); } }), el("i", {}, unit)));
  }
  function slider(label, value, change, low, high) {
    const out = el("output", {}, Number.isFinite(value) ? String(value) : "–");
    return el("label", { class: "sc-slider" }, el("span", {}, label, out),
      el("input", { type: "range", min: 0, max: 10, step: 1, value: Number.isFinite(value) ? value : 5, oninput: e => { change(Number(e.target.value)); out.textContent = e.target.value; } }),
      el("small", {}, el("span", {}, low), el("span", {}, high)));
  }

  function render() {
    const steps = el("ol", { class: "sc-steps" }, STEPS.map(([key, label], i) => el("li", {}, el("button", { type: "button", "aria-current": i === state.step ? "step" : undefined, onclick: () => go(i) }, `${i + 1} ${label}`))));
    const profile = el("div", { class: "sc-profile", role: "group", "aria-label": "Whose check" },
      el("button", { type: "button", "aria-pressed": String(state.profile === "elena"), onclick: () => switchProfile("elena") }, "Elena · synthetic demo"),
      el("button", { type: "button", "aria-pressed": String(state.profile === "you"), onclick: () => switchProfile("you") }, "You · this device"));
    // Where the astronaut is: sets the escalation ladder and who reviews a logged change.
    const where = el("label", { class: "sc-env" }, el("span", {}, "Where"), el("select", { "aria-label": "Mission environment", onchange: e => { state.environment = e.target.value; if (state.evaluation) evaluate(); render(); } },
      ENVIRONMENTS.map(env => el("option", { value: env.key, selected: env.key === state.environment || undefined }, `${env.label} · ${env.place}`))));
    const consent = state.profile === "you" ? el("label", { class: "sc-consent" }, el("input", { type: "checkbox", checked: state.persist || undefined, onchange: e => {
      state.persist = e.target.checked; try { localStorage.setItem("astrobone-self-check-consent", state.persist ? "1" : "0"); } catch { /* storage unavailable */ }
      angleStore.save(check.pairs, state.persist); render();
    } }), `Save my checks on this device (${history().length} saved)`) : null;
    const nav = STEPS[state.step][0] === "result" ? null : el("div", { class: "sc-nav" },
      state.step > 0 ? el("button", { type: "button", class: "sc-secondary", onclick: () => go(state.step - 1) }, "Back") : el("span"),
      el("button", { type: "button", class: "sc-primary", "data-next": true, onclick: () => go(state.step + 1) }, state.step === STEPS.length - 2 ? "Evaluate" : "Next"));
    element.replaceChildren(...[profile, where, consent, steps, el("div", { class: "sc-body" }, stepBody()), nav].filter(Boolean));
    // Re-inserting a media element pauses it; resume the live preview.
    if (camera?.running && video.paused) video.play().catch(() => {});
    if (!pvt.running && !pvtStage.dataset.count) pvtStage.dataset.count = "Ready";
  }

  reset();
  return {
    element, reset, go, demoCapture, applyDemoPvt: () => applyPvt(ELENA_PVT, "SYNTHETIC DEMO"), saveCheck,
    setProfile: switchProfile,
    setEnvironment(key) { if (environmentFor(key)) { state.environment = key; if (state.evaluation) evaluate(); render(); } },
    openStep(key) { go(Math.max(0, STEPS.findIndex(([k]) => k === key))); },
    stop() { stopCamera(); stopPulse(); stopPvt(true); },
    get state() { return state; },
    latestEvaluation(profile = state.profile) {
      if (state.evaluation && state.profile === profile) return state.evaluation;
      return profile === "elena" ? evaluateSelfCheck(elenaDay147(), ELENA_HISTORY, { environment: environmentFor(DEFAULT_ENVIRONMENT.elena) }) : null;
    },
  };
}

export const SELF_CHECK_INDICATORS = INDICATORS;
