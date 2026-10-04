import {
  PVT_B, SAMN_PERELLI, RED_FLAGS, IMMUNE_SYMPTOMS, INDICATORS, newCheck, summarizePvt, evaluateSelfCheck, createSelfCheckStore,
} from "./selfCheck.js";
import { ELENA_HISTORY, ELENA_POOR_CAPTURE, ELENA_USABLE_CAPTURE, ELENA_PVT, ELENA_SELF_CHECK_BOUNDARY, elenaDay147 } from "./elenaSelfCheck.js";
import { createSelfCheckCamera } from "./selfCheckCamera.js";
import { ELENA } from "./elenaMissionScenario.js";

const STEPS = [["safety", "Safety"], ["movement", "Movement"], ["reaction", "Reaction"], ["mind", "Sleep & mood"], ["body", "Body"], ["result", "Result & action"]];
const STATUS = {
  urgent: ["URGENT", "Contact now"], changed: ["REVIEW", "Outside your usual range"], repeat: ["REPEAT", "Quality check failed · not compared"],
  baseline: ["BASELINE", "Building your baseline"], stable: ["STABLE", "Within your usual range"], notChecked: ["NOT CHECKED", "No data this check"],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

export function createSelfCheckPanel({ onEvaluate = () => {}, onStep = () => {} } = {}) {
  const store = createSelfCheckStore();
  const state = { profile: "elena", persist: false, step: 0, check: null, capture: null, pvt: null, evaluation: null, captures: 0, followUps: [], saved: false };
  const element = el("div", { class: "sc" });
  const video = el("video", { class: "sc-video", playsinline: true, muted: true, "aria-label": "Camera preview" });
  const overlay = el("canvas", { class: "sc-overlay", "aria-hidden": "true" });
  const camStatus = el("small", { class: "sc-cam-status", role: "status" }, "Camera off");
  let camera = null, liveAngle = el("b", {}, "--");
  try { state.persist = localStorage.getItem("astrobone-self-check-consent") === "1"; } catch { /* storage unavailable */ }

  const history = () => (state.profile === "elena" ? [...ELENA_HISTORY, ...(store.load("DEMO-ELENA", false))] : store.load("you", state.persist));
  function reset() {
    stopCamera(); stopPvt(true);
    state.step = 0; state.capture = null; state.pvt = null; state.evaluation = null; state.captures = 0; state.saved = false;
    if (state.profile === "elena") {
      state.check = elenaDay147(); state.check.id = `DEMO-ELENA-day-147-${Date.now()}`;
      // Movement and reaction results arrive through the demo capture buttons.
      for (const key of ["kneeExtension", "kneeRom", "pvtSpeed", "pvtLapses"]) delete state.check.values[key];
      // Elena's authored answers: no red flags and no new symptoms on Day 147.
      state.check.redFlags = {}; state.check.symptoms = {};
      state.check.dosimeter = ELENA.observations.find(r => r.day.value === 147).absorbedDose.value;
    } else state.check = newCheck("you");
    render(); onStep(STEPS[0][0]);
  }
  function go(step) { state.step = Math.max(0, Math.min(STEPS.length - 1, step)); if (STEPS[state.step][0] !== "movement") stopCamera(); if (STEPS[state.step][0] === "result") evaluate(); render(); onStep(STEPS[state.step][0]); }

  function evaluate() {
    state.evaluation = evaluateSelfCheck(state.check, history());
    onEvaluate(state.evaluation, state.profile);
  }

  // ---------- Movement ----------
  function applyCapture(capture, source) {
    state.capture = { ...capture, source }; state.captures++;
    const usable = capture.status !== "insufficient" && capture.trackingQuality >= 0.7 && capture.sampleCount >= 12 && Number.isFinite(capture.kneeExtension);
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
      liveAngle.textContent = frame?.angles ? `${Math.round((frame.angles.left.knee + frame.angles.right.knee) / 2)}°` : "--";
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

  // ---------- Reaction test (PVT-B) ----------
  const pvt = { running: false, trials: [], timer: null, raf: null, onset: null, start: 0, duration: PVT_B.durationMs, feedback: "" };
  const pvtStage = el("button", { type: "button", class: "sc-pvt-stage", "aria-label": "Reaction test response area. Tap or press space when the counter appears." });
  function startPvt(duration) {
    Object.assign(pvt, { running: true, trials: [], onset: null, start: performance.now(), duration, feedback: "Wait for the counter, then tap or press space." });
    render(); pvtStage.focus(); schedule();
  }
  function schedule() {
    clearTimeout(pvt.timer);
    if (performance.now() - pvt.start >= pvt.duration) { finishPvt(true); return; }
    const isi = PVT_B.isiMinMs + Math.random() * (PVT_B.isiMaxMs - PVT_B.isiMinMs);
    pvt.timer = setTimeout(() => {
      // Onset is stamped when the stimulus is shown; animation frames only drive the counter,
      // so throttled frames cannot turn real responses into early taps.
      pvtStage.classList.add("sc-on"); pvt.onset = performance.now();
      const tick = () => { if (pvt.onset === null) return; pvtStage.dataset.count = String(Math.round(performance.now() - pvt.onset)); pvt.raf = requestAnimationFrame(tick); };
      tick();
      pvt.timer = setTimeout(() => { if (pvt.onset !== null) record(PVT_B.timeoutMs); }, PVT_B.timeoutMs);
    }, isi);
  }
  function record(rtMs) {
    cancelAnimationFrame(pvt.raf); pvtStage.classList.remove("sc-on");
    pvt.trials.push({ rtMs }); pvt.onset = null; pvt.feedback = `${Math.round(rtMs)} ms`; pvtStage.dataset.count = pvt.feedback; schedule();
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
    if (!pvt.running) return; pvt.running = false;
    applyPvt(summarizePvt(pvt.trials, { durationMs: pvt.duration, completed }), "TEST · this device");
  }
  function stopPvt(silent) { if (pvt.running) { if (silent) { pvt.running = false; clearTimeout(pvt.timer); cancelAnimationFrame(pvt.raf); } else finishPvt(false); } }
  function applyPvt(summary, source) {
    state.pvt = { ...summary, source };
    Object.assign(state.check.values, { pvtSpeed: summary.meanSpeed, pvtLapses: summary.lapses });
    Object.assign(state.check.quality, { pvtSpeed: summary.usable, pvtLapses: summary.usable });
    Object.assign(state.check.protocols, { pvtSpeed: summary.protocol, pvtLapses: summary.protocol });
    state.check.sources.reaction = source; render();
  }

  // ---------- Save & follow-up ----------
  function saveCheck() {
    if (state.saved || !state.evaluation) return;
    const profileId = state.profile === "elena" ? "DEMO-ELENA" : "you";
    const checks = state.profile === "elena" ? store.load(profileId, false) : history();
    checks.push({ ...state.check, at: new Date().toISOString(), evaluation: { overall: state.evaluation.overall, domains: state.evaluation.domains.map(d => ({ key: d.key, status: d.status })) } });
    store.save(profileId, checks, state.profile === "elena" ? false : state.persist);
    const now = Date.now();
    state.followUps = [...element.querySelectorAll("[data-action]:checked")].map(input => {
      const action = state.evaluation.actions.find(a => a.id === input.dataset.action);
      return { ...action, recordedAt: new Date(now).toISOString(), dueAt: action.due === null ? null : new Date(now + action.due * 3600e3).toISOString(), status: "open" };
    });
    state.saved = true; render();
  }
  function exportJson() {
    const packet = { schema: "astrobone-self-check-export-v1", profile: state.profile === "elena" ? "DEMO-ELENA (synthetic)" : "This device", check: state.check, evaluation: state.evaluation, followUps: state.followUps,
      boundary: "Self-monitoring record. Review triggers are engineering defaults, not clinical thresholds. Not a diagnosis.", exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
    const a = el("a", { href: url, download: `AstroBone-self-check-${state.profile}-${Date.now()}.json` }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Rendering ----------
  function stepBody() {
    const [key] = STEPS[state.step], c = state.check, demo = state.profile === "elena";
    if (key === "safety") {
      return [el("p", { class: "sc-lead" }, "Right now, do you have any of these?"),
        el("div", { class: "sc-checks" }, RED_FLAGS.map(([k, label]) => checkbox(`rf-${k}`, label, Boolean(c.redFlags?.[k]), value => { c.redFlags = { ...(c.redFlags || {}), [k]: value }; render(); }))),
        Object.values(c.redFlags || {}).some(Boolean) ? el("p", { class: "sc-urgent", role: "alert" }, "Contact your crew medical officer now. Finish the check only if it is safe to do so.") : null,
        el("button", { type: "button", class: "sc-secondary", onclick: () => { c.redFlags = {}; go(1); } }, "None of these · continue")];
    }
    if (key === "movement") {
      const cap = state.capture, usable = cap && !cap.capturing && c.quality.kneeExtension;
      const camOn = camera?.running;
      return [el("p", { class: "sc-lead" }, "Seated knee extension, 10 seconds. Sit side-on or facing the camera with both legs visible. Straighten and bend both knees slowly."),
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
          el("p", {}, usable ? `Knee extension ${fmt(cap.kneeExtension)}° · range of motion ${fmt(cap.kneeRom)}° · tracking quality ${fmt(cap.trackingQuality, 2)} · ${cap.sampleCount} samples`
            : `Tracking quality ${fmt(cap.trackingQuality, 2)} with ${cap.sampleCount} usable samples is below the quality rule (≥ 0.70 and ≥ 12 samples). A worse-looking number from a poor capture is not treated as a health change.`),
          el("small", {}, `${cap.source} · attempt ${state.captures}`)) : null,
        el("p", { class: "sc-note" }, "Video stays on this device. Only the summary angles are kept.")];
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
          el("p", {}, `${result.validResponses} valid responses · ${result.falseStarts} early · median ${result.medianRtMs ?? "--"} ms · ${result.protocol === "pvt-b-3min" ? "3-minute protocol" : "practice length (only compared with practice runs)"}`),
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
      return [el("fieldset", { class: "sc-fieldset" }, el("legend", {}, "New since your last check"),
          IMMUNE_SYMPTOMS.map(([k, label]) => checkbox(`sym-${k}`, label, Boolean(c.symptoms?.[k]), value => { c.symptoms = { ...(c.symptoms || {}), [k]: value }; })),
          el("button", { type: "button", class: "sc-link", onclick: () => { c.symptoms = {}; render(); } }, "None of these")),
        number("Resting heart rate", "bpm", v.restingHr, 30, 200, 1, value => { v.restingHr = value; c.protocols.restingHr = c.protocols.restingHr ?? "resting-self-reported-v1"; }),
        el("label", { class: "sc-text" }, "Heart-rate source",
          el("select", { onchange: e => { c.sources.restingHr = e.target.value; } }, ["Wearable or chest strap", "Pulse oximeter", "Manual pulse count", "Synthetic demo"].map(s => el("option", { selected: (c.sources.restingHr ?? (demo ? "Synthetic demo" : "Wearable or chest strap")) === s || undefined }, s)))),
        number("Personal dosimeter, cumulative (context only)", "mGy", c.dosimeter, 0, 10000, 0.01, value => { c.dosimeter = value; }),
        el("p", { class: "sc-note" }, "Radiation dose is recorded as mission context. It is never turned into a health status.")];
    }
    return resultBody();
  }

  function resultBody() {
    const ev = state.evaluation; if (!ev) return [];
    const [label, detail] = STATUS[ev.overall];
    return [el("div", { class: `sc-overall sc-${ev.overall}` }, el("strong", {}, label), el("span", {}, ev.overall === "stable" ? "No change outside your usual range" : detail)),
      ev.redFlags.length ? el("p", { class: "sc-urgent", role: "alert" }, `Reported: ${ev.redFlags.join("; ")}.`) : null,
      el("div", { class: "sc-domains" }, ev.domains.map(d => el("section", { class: `sc-domain sc-${d.status}` },
        el("header", {}, el("b", {}, d.label), el("em", {}, STATUS[d.status][0])), el("small", {}, d.hazard),
        d.key === "immune" ? el("p", {}, d.status === "notChecked" ? "Symptoms not answered." : d.symptoms.length ? d.symptoms.join(", ") : "No new symptoms reported.")
          : el("ul", {}, d.indicators.filter(r => r.status !== "notChecked").map(r => el("li", { class: `sc-${r.status}` },
            el("span", {}, r.def.label), el("b", {}, `${fmt(r.value, r.def.digits ?? 0)}${r.def.unit}`),
            el("small", {}, r.status === "baseline" ? `baseline ${r.ref.count}/${r.ref.needed}` : r.status === "repeat" ? "quality failed" : `usual ${fmt(r.ref.mean, r.def.digits ?? 0)} ± ${fmt(r.tolerance, r.def.digits ?? 1)}`)))),
        d.key !== "immune" && !d.indicators.some(r => r.status !== "notChecked") ? el("p", {}, "Not checked.") : null))),
      el("section", { class: "sc-actions" }, el("h3", {}, "Your next step"),
        ev.actions.map(a => el("label", { class: `sc-action sc-${a.priority}` }, el("input", { type: "checkbox", "data-action": a.id, checked: (a.priority !== "info" || a.id === "routine") || undefined, disabled: state.saved || undefined }), el("span", {}, a.text)))),
      state.saved ? el("div", { class: "sc-result" }, el("strong", {}, "Saved"), el("p", {}, state.followUps.length ? state.followUps.map(f => `${f.text.split(".")[0]}${f.dueAt ? ` · due ${new Date(f.dueAt).toLocaleString()}` : ""}`).join(" | ") : "No follow-up selected."),
        el("small", {}, state.profile === "elena" ? "Demo record kept in memory for this tab." : state.persist ? "Saved on this device." : "Kept in memory for this tab (saving on this device is off)."))
        : el("button", { type: "button", class: "sc-primary", onclick: saveCheck }, "Save check & selected actions"),
      el("div", { class: "sc-row" }, el("button", { type: "button", class: "sc-secondary", onclick: exportJson }, "Export for reviewer (JSON)"), el("button", { type: "button", class: "sc-secondary", onclick: reset }, "New check")),
      el("p", { class: "sc-note" }, "Review triggers: outside 2× your own spread or a minimum change, whichever is larger, after 3 usable checks. Engineering defaults, not clinical thresholds. AstroBone does not diagnose or prescribe."),
      state.profile === "elena" ? el("p", { class: "sc-note" }, ELENA_SELF_CHECK_BOUNDARY) : null];
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
      el("button", { type: "button", "aria-pressed": String(state.profile === "elena"), onclick: () => { if (state.profile !== "elena") { state.profile = "elena"; reset(); } } }, "Elena · synthetic demo"),
      el("button", { type: "button", "aria-pressed": String(state.profile === "you"), onclick: () => { if (state.profile !== "you") { state.profile = "you"; reset(); } } }, "You · this device"));
    const consent = state.profile === "you" ? el("label", { class: "sc-consent" }, el("input", { type: "checkbox", checked: state.persist || undefined, onchange: e => {
      state.persist = e.target.checked; try { localStorage.setItem("astrobone-self-check-consent", state.persist ? "1" : "0"); } catch { /* storage unavailable */ } render();
    } }), `Save my checks on this device (${history().length} saved)`) : null;
    const nav = STEPS[state.step][0] === "result" ? null : el("div", { class: "sc-nav" },
      state.step > 0 ? el("button", { type: "button", class: "sc-secondary", onclick: () => go(state.step - 1) }, "Back") : el("span"),
      el("button", { type: "button", class: "sc-primary", "data-next": true, onclick: () => go(state.step + 1) }, state.step === STEPS.length - 2 ? "Evaluate" : "Next"));
    element.replaceChildren(...[profile, consent, steps, el("div", { class: "sc-body" }, stepBody()), nav].filter(Boolean));
    // Re-inserting a media element pauses it; resume the live preview.
    if (camera?.running && video.paused) video.play().catch(() => {});
    if (!pvt.running && !pvtStage.dataset.count) pvtStage.dataset.count = "Ready";
  }

  reset();
  return {
    element, reset, go, demoCapture, applyDemoPvt: () => applyPvt(ELENA_PVT, "SYNTHETIC DEMO"), saveCheck,
    setProfile(profile) { if (state.profile !== profile) { state.profile = profile; reset(); } },
    stop() { stopCamera(); stopPvt(true); },
    get state() { return state; },
    latestEvaluation(profile = state.profile) {
      if (state.evaluation && state.profile === profile) return state.evaluation;
      return profile === "elena" ? evaluateSelfCheck(elenaDay147(), ELENA_HISTORY) : null;
    },
  };
}

export const SELF_CHECK_INDICATORS = INDICATORS;
