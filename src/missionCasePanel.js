import { buildMissionCase, captureUsable } from "./missionCase.js";
import { formatMetric } from "./companionEvidence.js";
import knowledge from "../companion/knowledge.json" with { type: "json" };
import demo from "./demoMission.json" with { type: "json" };
import { createMissionResearchPanel } from "./missionResearchPanel.js";
import { createMissionCommand } from "./missionCommand.js";
import { createMissionIntelligence } from "./missionIntelligence.js";
import "./missionCase.css";

const el = (tag, text, className = "") => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
export function createMissionCasePanel({ parent, onDay, onSaveAction, onDemo, onCapture, onResearch }) {
  const section = document.createElement("section"); section.className = "mission-case"; section.id = "mission-case";
  section.innerHTML = `<div class="case-empty"><span class="section-label">Observe / review / act</span><h2>One crew member. A clearer health picture.</h2><p>Movement, cardiovascular observations, radiation context, and imaging evidence. Compare personal history, review the science, and record the next human decision.</p><button type="button" class="primary-action" id="case-demo">Load mission demo</button><button type="button" id="case-capture">Open movement capture</button><small>Research decision support. No diagnosis or autonomous treatment.</small></div>
    <div class="case-content" hidden><header class="case-heading"><div><span class="section-label">Active crew record</span><h2 id="case-name"></h2><p id="case-mission"></p></div><strong id="case-provenance"></strong></header>
    <div class="case-story" role="group" aria-label="Mission observations"></div>
    <div class="case-decision" aria-live="polite"><span class="section-label">Current review</span><h3 id="case-decision-title"></h3><p id="case-change"></p><p id="case-reason"></p></div>
    <div class="case-meta"><span id="case-day"></span><span>Capture: <strong id="case-quality"></strong></span><span id="case-gravity"></span></div>
    <div class="case-channel-tabs" role="tablist" aria-label="Health evidence channels">
      <button type="button" role="tab" id="channel-movement" data-channel="movement" aria-controls="case-movement-panel" aria-selected="true"><span>Movement</span><strong id="case-movement-value">No observation</strong></button>
      <button type="button" role="tab" id="channel-cardiovascular" data-channel="cardiovascular" aria-controls="case-research-panel" aria-selected="false" tabindex="-1"><span>Cardiovascular</span><strong id="case-heart-value">Not recorded</strong></button>
      <button type="button" role="tab" id="channel-radiation" data-channel="radiation" aria-controls="case-research-panel" aria-selected="false" tabindex="-1"><span>Radiation</span><strong id="case-dose">Not recorded</strong></button>
      <button type="button" role="tab" id="channel-xray" data-channel="xray" aria-controls="case-research-panel" aria-selected="false" tabindex="-1"><span>X-ray evidence</span><strong>External FracAtlas case</strong></button>
    </div>
    <div class="case-workflow"><section class="case-data"><div id="case-movement-panel" role="tabpanel" aria-labelledby="channel-movement"><h3>Personal movement history</h3><canvas id="case-chart" role="img" width="800" height="220"></canvas><p id="case-followup"></p><small>Left knee ROM / degrees. Gaps and crosses mark withheld observations. Estimated motion is not a measurement of bone density or muscle strength.</small></div></section>
    <section><h3>Next human decision</h3><p id="case-action"></p><label class="case-consent"><input type="checkbox" id="case-action-consent"> Store this review action locally</label><button id="case-record-action" type="button">Record repeat request</button><ul id="case-actions"></ul></section></div>
    <section class="case-certainty"><h3>What we can conclude</h3><p id="case-confidence"></p><p>No bone density, muscle strength, force, or injury probability is measured. Radiation is context only; no causal link or fused health score is calculated.</p></section>
    <details class="case-evidence"><summary>View scientific context</summary><p>Curated NASA research summaries selected by topic, not generated medical advice or proof of this individual's cause.</p><div id="case-evidence-links"></div></details>
    <details><summary>View technical details</summary><p id="case-protocol"></p><p>Comparison gates: same protocol, gravity, input source, pose model, and distance calibration; at least 12 samples and 70% capture quality. These are engineering rules, not clinically validated cutoffs. Changes below 0.1 are rounded as unresolved, not proven absence of change.</p><p id="case-demo-note"></p><button type="button" id="case-export">Export selected case</button></details></div>`;
  parent.prepend(section);
  const $ = selector => section.querySelector(selector);
  section.querySelector(".case-content > details:last-child").append($(".case-certainty"));
  let input = {}, current = null;
  const researchPanel = createMissionResearchPanel({ parent: $(".case-data"), onCardio: cardio => {
    $("#case-heart-value").textContent = cardio.status === "missing" ? "Not recorded" : cardio.status === "withheld" ? "Withheld / low signal"
      : `${cardio.current.metrics.heart_rate_bpm} bpm${cardio.current.source === "synthetic" ? " / synthetic" : " / recorded"}${cardio.status === "earlier" ? " / earlier" : ""}`;
  } });
  function selectChannel(name) {
    for (const button of section.querySelectorAll("[data-channel]")) {
      const active = button.dataset.channel === name; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
    }
    $("#case-movement-panel").hidden = name !== "movement";
    $("#case-research-panel").setAttribute("role", "tabpanel"); $("#case-research-panel").setAttribute("aria-labelledby", `channel-${name}`);
    researchPanel.select(name); requestAnimationFrame(draw);
  }
  const channelButtons = [...section.querySelectorAll("[data-channel]")];
  channelButtons.forEach((button, index) => {
    button.onclick = () => selectChannel(button.dataset.channel);
    button.onkeydown = event => {
      const target = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : null;
      if (target === null) return; event.preventDefault(); channelButtons[target].focus(); selectChannel(channelButtons[target].dataset.channel);
    };
  });
  const command = createMissionCommand({ section, onDay, selectChannel, onCapture, exportCase,
    getExternal: () => researchPanel.exportEvidence() });
  command.setActive(false);
  const intelligence = createMissionIntelligence({ getExternal: () => researchPanel.exportEvidence(), ready: researchPanel.ready, onResearch, onCapture });
  // The mission story is the home page (the digital twin), so no presentation link is repeated here.
  $("#case-demo").onclick = onDemo; $("#case-capture").onclick = onCapture;
  $("#case-record-action").onclick = async () => {
    if (!current?.current || current.status === "human_review_now" || !$("#case-action-consent").checked) return;
    await onSaveAction({ assessment_id: current.current.id, mission_day: current.day, kind: "repeat_requested", consent_to_store: true });
    $("#case-action-consent").checked = false;
  };
  $("#case-action-consent").onchange = () => { $("#case-record-action").disabled = !$("#case-action-consent").checked || !current?.current || current.status === "human_review_now"; };
  function exportCase(extra = {}) {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...current, profile: input.profile, evidence: sources(),
      cardiovascular: (input.health || []).filter(row => row.mission_day <= current.day), externalEvidence: researchPanel.exportEvidence(),
      scenario: command.scenario(), ...extra,
      provenance: current.synthetic ? demo.label : "User-supplied aggregate observations; identity and device provenance not authenticated.",
      engine: "deterministic comparison; no clinical prediction", exportedAt: new Date().toISOString() }, null, 2)], {type:"application/json"}));
    const a = el("a", ""); a.href = url; a.download = `astrobone-${current.synthetic ? "SYNTHETIC-" : ""}case-day-${current.day}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("#case-export").onclick = () => exportCase();
  const sources = () => knowledge.chunks.filter(row => current?.evidenceIds.includes(row.id));
  function update(value) {
    const previousId = current?.current?.id;
    input = value; current = buildMissionCase(value);
    if (previousId !== current.current?.id) $("#case-action-consent").checked = false;
    $(".case-empty").hidden = Boolean(value.profile); $(".case-content").hidden = !value.profile;
    if (!value.profile) return;
    const row = current.current;
    $("#case-name").textContent = value.profile.display_name;
    $("#case-mission").textContent = `${value.profile.mission_name} / ${value.profile.astronaut_id}`;
    $("#case-provenance").textContent = current.synthetic ? "SYNTHETIC SCENARIO" : "LOCAL OBSERVATIONS";
    $(".case-story").replaceChildren(...value.history.map(observation => {
      const label = current.synthetic && observation.pose_model === demo.pose_model ? demo.observations.find(r => r.mission_day === observation.mission_day)?.stage : null;
      const button = el("button", `Day ${observation.mission_day}${label ? ` / ${label}` : ""}`);
      button.type = "button"; button.dataset.day = observation.mission_day; button.setAttribute("aria-pressed", String(observation.id === row?.id));
      button.onclick = () => onDay(observation.mission_day); return button;
    }));
    $(".case-decision").dataset.state = current.status;
    $("#case-decision-title").textContent = current.title;
    const change = current.comparison.changes.find(r => r.metric === "knee_extension_deg") || current.comparison.changes[0];
    $("#case-change").textContent = change ? `${formatMetric(change.metric)}: ${change.baseline} to ${change.current} ${change.unit} (${change.delta > 0 ? "+" : ""}${change.delta} ${change.unit} vs Day ${current.comparison.baseline_day}).`
      : current.status === "baseline_recorded" ? "This is the personal reference. A comparable follow-up is needed before a trend can be assessed."
      : current.comparison.reasons.join(" ");
    $("#case-reason").textContent = current.status === "change_observed" ? "Descriptive change only. Cause, biological deterioration, and clinical importance are undetermined."
      : current.status === "insufficient_evidence" ? "No health trend or numerical baseline change is approved from this observation." : "No clinical clearance is implied.";
    $("#case-day").textContent = row ? `Day ${row.mission_day}` : "Not recorded";
    $("#case-quality").textContent = row ? `${Math.round(row.tracking_quality * 100)}% / ${row.sample_count} samples` : "Not recorded";
    $("#case-gravity").textContent = row?.gravity || "Unknown";
    $("#case-dose").textContent = current.dose ? `${current.dose.cumulative_personal_absorbed_dose_mgy} mGy${current.synthetic ? " / synthetic" : " / manual"}` : "Not provided";
    $("#case-movement-value").textContent = !row ? "Not recorded" : !captureUsable(row) ? "Comparison withheld" : `Day ${row.mission_day} / ${current.synthetic ? "synthetic" : "estimated"}`;
    researchPanel.update({ ...value, day: current.day, dose: current.dose, synthetic: current.synthetic });
    command.update(current, value);
    $("#case-followup").textContent = current.followup ? `Compared with Day ${current.followup.previousDay}, this observation is ${current.followup.direction}. ${current.followup.interpretation}` : "No comparable earlier follow-up is available.";
    $("#case-action").textContent = current.nextAction;
    $("#case-record-action").disabled = !row || current.status === "human_review_now" || !$("#case-action-consent").checked;
    $("#case-actions").replaceChildren(...current.followups.map(action => el("li", `Day ${action.mission_day}: ${action.text}`)));
    $("#case-confidence").textContent = current.confidence;
    $("#case-protocol").textContent = row ? `${row.protocol} / ${row.source} / ${row.pose_model}. Baseline Day ${current.baseline?.mission_day ?? "not recorded"}.` : "No observation available.";
    $("#case-demo-note").textContent = current.synthetic ? `${demo.label} ${demo.notes}` : "Camera data require the same framing and approved movement protocol. No raw frames are included in this case export.";
    $("#case-evidence-links").replaceChildren(...sources().map(source => { const item = el("article", ""), link = el("a", source.title); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; item.append(link, el("p", source.text), el("small", `${source.section} / ${source.population}`)); return item; }));
    requestAnimationFrame(draw);
  }
  function draw() {
    const canvas = $("#case-chart"); if (!current || !canvas.getBoundingClientRect().width) return;
    const rows = (input.history || []).filter(row => row.mission_day <= (current.day ?? Infinity));
    const width = Math.max(280, canvas.getBoundingClientRect().width), ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = 220 * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, 220);
    const dark = document.documentElement.dataset.theme === "dark", ink = dark ? "#c4d1d8" : "#43545b";
    const maxDay = Math.max(2, ...rows.map(r => r.mission_day));
    const x = day => 40 + (day - 1) / (maxDay - 1) * (width - 60), y = value => 181 - value / 180 * 155;
    ctx.font = "12px sans-serif"; ctx.fillStyle = ink;
    for (const value of [0, 60, 120, 180]) { ctx.fillText(String(value), 4, y(value) + 4); ctx.strokeStyle = dark ? "#34474d" : "#d3dcdf"; ctx.beginPath(); ctx.moveTo(34, y(value)); ctx.lineTo(width - 10, y(value)); ctx.stroke(); }
    ctx.strokeStyle = "#078778"; ctx.lineWidth = 2; ctx.beginPath(); let connected = false;
    for (const row of rows) { const v = row.metrics.knee_rom_left_deg; if (!captureUsable(row) || !Number.isFinite(v)) { connected = false; continue; } if (connected) ctx.lineTo(x(row.mission_day), y(v)); else ctx.moveTo(x(row.mission_day), y(v)); connected = true; } ctx.stroke();
    for (const row of rows) { const v = row.metrics.knee_rom_left_deg; if (!Number.isFinite(v)) continue; const xx = x(row.mission_day), yy = y(v);
      if (!captureUsable(row)) { ctx.strokeStyle = "#c88920"; ctx.beginPath(); ctx.moveTo(xx-5,yy-5);ctx.lineTo(xx+5,yy+5);ctx.moveTo(xx+5,yy-5);ctx.lineTo(xx-5,yy+5);ctx.stroke(); }
      else { ctx.fillStyle = "#078778"; ctx.beginPath();ctx.arc(xx,yy,4,0,2*Math.PI);ctx.fill(); }
    }
    ctx.fillStyle=ink;ctx.fillText("Day 1",40,210);ctx.textAlign="right";ctx.fillText(`Day ${current.day ?? "--"}`,width-12,210);
    canvas.setAttribute("aria-label", rows.map(row => `Day ${row.mission_day}: ${captureUsable(row) ? `${row.metrics.knee_rom_left_deg ?? "not measured"} degrees left knee ROM` : "withheld, poor capture"}`).join("; "));
  }
  window.addEventListener("resize", draw); window.addEventListener("astrobone-theme-change", draw);
  return { update, getCase: () => current, setPresentation(active) { command.setActive(false); intelligence.setActive(active); } };
}
