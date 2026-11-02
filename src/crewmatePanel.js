// Crewmate check panel: the challenge's scenario, "a crewmate suddenly has chest pain or pain somewhere
// else: what do you do?" Four short steps on one page (pain, warning signs, a camera minute and a
// reading), then the level, the reasons, what to do next and a handoff for the medical officer.
import { PAIN_SITES, QUALITIES, SPREADS, ASSOCIATED, ONSETS, LEVELS, assessCrewmate, handoffText, DEMO_CREWMATE } from "./crewmateCheck.js";
import { summarizeFaceCues, compareFaceCues } from "./faceCues.js";
import { READING_PASSAGE, PASSAGE_SOURCE, createSpeechRecorder, loadSileroVad, vadSegments, energyProbabilities, speechMetrics, compareSpeech } from "./speechCheck.js";
import { ENVIRONMENTS } from "./missionEnvironment.js";
import { STATUS_MARKS } from "./historyChart.js";

const STORE = "astrobone-crewmate-baselines";
const MARK = { now: STATUS_MARKS.urgent.glyph, today: STATUS_MARKS.attention.glyph, watch: STATUS_MARKS.changed.glyph };
const CUE_MARK = { changed: STATUS_MARKS.changed, stable: STATUS_MARKS.stable, baseline: STATUS_MARKS.baseline };
const SYSTEM_LABEL = { cardiovascular: "Heart and vessels", skeleton: "Bones", muscle: "Muscles", renal: "Kidneys", multisystem: "Whole body", nervous: "Nervous system" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value; else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child?.nodeType ? child : String(child));
  return node;
}
const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? "{}") ?? {}; } catch { return {}; } };
const writeStore = data => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* private mode */ } };

