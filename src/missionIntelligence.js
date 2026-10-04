import { ELENA } from "./elenaMissionScenario.js";
import { initialMissionState, deriveMission, astraAnswer, SYSTEMS } from "./missionIntelligenceState.js";
import { createMissionHuman } from "./missionHuman.js";
import { renderResearchExplorer } from "./missionResearchExplorer.js";
import { renderCirculationReference } from "./circulationReferencePanel.js";
import "./missionIntelligence.css";

const el = (tag, text = "", cls = "") => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
const link = (label, url) => { const n = el("a", label); n.href = url; n.target = "_blank"; n.rel = "noopener noreferrer"; return n; };
const labels = { multisystem: "Multisystem", outer: "Outer body", skeletal: "Skeletal", muscular: "Muscular", cardiovascular: "Cardiovascular", radiation: "Radiation context", movement: "Movement" };
const days = ELENA.observations.map(row => row.day.value);

export function createMissionIntelligence({ getExternal, ready, onResearch, onCapture }) {
  const root = el("main", "", "mi-console"); root.id = "mission-intelligence"; root.hidden = true;
  root.innerHTML = `<header class="mi-top"><a href="#mission-demo" class="mi-brand">ASTROBONE<span>MISSION INTELLIGENCE</span></a><div class="mi-mission">ARES TRANSIT-1<small>Earth-to-Mars transit</small></div><div class="mi-live"><span>Onboard analysis</span><span id="mi-cache">Evidence loading</span></div><button id="mi-earth" type="button" aria-pressed="false">Earth link / demo</button><button id="mi-research" type="button">Research Lab</button></header>
    <div class="mi-identity"><div><span class="mi-eyebrow">SYNTHETIC MISSION DEMONSTRATION</span><h1>Commander Elena Torres</h1></div><div class="mi-day">DAY <strong id="mi-day">147</strong><span>/ 240</span></div></div>
    <div id="mi-mode" role="status" hidden></div>
    <div class="mi-core"><section class="mi-human"><header><span class="mi-eyebrow">HUMAN SYSTEMS VIEW</span><span id="mi-layer-kind">VISUAL CONTEXT</span></header><div id="mi-human-stage" class="mission-human-stage"></div><div class="mi-layer-tabs" role="group" aria-label="Anatomical systems"></div><footer><span>Reference anatomy / not personal internal measurements</span><a href="${import.meta.env.BASE_URL}models/anatomy/SOURCE-LICENSE.txt" target="_blank" rel="noopener noreferrer">Anatomy credits</a></footer></section>
    <section class="mi-health"><header><span class="mi-eyebrow">MISSION HEALTH STATE</span><span class="mi-derived">DERIVED</span></header><h2 id="mi-verdict"></h2><p id="mi-observation"></p><div class="mi-domains"></div><div class="mi-verification"><span id="mi-gates"></span><button id="mi-verify" type="button">Inspect gates</button></div><div class="mi-primary-actions"><button id="mi-why" class="mi-primary" type="button">Why did my status change?</button><button id="mi-handoff" type="button">Prepare handoff</button></div><section class="mi-astra"><header><strong>ASTRA</strong><span>Structured local assistant</span></header><div class="mi-astra-actions"></div><p id="mi-astra-response" aria-live="polite"></p><small id="mi-astra-source"></small></section></section></div>
    <section class="mi-timeline"><header><div><span class="mi-eyebrow">MISSION TIMELINE</span><small>Authored checkpoints / later days are scenarios, not predictions</small></div><div><button id="mi-play" title="Play recorded mission checkpoints" type="button">Play timeline</button><button id="mi-current" type="button">Day 147</button></div></header><input id="mi-slider" type="range" min="0" max="7" step="1" aria-label="Mission checkpoint"><div class="mi-milestones"></div><div id="mi-event-marker"></div><canvas id="mi-trend" height="85" role="img"></canvas><small>DERIVED from SYNTHETIC DEMO / knee extension, degrees / recorded checkpoints only</small></section>
    <nav class="mi-tools" aria-label="Mission tools"><button id="mi-evidence" type="button">Evidence graph</button><button id="mi-origin" type="button">Data origin</button><button id="mi-event" type="button">Simulate space-weather event</button><button id="mi-lab" type="button">Scenario Lab</button><button id="mi-demo" type="button">Play demo</button><button id="mi-reset" type="button">Reset demo</button></nav><p class="mi-event-boundary">Event simulator: synthetic mission scenario only. No live space-weather feed.</p>
    <details class="mi-log"><summary>Mission event log</summary><div id="mi-log-rows"></div></details>
    <footer class="mi-bottom"><span>No diagnosis or autonomous treatment. Human medical review required.</span><button id="mi-limits" type="button">Scope & limitations</button></footer>
    <dialog class="mi-dialog" id="mi-dialog" aria-labelledby="mi-dialog-title"><header><div><span class="mi-eyebrow" id="mi-dialog-tag"></span><h2 id="mi-dialog-title"></h2></div><button type="button" id="mi-close" title="Close panel" aria-label="Close panel">&#215;</button></header><div id="mi-dialog-body"></div></dialog>`;
  document.body.append(root);
  const $ = id => root.querySelector(`#${id}`), dialog = $("mi-dialog"), viewer = createMissionHuman($("mi-human-stage"));
  let state = initialMissionState(), active = false, result, selectedPanel = null, answer = null, timer = null, demoTimer = null, sequenceIndex = 0, disposePanel = () => {};
  dialog.addEventListener("close", () => { disposePanel(); disposePanel = () => {}; });
  const layerButtons = root.querySelector(".mi-layer-tabs");
  for (const system of SYSTEMS) { const button = el("button", labels[system]); button.type = "button"; button.dataset.system = system; button.onclick = () => { state.system = system; render(); }; layerButtons.append(button); }
  for (const day of days) { const button = el("button", `DAY ${day}`); button.type = "button"; button.dataset.checkpoint = day; button.onclick = () => setDay(day); root.querySelector(".mi-milestones").append(button); }
  for (const [kind, text] of [["evidence", "Show evidence"], ["missing", "Missing data"], ["recheck", "Recheck"], ["baseline", "Compare baseline"]]) {
    const button = el("button", text); button.type = "button"; button.dataset.astra = kind; button.onclick = () => { answer = kind; render(); }; root.querySelector(".mi-astra-actions").append(button);
  }
  function stop() { clearInterval(timer); clearTimeout(demoTimer); timer = demoTimer = null; $("mi-play").textContent = "Play timeline"; $("mi-demo").textContent = "Play demo"; }
  function setDay(day) { if (!days.includes(day)) return; state.day = day; answer = null; render(); }
  function reset() { stop(); state = initialMissionState(); answer = null; selectedPanel = null; dialog.close(); root.querySelector(".mi-log").open = false; viewer.resetView?.(); render(); }
  function open(kind) { selectedPanel = kind; if (!dialog.open) dialog.showModal(); renderPanel(); }
  function exportPacket() {
    const packet = { ...result, visualState: state, syntheticSource: ELENA, externalEvidence: getExternal(),
      provenance: "SYNTHETIC DEMO + DERIVED + separate NASA RESEARCH / MODEL OUTPUT", limitation: "No clinical validation or live NASA feed; no records sent remotely." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
    const a = el("a"); a.href = url; a.download = `AstroBone-Elena-Day-${state.day}-${state.lab ? "WHAT-IF" : "SYNTHETIC"}-handoff.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function event() { state.event = { day: state.day, source: "SYNTHETIC DEMO", ...ELENA.event }; state.system = "radiation"; answer = "recheck"; render(); }
  function play() { if (timer || demoTimer) { stop(); return; } setDay(1); $("mi-play").textContent = "Pause timeline"; timer = setInterval(() => { const i = days.indexOf(state.day); if (i === days.length - 1) stop(); else setDay(days[i + 1]); }, 1800); }
  function playDemo() {
    if (demoTimer || timer) { stop(); return; } reset(); setDay(1); $("mi-demo").textContent = "Stop demo"; sequenceIndex = 0;
    const steps = [() => setDay(30), () => setDay(60), () => setDay(90), () => setDay(120), () => setDay(147), () => open("why"), () => open("graph"),
      () => { dialog.close(); answer = "evidence"; render(); }, () => event(), () => open("handoff")];
    const next = () => { steps[sequenceIndex++](); if (sequenceIndex < steps.length) demoTimer = setTimeout(next, 5000); else { demoTimer = null; $("mi-demo").textContent = "Play demo"; } };
    demoTimer = setTimeout(next, 5000);
  }
  function render() {
    const begin = performance.now(); result = deriveMission(state, getExternal());
    root.dataset.day = state.day; root.dataset.system = state.system; root.dataset.lab = String(state.lab);
    $("mi-day").textContent = state.day; $("mi-cache").textContent = result.evidenceReady ? `${result.references.length} NASA datasets / local` : "Evidence incomplete";
    $("mi-cache").dataset.ready = result.evidenceReady;
    $("mi-earth").textContent = state.offline ? "Earth link unavailable / demo" : "Earth link / demo"; $("mi-earth").setAttribute("aria-pressed", String(state.offline));
    $("mi-mode").hidden = !state.offline && !state.lab;
    $("mi-mode").textContent = `${state.lab ? "SCENARIO LAB / main mission record unchanged. " : ""}${state.offline ? `LOCAL MODE / ${result.evidenceReady ? "prepared evidence available in memory" : "evidence unavailable"} / remote medical review pending. Network connection not changed.` : ""}`;
    $("mi-verdict").textContent = result.movement === "INSUFFICIENT DATA" ? "Reassessment required" : result.event ? "Exposure context changed" : state.day === 1 ? "Personal baseline established" : "Longitudinal review required";
    $("mi-observation").textContent = result.observation;
    root.querySelector(".mi-domains").replaceChildren(...[
      ["movement", "Movement", result.movement, result.change ? `${result.change.delta} deg vs Day 1` : "Personal movement record", "DERIVED / SYNTHETIC"],
      ["skeletal", "Skeletal context", "NOT MEASURED", result.references.some(r => r.accession === "OSD-804") ? "OSD-804 / external research" : "Research context unavailable", "NASA RESEARCH / EXTERNAL"],
      ["cardiovascular", "Cardiovascular", result.cardio.current ? "OBSERVE" : "INSUFFICIENT DATA", result.cardiovascular, "SYNTHETIC DEMO"],
      ["radiation", "Radiation exposure", result.radiation, `${result.doseWithEvent ?? "--"} mGy${result.event ? " / event included" : " / cumulative"}`, "SYNTHETIC DEMO"],
    ].map(([system, name, status, detail, provenance]) => {
      const button = el("button", "", "mi-domain"); button.type = "button"; button.dataset.domain = system; button.setAttribute("aria-pressed", String(state.system === system));
      const heading = el("div"); heading.append(el("strong", name), el("span", status)); button.append(heading, el("p", detail), el("small", provenance));
      button.onclick = () => { state.system = system; render(); }; return button;
    }));
    $("mi-gates").textContent = `${result.passed}/${result.gates.length} gates passed / ${result.limitations.length} limitations retained`;
    const response = astraAnswer(answer || "recheck", result); $("mi-astra-response").textContent = response.text; $("mi-astra-source").textContent = `${response.source} / Day ${result.day}`;
    $("mi-slider").value = days.indexOf(state.day); $("mi-slider").setAttribute("aria-valuetext", `Day ${state.day}`);
    root.querySelectorAll("[data-checkpoint]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.checkpoint) === state.day)));
    root.querySelectorAll("[data-system]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.system === state.system)));
    $("mi-event-marker").textContent = state.event ? `DAY ${state.event.day} / SYNTHETIC EVENT +${ELENA.event.increment.value} mGy${state.day < state.event.day ? " / outside selected review" : " / context changed, no damage inferred"}` : "";
    $("mi-layer-kind").textContent = "VISUAL CONTEXT";
    $("mi-log-rows").replaceChildren(...ELENA.observations.map(row => { const button = el("button", `Day ${row.day.value} / ${row.stage.value}`); button.type = "button"; button.onclick = () => setDay(row.day.value); return button; }));
    if (state.event) { const button = el("button", `Day ${state.event.day} / Synthetic space-weather event`); button.onclick = () => setDay(state.event.day); $("mi-log-rows").append(button); }
    viewer.update({ ...result.review, system: state.system, event: Boolean(result.event), day: state.day });
    if (dialog.open) renderPanel();
    root.dataset.derivationMs = (performance.now() - begin).toFixed(2);
    requestAnimationFrame(drawTrend);
  }
  function drawTrend() {
    const canvas = $("mi-trend"), width = canvas.clientWidth; if (!active || width < 1) return;
    const ratio = Math.min(devicePixelRatio, 2); canvas.width = width * ratio; canvas.height = 85 * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, 85);
    const rows = result.data.history.filter(row => row.mission_day <= state.day), x = day => 35 + (day - 1) / 239 * (width - 70), y = value => 62 - (value - 135) * 1.25;
    ctx.font = "11px sans-serif"; ctx.fillStyle = "#a8bfc2"; ctx.fillText("165 deg", 0, 13); ctx.fillText("140 deg", 0, 78);
    ctx.strokeStyle = "#345051"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(50, y(165)); ctx.lineTo(width, y(165)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "#66decf"; ctx.lineWidth = 2; ctx.beginPath();
    rows.forEach((row, i) => { if (row.tracking_quality < .7) return; const p = [x(row.mission_day), y(row.metrics.knee_extension_deg)]; if (!i) ctx.moveTo(...p); else ctx.lineTo(...p); }); ctx.stroke();
    rows.forEach(row => { if (row.tracking_quality < .7) { ctx.fillStyle = "#dfb56a"; ctx.fillText("withheld", x(row.mission_day) - 20, 78); return; } ctx.fillStyle = "#66decf"; ctx.beginPath(); ctx.arc(x(row.mission_day), y(row.metrics.knee_extension_deg), 3, 0, Math.PI * 2); ctx.fill(); });
    canvas.setAttribute("aria-label", rows.map(row => `Day ${row.mission_day}: ${row.tracking_quality < .7 ? "withheld" : row.metrics.knee_extension_deg + " degrees"}`).join("; "));
  }
  function part(parent, name, text, cls = "") { const section = el("section", "", cls); section.append(el("h3", name), el("p", text)); parent.append(section); return section; }
  function renderGates(parent) { const list = el("div", "", "mi-gate-list"); for (const gate of result.gates) { const row = part(list, `${gate.pass ? "PASS" : "WITHHELD"} / ${gate.name}`, gate.detail); row.dataset.pass = gate.pass; } parent.append(list); }
  function sources(parent) {
    for (const source of result.references) { const section = part(parent, source.accession, `${source.population}. ${source.boundary || "External research, not Elena's observations."}`, "mi-source"); section.append(link(source.title, source.url)); }
    if (!result.references.length) part(parent, "INSUFFICIENT EVIDENCE", "No prepared NASA summary is available in this scenario.");
  }
  function renderPanel() {
    if (!result) return;
    disposePanel(); disposePanel = () => {};
    const focused = dialog.contains(document.activeElement) ? document.activeElement.id : null, scrollTop = dialog.scrollTop;
    const body = $("mi-dialog-body"); body.replaceChildren();
    const titles = { why: "Why did the status change?", graph: "Evidence graph", origin: "Data origin", gates: "Verification gates", lab: "Scenario Lab", handoff: "Mission health packet ready", limits: "Scope & limitations", presenter: "Presenter controls", xray: "External X-ray evidence", nasa: "NASA research measurements", circulation: "Circulation reference model" };
    $("mi-dialog-title").textContent = titles[selectedPanel]; $("mi-dialog-tag").textContent = `ELENA TORRES / DAY ${state.day} / ${result.scope}`;
    if (selectedPanel === "nasa") {
      renderResearchExplorer(body, state.lab && state.options.evidenceMissing ? {} : getExternal());
    } else if (selectedPanel === "circulation") {
      disposePanel = renderCirculationReference(body, getExternal().circulation);
    } else if (selectedPanel === "why") {
      const path = el("ol", "", "mi-path");
      for (const [name, text, type] of [["Observation", result.observation, "SYNTHETIC DEMO"], ["Baseline comparison", result.review.comparison.comparable ? "Compatible Day 1 reference. Signed subtraction in degrees, no clinical threshold." : "Comparison withheld / baseline only.", "RULE ENGINE"],
        ["Mission context", `${result.doseWithEvent} mGy / ${result.cardiovascular}. Co-occurrence is not causation.`, "SYNTHETIC DEMO"],
        ["NASA evidence retrieval", result.references.map(r => r.accession).join(" / ") || "Unavailable; no substitute evidence.", "LOCAL RETRIEVAL"],
        ["Verification", `${result.passed} of ${result.gates.length} gates passed. No diagnostic or causal claims allowed.`, "RULE ENGINE"],
        ["Interpretation", "Descriptive changes only. Tissue deterioration and radiation injury are not established.", "CLAIM BOUNDARY"], ["Next action", result.action, "HUMAN DECISION"]]) {
        const row = el("li"); row.append(el("small", type), el("h3", name), el("p", text)); path.append(row);
      } body.append(path); part(body, "Execution trace", result.engine);
    } else if (selectedPanel === "gates") { renderGates(body); result.limitations.forEach(text => part(body, "LIMITATION RETAINED", text));
    } else if (selectedPanel === "graph") {
      const graph = el("div", "", "mi-evidence-graph");
      const center = part(graph, "Elena Torres", `Day ${state.day} / synthetic case`, "mi-graph-center");
      center.append(el("small", "LINKS = review relevance, NOT causation"));
      const families = [["Crew observations", "observation", [["Movement", result.observation], ["Cardiovascular", result.cardiovascular], ["Dosimeter", `${result.doseWithEvent} mGy / synthetic context`]]],
        ["Mission context", "context", [["Microgravity", "Authored mission setting; no biological prediction."], ["Mission duration", `Day ${state.day} of ${ELENA.identity.duration.value}`], ["Space environment", "Context only, no live event feed."]]],
        ["NASA research", "research", result.references.map(r => [r.accession, `${r.population}. ${r.boundary || "External cohort; no individual inference."}`])]];
      const detail = part(body, "Selected evidence", "Select a node to inspect its scope.", "mi-node-detail");
      for (const [name, cls, items] of families) { const column = el("section", "", `mi-graph-family ${cls}`); column.append(el("h3", name)); for (const [label, text] of items) { const button = el("button", label); button.type = "button"; button.onclick = () => { state.evidence = label; detail.replaceChildren(el("h3", label), el("p", text), el("small", cls === "research" ? "NASA RESEARCH / EXTERNAL" : "SYNTHETIC DEMO")); }; column.append(button); } graph.append(column); }
      body.prepend(graph); sources(body);
      const xray = el("button", "Inspect external X-ray / MODEL OUTPUT"); xray.onclick = () => open("xray"); body.append(xray);
    } else if (selectedPanel === "origin") {
      part(body, "PREPARED BEFORE DEMO", `${result.evidenceReady ? "Prepared summaries loaded in memory; no network is needed for this review while the page remains open." : "Some research is unavailable."} No live NASA health feed. Reloading the app still requires its host; this is not an offline-installable app.`);
      const stages = ["NASA OSDR", "OSDR API metadata", "Visible, unrestricted research artifacts", "SHA-256 recorded during preparation", "Deterministic CSV / metadata processing", "Bundled AstroBone summaries", "Local lookup by research domain", "Current review / separate external context"];
      const path = el("ol", "", "mi-path"); stages.forEach(text => { const li = el("li"); li.append(el("h3", text)); path.append(li); });
      const pipeline = el("details"); pipeline.append(el("summary", "Preparation pipeline"), path); body.append(pipeline);
      const ext = getExternal();
      const checks = part(body, "Loaded-file checks", "Schema, units, counts and numerical consistency. Accepted does not mean independently authenticated or clinically validated.");
      checks.id = "mi-artifact-checks";
      for (const [name, check] of Object.entries(ext.validation || {})) {
        const row = el("p", `${name}: ${check.status.toUpperCase()}${check.reason ? ` / ${check.reason}` : ""}`); row.dataset.status = check.status; checks.append(row);
      }
      for (const source of result.references) {
        const box = part(body, source.accession, source.population, "mi-source"); box.append(link("Study", source.url), link("OSDR API file manifest", `https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/${source.accession}/files/`));
        if (source.accession === "OSD-804") { box.append(el("p", "SHA-256 compared against the existing prepared summary during data preparation; not a fresh runtime download."), el("code", ext.bone.source.dataSha256), el("small", ext.bone.source.dataFile)); }
        else { box.append(el("p", "SHA-256 recorded, not authenticated against an independent publisher checksum.")); for (const file of source.sources || []) box.append(link(file.file, file.url), el("code", file.sha256), el("small", `${file.bytes} bytes / unrestricted metadata`)); }
        if (source.method) box.append(el("p", source.method));
      }
      body.append(link("Bundled research JSON", `${import.meta.env.BASE_URL}data/mission-research.json`), link("OSD-804 summary", `${import.meta.env.BASE_URL}data/osdr-804-summary.json`));
    } else if (selectedPanel === "lab") {
      part(body, "WHAT-IF / NOT THE MISSION RECORD", "All changes are isolated synthetic inputs. No saved crew observation is overwritten. Engineering quality rules are not clinical thresholds.");
      const form = el("div", "", "mi-lab-form");
      const check = (name, label, value, change) => { const row = el("label", label), input = el("input"); input.type = "checkbox"; input.id = name; input.checked = value; input.onchange = () => { change(input.checked); render(); }; row.prepend(input); form.append(row); };
      check("mi-lab-enabled", "Enable isolated what-if inputs", state.lab, value => { state.lab = value; });
      check("mi-low-quality", "Low-quality movement assessment", state.options.lowQuality, value => { state.options.lowQuality = value; state.lab = true; });
      check("mi-no-sensor", "Cardiovascular sensor unavailable", state.options.sensorMissing, value => { state.options.sensorMissing = value; state.lab = true; });
      check("mi-no-evidence", "NASA evidence unavailable", state.options.evidenceMissing, value => { state.options.evidenceMissing = value; state.lab = true; });
      check("mi-no-earth", "Earth link unavailable (demo only)", state.offline, value => { state.offline = value; });
      const dayLabel = el("label", "Mission checkpoint"), day = el("select"); day.id = "mi-lab-day"; days.forEach(d => day.append(new Option(`Day ${d}`, d))); day.value = state.day; day.onchange = () => setDay(Number(day.value)); dayLabel.append(day); form.append(dayLabel);
      const trendLabel = el("label", "Knee-extension scenario"), trend = el("select"); trend.id = "mi-lab-trend";
      for (const [value, label] of [["recorded", "Recorded fixture"], ["stable", "Baseline extension"], ["reduced", "Reduced extension"]]) trend.append(new Option(label, value)); trend.value = state.options.movement;
      trend.onchange = () => { state.options.movement = trend.value; state.lab = true; render(); }; trendLabel.append(trend); form.append(trendLabel);
      const doseLabel = el("label", "Synthetic cumulative absorbed dose (mGy)"), dose = el("input"); dose.type = "number"; dose.id = "mi-lab-dose"; dose.min = 0; dose.max = ELENA.whatIf.exposureMax.value; dose.step = .01; dose.value = result.dose;
      dose.onchange = () => { const value = Number(dose.value); if (dose.value && Number.isFinite(value) && value >= 0 && value <= ELENA.whatIf.exposureMax.value) { state.options.exposure = value; state.lab = true; render(); } }; doseLabel.append(dose); form.append(doseLabel); body.append(form);
      part(body, result.movement, `${result.observation} ${result.passed}/${result.gates.length} gates passed.`);
    } else if (selectedPanel === "handoff") {
      part(body, "HUMAN MEDICAL REVIEW REQUIRED", result.remoteReview);
      part(body, "Observation / DERIVED FROM SYNTHETIC", result.observation); part(body, "Cardiovascular / SYNTHETIC", result.cardiovascular);
      part(body, "Exposure / SYNTHETIC", `${result.doseWithEvent} mGy cumulative context${result.event ? `, including tabletop +${ELENA.event.increment.value} mGy` : ""}. No causal inference.`);
      part(body, "Follow-up", result.action); renderGates(body); sources(body); result.limitations.forEach(text => part(body, "Retained limitation", text));
      const button = el("button", "Export handoff JSON", "mi-primary"); button.id = "mi-export"; button.onclick = exportPacket; body.append(button);
    } else if (selectedPanel === "xray") {
      const xray = getExternal().xray; if (!xray) part(body, "DATA NOT AVAILABLE", "No precomputed imaging result loaded.");
      else { const img = el("img"); img.src = `${import.meta.env.BASE_URL}inference/demo/${xray.imageId}_overlay.png`; img.alt = "External FracAtlas image with predicted mask"; img.width = img.height = 256; body.append(img);
        part(body, "MODEL OUTPUT / NOT ELENA'S IMAGE", `${xray.imageId}: uncalibrated classifier score ${xray.fractureScore.toFixed(4)}. Predicted mask area ${(100 * xray.maskAreaFraction).toFixed(2)}%. Precomputed DenseNet121 / U-Net++; not live inference, a diagnosis, or injury severity.`);
        body.append(link("Saved inference JSON", `${import.meta.env.BASE_URL}inference/demo/${xray.imageId}_prediction.json`), link("FracAtlas paper", "https://doi.org/10.1038/s41597-023-02432-4")); }
    } else if (selectedPanel === "limits") {
      part(body, "Truth contract", "SYNTHETIC DEMO: Elena and her readings. DERIVED: comparisons and quality gates. NASA RESEARCH: external cohorts. VISUALIZATION: anatomical and schematic layers. MODEL OUTPUT: saved external X-ray inference. MEASURED / USER ENTERED inputs remain in Research Lab, not this fixture.");
      part(body, "AI boundary", result.engine + ". Existing optional local LLM and camera models remain in Research Lab. This presentation does not pretend an LLM was called.");
      result.limitations.forEach(text => part(body, "Retained limitation", text)); part(body, "Source fixture", ELENA.boundary);
      part(body, "Operational states", "Any resolved change is reviewed; it is not a clinical cutoff. No universal health score. Baseline-only and low-quality cases withhold numerical follow-up claims.");
    } else if (selectedPanel === "presenter") {
      const controls = [["Reset demo", reset], ["Day 1", () => setDay(1)], ["Day 147", () => setDay(147)], ["Play timeline", () => { dialog.close(); play(); }], ["Trigger event", () => { dialog.close(); event(); }], ["Why", () => open("why")], ["Evidence graph", () => open("graph")], ["Astra", () => { dialog.close(); answer = "why"; render(); }], ["Data origin", () => open("origin")], ["Earth link unavailable", () => { state.offline = true; render(); }], ["Handoff", () => open("handoff")]];
      for (const [label, action] of controls) { const button = el("button", label); button.onclick = action; body.append(button); }
    }
    if (focused && $(focused)) $(focused).focus({ preventScroll: true });
    dialog.scrollTop = scrollTop;
  }
  $("mi-close").onclick = () => dialog.close();
  $("mi-why").onclick = () => open("why"); $("mi-handoff").onclick = () => open("handoff"); $("mi-evidence").onclick = () => open("graph");
  $("mi-origin").onclick = () => open("origin"); $("mi-limits").onclick = () => open("limits"); $("mi-lab").onclick = () => open("lab"); $("mi-verify").onclick = () => open("gates");
  $("mi-reset").onclick = reset; $("mi-play").onclick = play; $("mi-demo").onclick = playDemo; $("mi-event").onclick = event;
  $("mi-current").onclick = () => setDay(ELENA.identity.currentDay.value);
  $("mi-earth").onclick = () => { state.offline = !state.offline; render(); };
  $("mi-slider").oninput = e => setDay(days[Number(e.target.value)]);
  $("mi-research").onclick = () => { stop(); onResearch(); };
  const capture = el("button", "Open camera / video tools"); capture.type = "button"; capture.onclick = () => { stop(); onCapture(); }; root.querySelector(".mi-tools").append(capture);
  const nasa = el("button", "NASA measurements"); nasa.id = "mi-nasa-data"; nasa.type = "button"; nasa.onclick = () => open("nasa"); root.querySelector(".mi-tools").prepend(nasa);
  const circulation = el("button", "Inspect circulation model"); circulation.id = "mi-circulation"; circulation.type = "button";
  circulation.onclick = () => { state.system = "cardiovascular"; render(); open("circulation"); }; root.querySelector(".mi-human footer").before(circulation);
  function shortcut(e) { if (active && e.shiftKey && e.key.toLowerCase() === "d" && !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) { e.preventDefault(); open("presenter"); } }
  window.addEventListener("keydown", shortcut); window.addEventListener("resize", drawTrend);
  ready.then(() => { if (active) render(); });
  return { setActive(value) { active = value; root.hidden = !value; viewer.setActive(value); if (value) render(); else { stop(); dialog.close(); } },
    dispose() { stop(); disposePanel(); viewer.dispose?.(); window.removeEventListener("keydown", shortcut); window.removeEventListener("resize", drawTrend); root.remove(); } };
}
