import { createMissionHuman } from "./missionHuman.js";
import { explainMission } from "./missionExplanation.js";
import "./missionCommand.css";

const node = (tag, text = "", className = "") => { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; };
export function createMissionCommand({ section, onDay, selectChannel, onCapture, exportCase, getExternal }) {
  const content = section.querySelector(".case-content"), story = section.querySelector(".case-story");
  const command = node("div", "", "mission-command"), human = node("section", "", "mission-human");
  human.innerHTML = `<header><span class="section-label">Human systems view</span><strong>Musculoskeletal reference</strong></header><div class="mission-human-stage"></div><footer>Reference anatomy, not a personal reconstruction.<a href="${import.meta.env.BASE_URL}models/anatomy/SOURCE-LICENSE.txt" target="_blank" rel="noopener noreferrer">Z-Anatomy / BodyParts3D attribution</a></footer>`;
  const summary = node("section", "", "mission-command-summary");
  summary.append(section.querySelector(".case-decision"), section.querySelector(".case-meta"), section.querySelector(".case-channel-tabs"));
  command.append(human, summary); story.after(command);
  const viewer = createMissionHuman(human.querySelector(".mission-human-stage"));
  const timeline = node("div", "", "mission-scrubber");
  timeline.innerHTML = '<label for="mission-day-slider">Mission timeline <output id="mission-day-output"></output></label><input id="mission-day-slider" type="range" min="0" max="5" step="1" value="3" aria-label="Selected recorded mission day"><small>Recorded observations only / no interpolated health measurements</small>';
  story.before(timeline);
  const actions = node("div", "", "mission-context-actions");
  actions.innerHTML = '<button type="button" id="mission-why" class="primary-action">Why has this changed?</button><button type="button" id="mission-next">Next action</button><button type="button" id="mission-evidence">Scientific evidence</button><button type="button" id="mission-handoff">Prepare handoff</button>';
  summary.append(actions);
  const simulation = node("div", "", "mission-scenario");
  simulation.innerHTML = '<button type="button" id="mission-event">Simulate exposure event</button><button type="button" id="mission-event-reset" hidden>Reset event</button><p id="mission-event-status">Tabletop simulation only / no live space-weather feed</p>';
  summary.append(simulation);
  const dialog = node("dialog", "", "mission-explanation"); dialog.id = "mission-explanation";
  dialog.innerHTML = '<header><div><span class="section-label">Traceable onboard review</span><h2 id="mission-dialog-title"></h2></div><button type="button" aria-label="Close review" title="Close review" id="mission-dialog-close">&#215;</button></header><div id="mission-explanation-body"></div><footer><button type="button" class="primary-action" id="mission-dialog-export">Export handoff JSON</button><button type="button" id="mission-dialog-capture">Open movement capture</button></footer>';
  section.append(dialog); dialog.setAttribute("aria-labelledby", "mission-dialog-title");
  const $ = id => section.querySelector(`#${id}`);
  let current, input = {}, scenario = null, active = false, dialogKind = "why";
  function review() { return explainMission(current, input.health || [], getExternal(), scenario); }
  function renderDialog() {
    if (!current) return;
    const started = performance.now(), report = review();
    $("mission-dialog-title").textContent = dialogKind === "handoff" ? "Medical review handoff" : "What supports this review?";
    const body = $("mission-explanation-body"); body.replaceChildren(node("p", `${input.profile.display_name} / Day ${current.day} / ${current.synthetic ? "SYNTHETIC SCENARIO" : "LOCAL OBSERVATIONS"}`, "handoff-identity"));
    for (const [label, text] of [["Observation", report.observation], ["Cardiovascular", report.cardiovascular], ["Mission context", report.radiation],
      ["Imaging", report.imaging], ["Interpretation", report.interpretation], ["Next human decision", report.nextAction], ["Uncertainty", report.uncertainty]]) {
      const part = node("section"); part.append(node("h3", label), node("p", text)); body.append(part);
    }
    if (report.scenario) body.append(node("p", `TABLETOP EVENT: hypothetical +${report.scenario.additionalDoseMgy} mGy. This is not a measured reading and is not stored in dosimeter history. No biological effect is inferred.`, "scenario-notice"));
    const evidence = node("section"); evidence.append(node("h3", "NASA research references"));
    for (const source of report.evidence) {
      const a = node("a", `${source.accession} / ${source.population}`); a.href = source.url; a.target = "_blank"; a.rel = "noopener noreferrer"; evidence.append(a);
    }
    if (!report.evidence.length) evidence.append(node("p", "NASA dataset references unavailable. No source-verification claim is made."));
    body.append(evidence);
    const trace = node("details"); trace.append(node("summary", "Rule-based verification trace"));
    const list = node("dl"); for (const gate of report.gates) list.append(node("dt", gate.name), node("dd", gate.status)); trace.append(list, node("small", `${report.engine}. Structured review: ${(performance.now() - started).toFixed(1)} ms; excludes camera and data loading.`)); body.append(trace);
    body.append(node("small", "Packet includes selected-day movement, cardiovascular observations, dose context, separate external references, uncertainty, and consented follow-up actions. No video or identifying clinical records."));
  }
  function open(kind) { if (!current?.current) return; dialogKind = kind; renderDialog(); dialog.showModal(); }
  $("mission-why").onclick = () => open("why"); $("mission-handoff").onclick = () => open("handoff");
  $("mission-next").onclick = () => { section.querySelector("#case-action").scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("mission-evidence").onclick = () => { selectChannel("cardiovascular"); section.querySelector(".case-data").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("mission-dialog-close").onclick = () => dialog.close();
  $("mission-dialog-export").onclick = () => exportCase({ explanation: review() });
  $("mission-dialog-capture").onclick = () => { dialog.close(); onCapture(); };
  $("mission-day-slider").oninput = event => {
    const row = input.history[Number(event.target.value)]; if (row) onDay(row.mission_day);
  };
  function showScenario() {
    $("mission-event-reset").hidden = !scenario;
    $("mission-event-status").textContent = scenario ? `SIMULATED +${scenario.additionalDoseMgy} mGy on Day ${scenario.day}. No measured record changed. Human-led scenario review required.` : "Tabletop simulation only / no live space-weather feed";
    simulation.dataset.simulated = String(Boolean(scenario));
  }
  $("mission-event").onclick = () => {
    if (!current?.synthetic) return;
    scenario = { type: "tabletop-exposure-event", synthetic: true, astronaut_id: current.astronaut_id, day: current.day, additionalDoseMgy: 10,
      boundary: "Illustrative increment, not a radiation transport model or medical threshold; original observations unchanged." };
    showScenario(); open("why");
  };
  $("mission-event-reset").onclick = () => { scenario = null; showScenario(); };
  return {
    update(value, data) {
      if (current?.day !== value.day || current?.astronaut_id !== value.astronaut_id) scenario = null;
      current = value; input = data;
      $("mission-day-slider").max = Math.max(0, data.history.length - 1);
      $("mission-day-slider").value = Math.max(0, data.history.findIndex(row => row.id === value.current?.id));
      $("mission-day-output").textContent = `Day ${value.day ?? "--"}`;
      $("mission-day-slider").setAttribute("aria-valuetext", `Mission Day ${value.day ?? "unknown"}`);
      simulation.hidden = !active || !value.synthetic; showScenario(); viewer.update(value);
      if (dialog.open) renderDialog();
    },
    setActive(value) { active = value; human.hidden = timeline.hidden = actions.hidden = !active; simulation.hidden = !active || !current?.synthetic; viewer.setActive(active); if (!active && dialog.open) dialog.close(); },
    scenario: () => scenario,
  };
}