export function createCrewmatePanel({ onAssess = () => {}, onSystem = () => {}, onCameraActive = () => {} } = {}) {
  const state = { name: "Crewmate", environment: "station", input: { qualities: [], spreads: [], associated: [], severity: null, minutes: null }, measures: {}, measured: {}, demo: false, wellBaseline: false };
  const root = el("div", { class: "cm" });
  let camera = null, recorder = null, vad = null;

  // --- 0. Who and where
  const nameInput = el("input", { type: "text", value: state.name, maxlength: 40, "aria-label": "Crewmate's name", oninput: e => { state.name = e.target.value.trim() || "Crewmate"; update(); } });
  const envSelect = el("select", { "aria-label": "Where the crew is", onchange: e => { state.environment = e.target.value; update(); } },
    ENVIRONMENTS.map(env => el("option", { value: env.key, selected: env.key === state.environment || undefined }, `${env.label} · ${env.place}`)));
  const intro = el("section", { class: "cm-intro" },
    el("p", {}, "Your crewmate suddenly has chest pain, or pain somewhere else. Work through the four steps together. AstroBone shows how fast to involve the crew medical officer and flight surgeon, which body systems to look at, and writes the summary they will ask for. It does not identify a condition; your crewmate's own words come first."),
    el("div", { class: "cm-who" }, el("label", {}, el("span", {}, "Crewmate"), nameInput), el("label", {}, el("span", {}, "Where"), envSelect)),
    el("button", { type: "button", class: "tw-secondary cm-demo", onclick: () => loadDemo() }, "Show a worked example (synthetic)"));

  // --- 1. Pain
  const chip = (group, key, label, multi) => el("button", { type: "button", class: "cm-chip", "data-group": group, "data-key": key, "aria-pressed": "false", onclick: () => toggle(group, key, multi) }, label);
  const severity = el("input", { type: "range", min: 0, max: 10, step: 1, value: 0, "aria-label": "Pain from 0 to 10", oninput: e => { state.input.severity = Number(e.target.value); update(); } });
  const severityOut = el("output", {}, "not set");
  const minutes = el("input", { type: "number", min: 0, max: 1440, step: 1, placeholder: "min", "aria-label": "Minutes since it started", oninput: e => { state.input.minutes = e.target.value === "" ? null : Number(e.target.value); update(); } });
  const step1 = el("section", { class: "cm-step" }, el("h3", {}, el("b", {}, "1"), " Where and how does it hurt?"),
    el("small", {}, "Tap the place. The twin turns to the systems there."),
    el("div", { class: "cm-chips", role: "group", "aria-label": "Where it hurts" }, PAIN_SITES.map(s => chip("site", s.key, s.label, false))),
    el("div", { class: "cm-chips", role: "group", "aria-label": "How it started" }, ONSETS.map(([k, l]) => chip("onset", k, l, false))),
    el("small", {}, "What does it feel like?"),
    el("div", { class: "cm-chips", role: "group", "aria-label": "What it feels like" }, QUALITIES.map(([k, l]) => chip("qualities", k, l, true))),
    el("small", {}, "Does it spread anywhere?"),
    el("div", { class: "cm-chips", role: "group", "aria-label": "Where it spreads" }, SPREADS.map(([k, l]) => chip("spreads", k, l, true))),
    el("div", { class: "cm-scale" }, el("label", {}, el("span", {}, "How bad, 0-10"), severity, severityOut), el("label", {}, el("span", {}, "Started minutes ago"), minutes)));

  // --- 2. Warning signs
  const step2 = el("section", { class: "cm-step" }, el("h3", {}, el("b", {}, "2"), " Anything else?"),
    el("small", {}, "Ask, and look. Each of these changes how fast to get help."),
    el("div", { class: "cm-chips", role: "group", "aria-label": "Other signs" }, ASSOCIATED.map(([k, l]) => chip("associated", k, l, true))));

  // --- 3. Camera minute
  const video = el("video", { class: "cm-video", muted: true, playsinline: true, "aria-label": "Camera preview" });
  const camStatus = el("p", { class: "cm-status", role: "status" }, "One minute facing the camera, still, in steady light: pulse and face cues.");
  const camButton = el("button", { type: "button", class: "tw-primary", onclick: () => runCamera() }, "Start the camera minute");
  const camResult = el("div", { class: "cm-cues" });
  const breathCount = el("input", { type: "number", min: 0, max: 40, step: 1, placeholder: "breaths", "aria-label": "Breaths counted in 30 seconds", oninput: e => { const n = Number(e.target.value); state.measures.breathing = e.target.value === "" ? null : { rate: n * 2, counted: true }; state.measured.breathing = e.target.value === "" ? null : `${n * 2} a minute (counted for 30 s)`; update(); } });
  const breathTimer = el("button", { type: "button", class: "tw-secondary", onclick: () => countdown(breathTimer, 30) }, "30 s timer");
  const wellBox = el("input", { type: "checkbox", onchange: e => { state.wellBaseline = e.target.checked; } });
  const step3 = el("section", { class: "cm-step" }, el("h3", {}, el("b", {}, "3"), " Camera minute"),
    el("div", { class: "cm-cam" }, video, el("div", {}, camStatus, camButton, camResult)),
    el("div", { class: "cm-breath" }, el("span", {}, "Breathing: watch the chest and count breaths for 30 s."), breathTimer, breathCount),
    el("small", { class: "cm-note" }, "Breathing is counted by you: the camera's head-movement breathing estimate did worse than a fixed guess on 40 recorded people, so it is not used. Face cues are compared with this crewmate's own earlier checks, so they mean little the first time."),
    el("label", { class: "cm-well" }, wellBox, " This is a routine check and my crewmate feels well: keep it as their baseline"));

  // --- 4. Reading
  const speechStatus = el("p", { class: "cm-status", role: "status" }, "Read this aloud at a normal pace (up to 25 s).");
  const speechButton = el("button", { type: "button", class: "tw-primary", onclick: () => runSpeech() }, "Start reading");
  const speechResult = el("div", { class: "cm-cues" });
  const step4 = el("section", { class: "cm-step" }, el("h3", {}, el("b", {}, "4"), " Read aloud"),
    el("blockquote", { class: "cm-passage" }, READING_PASSAGE), el("small", { class: "cm-note" }, PASSAGE_SOURCE),
    speechStatus, speechButton, speechResult,
    el("small", { class: "cm-note" }, "Pauses come from Silero VAD, a pretrained speech detector, running on this device; audio never leaves it. Repeated words are counted only when the browser can transcribe."));

  // --- Result
  const result = el("section", { class: "cm-result", "aria-live": "polite" });
  root.append(intro, step1, step2, step3, step4, result);

  function toggle(group, key, multi) {
    state.demo = false;
    if (multi) { const list = state.input[group]; const i = list.indexOf(key); if (i >= 0) list.splice(i, 1); else list.push(key); }
    else state.input[group] = state.input[group] === key ? null : key;
    update();
  }
  function syncChips() {
    root.querySelectorAll(".cm-chip").forEach(b => {
      const v = state.input[b.dataset.group];
      b.setAttribute("aria-pressed", String(Array.isArray(v) ? v.includes(b.dataset.key) : v === b.dataset.key));
    });
    severity.value = String(state.input.severity ?? 0); severityOut.textContent = state.input.severity == null ? "not set" : `${state.input.severity} / 10`;
    minutes.value = state.input.minutes ?? ""; nameInput.value = state.name; envSelect.value = state.environment;
  }

  function countdown(button, seconds) {
    const end = Date.now() + seconds * 1000; button.disabled = true;
    const tick = () => { const left = Math.ceil((end - Date.now()) / 1000); button.textContent = left > 0 ? `${left} s… count` : "Done: enter the count"; if (left > 0) setTimeout(tick, 250); else { button.disabled = false; breathCount.focus(); } };
    tick();
  }

  async function runCamera() {
    camButton.disabled = true; state.demo = false;
    try {
      if (!camera) { const { createCameraPulse } = await import("./cameraPulse.js"); camera = createCameraPulse({ video, onStatus: t => { camStatus.textContent = t; } }); }
      await camera.start(); onCameraActive(true);
      camStatus.textContent = "Hold still and look at the camera…";
      const r = await camera.measure(60, ({ elapsed, live }) => { camStatus.textContent = `${Math.round(elapsed)} / 60 s${live?.status === "estimated" ? ` · pulse about ${live.bpm} bpm` : ""}`; });
      camera.stop(); onCameraActive(false);
      const face = summarizeFaceCues(r.cues ?? []);
      const store = readStore(), mine = store[state.name] ?? { face: [], speech: [], hr: [] };
      state.measures.pulse = r.status === "estimated" && r.quality >= 0.3 ? { status: "estimated", bpm: r.bpm, quality: r.quality } : { status: "insufficient", reason: r.reason ?? "Pulse signal too weak" };
      state.measures.baselineHr = mine.hr.length >= 2 ? [...mine.hr].sort((a, b) => a - b)[Math.floor(mine.hr.length / 2)] : null;
      state.measures.face = compareFaceCues(face, mine.face);
      state.measured.pulse = state.measures.pulse.status === "estimated" ? `${Math.round(r.bpm)} bpm, quality ${r.quality.toFixed(2)}${state.measures.baselineHr ? ` (usual ${state.measures.baselineHr})` : ""}` : `not read (${state.measures.pulse.reason})`;
      state.measured.face = face.status === "measured" ? state.measures.face.filter(c => c.status === "changed").map(c => c.label.toLowerCase()).join(", ") || "close to usual or first check" : face.reason;
      if (state.wellBaseline) {
        if (face.status === "measured") mine.face = [...mine.face, face].slice(-10);
        if (state.measures.pulse.status === "estimated") mine.hr = [...mine.hr, Math.round(r.bpm)].slice(-10);
        store[state.name] = mine; writeStore(store);
      }
      renderCues(camResult, [
        state.measures.pulse.status === "estimated" ? { label: "Pulse", status: "measured", text: `${Math.round(r.bpm)} bpm (quality ${r.quality.toFixed(2)})` } : { label: "Pulse", status: "none", text: state.measures.pulse.reason },
        ...(face.status === "measured" ? state.measures.face : [{ label: "Face", status: "none", text: face.reason }])]);
      camStatus.textContent = "Camera minute done.";
    } catch (error) { camera?.stop(); onCameraActive(false); camStatus.textContent = `Camera unavailable: ${error.message}`; }
    camButton.disabled = false; camButton.textContent = "Repeat the camera minute"; update();
  }

  async function runSpeech() {
    if (recorder) { recorder.stop(); return; }
    state.demo = false;
    try {
      recorder = createSpeechRecorder({ onLevel: v => speechButton.style.setProperty("--level", String(Math.min(1, v * 8))) });
      speechButton.textContent = "Done reading"; speechStatus.textContent = "Listening… read the passage.";
      const rec = await recorder.start(); recorder = null; speechButton.textContent = "Read again"; speechStatus.textContent = "Measuring pauses…";
      let probs, detector = "silero-vad-v5";
      try {
        if (!vad) { const ort = await import("onnxruntime-web"); ort.env.wasm.numThreads = 1; vad = await loadSileroVad(ort, `${import.meta.env.BASE_URL}models/silero-vad/silero_vad.onnx`); }
        probs = await vad.probabilities(rec.samples);
      } catch { probs = energyProbabilities(rec.samples); detector = "energy (Silero VAD did not load)"; }
      const m = speechMetrics(vadSegments(probs), { transcript: rec.transcript, detector });
      const store = readStore(), mine = store[state.name] ?? { face: [], speech: [], hr: [] };
      state.measures.speech = compareSpeech(m, mine.speech);
      if (state.wellBaseline && m.status === "measured") { mine.speech = [...mine.speech, m].slice(-10); store[state.name] = mine; writeStore(store); }
      state.measured.speech = m.status === "measured" ? `${m.seconds} s to read, pauses ${Math.round(m.pauseShare * 100)} % of it, longest ${(m.longestPauseMs / 1000).toFixed(1)} s${m.transcribed ? `, ${m.repeatedWords} repeated words` : ""}` : m.reason;
      speechStatus.textContent = m.status === "measured" ? `Measured with ${m.detector}.` : m.reason;
      renderCues(speechResult, m.status === "measured" ? [{ label: "Reading", status: "measured", text: state.measured.speech }, ...state.measures.speech] : []);
    } catch (error) { recorder = null; speechButton.textContent = "Start reading"; speechStatus.textContent = `Microphone unavailable: ${error.message}`; }
    update();
  }

  function renderCues(host, rows) {
    host.replaceChildren(...rows.map(r => {
      const mark = CUE_MARK[r.status];
      return el("div", { class: `cm-cue cm-cue-${r.status}` }, el("em", {}, mark ? `${mark.glyph} ${mark.word}` : r.status === "measured" ? "● MEASURED" : "– NOT READ"), el("span", {}, r.text));
    }));
  }

  function loadDemo() {
    const d = DEMO_CREWMATE;
    state.demo = true; state.name = d.name; state.environment = d.input.environment;
    state.input = { site: d.input.site, onset: d.input.onset, qualities: [...d.input.qualities], spreads: [...d.input.spreads], associated: [...d.input.associated], severity: d.input.severity, minutes: d.input.minutes };
    state.measures = structuredClone(d.measures); state.measured = { ...d.measured };
    breathCount.value = String(d.measures.breathing.rate / 2);
    renderCues(camResult, [{ label: "Pulse", status: "measured", text: `${d.measures.pulse.bpm} bpm (quality ${d.measures.pulse.quality}) · usual ${d.measures.baselineHr}` }, ...d.measures.face]);
    renderCues(speechResult, [{ label: "Reading", status: "measured", text: d.measured.speech }, ...d.measures.speech]);
    camStatus.textContent = "Synthetic example values, not a measurement."; speechStatus.textContent = "Synthetic example values, not a measurement.";
    update();
    result.scrollIntoView?.({ block: "nearest" });
  }

  let last = null;
  function update() {
    syncChips();
    const input = { ...state.input, environment: state.environment, measures: state.measures };
    const touched = state.input.site || state.input.associated.length || state.input.qualities.length || state.measures.pulse;
    if (!touched) { result.replaceChildren(el("p", { class: "cm-empty" }, "Start with step 1: where it hurts.")); last = null; onAssess(null); return; }
    const a = assessCrewmate(input); last = a;
    const text = handoffText({ name: state.name, assessment: a, input: state.input, measured: state.measured });
    const copy = el("button", { type: "button", class: "tw-secondary", onclick: async () => { try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; } catch { copy.textContent = "Select the text to copy"; } } }, "Copy summary");
    const save = el("button", { type: "button", class: "tw-secondary", onclick: () => { const url = URL.createObjectURL(new Blob([text], { type: "text/plain" })); const link = el("a", { href: url, download: "astrobone-crewmate-check.txt" }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } }, "Download");
    result.replaceChildren(
      el("div", { class: `cm-level cm-level-${a.level}` }, el("em", {}, `${MARK[a.level]} ${a.word}`), el("strong", {}, a.headline), state.demo ? el("small", {}, "Synthetic example") : null),
      el("div", { class: "cm-systems", role: "group", "aria-label": "Systems to look at on the twin" }, el("span", {}, "Look at:"),
        // The twin has no nervous-system anatomy; its Nervous view turns to the head and lists the brain checks.
        a.systems.map(s => s === "nervous" ? el("button", { type: "button", class: "cm-sys", title: "The twin has no separate nervous-system model; this shows the head", onclick: () => onSystem("nervous", "head") }, "Head and nerves")
          : el("button", { type: "button", class: "cm-sys", onclick: () => onSystem(s, a.focus) }, SYSTEM_LABEL[s] ?? s))),
      el("h4", {}, "Why"), el("ul", { class: "cm-reasons" }, a.reasons.map(r => el("li", { class: `cm-r-${r.level}${r.kind === "context" ? " cm-r-context" : ""}` }, el("em", {}, r.kind === "measured" ? "MEASURED" : r.kind === "context" ? "CONTEXT" : "SAID"), r.text))),
      el("h4", {}, "Do next"), el("ol", { class: "cm-steps" }, a.steps.map(s => el("li", {}, s))),
      el("h4", {}, "Summary for the medical officer"), el("pre", { class: "cm-handoff", tabindex: "0" }, text), el("div", { class: "cm-actions" }, copy, save));
    onAssess(a);
  }

  update();
  return {
    element: root, loadDemo, get assessment() { return last; },
    reset() { state.input = { qualities: [], spreads: [], associated: [], severity: null, minutes: null }; state.measures = {}; state.measured = {}; state.demo = false; camResult.replaceChildren(); speechResult.replaceChildren(); breathCount.value = ""; update(); },
    stop() { camera?.stop(); onCameraActive(false); if (recorder) recorder.stop(); },
  };
}
