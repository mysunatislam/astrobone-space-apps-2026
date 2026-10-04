import "./companion.css";
import { assessmentForCompanion, formatMetric } from "./companionEvidence.js";
import { createBrowserCompanion } from "./browserCompanion.js";
import { createMultisystemPanel } from "./multisystemPanel.js";
import { createMissionCasePanel } from "./missionCasePanel.js";
import { captureUsable } from "./missionCase.js";

const API = "http://127.0.0.1:8010/api/companion";
const node = (tag, text = "", className = "") => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

export function initCompanion({ getAssessment, getPulse = () => null }) {
  const panel = document.createElement("section");
  panel.id = "crew-companion";
  panel.className = "companion-shell";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "companion-title");
  panel.innerHTML = `
    <header class="companion-heading"><div><span class="section-label">LOCAL MISSION SUPPORT</span><h2 id="companion-title">Crew companion</h2><p>Personal observations. Traceable evidence. Human decisions.</p></div><div><span id="companion-service" role="status">Service not connected</span><button id="companion-connect" type="button">Connect local service</button></div></header>
    <div id="companion-message" class="companion-message" role="status" aria-live="polite">Local research workspace. No cloud connection.</div>
    <div class="companion-layout">
      <aside class="companion-profile" aria-label="Astronaut profile">
        <h3>Mission profile</h3><label for="crew-select">Astronaut</label><select id="crew-select"><option value="">Select a profile</option></select>
        <div class="companion-actions"><button id="crew-new" type="button">New profile</button><button id="crew-demo" type="button">Day 1–180 demo</button></div>
        <div id="crew-identity"><p>No profile selected.</p></div>
        <label for="crew-day">Mission day</label><input id="crew-day" type="number" min="0" max="2000" value="1" />
        <label for="crew-gravity">Observation gravity</label><select id="crew-gravity"><option value="earth">Earth / analog</option><option value="microgravity">Microgravity</option><option value="moon">Moon</option><option value="mars">Mars</option><option value="unknown">Unknown</option></select>
        <button id="crew-save" type="button" disabled>Save movement assessment</button>
        <button id="crew-camera" type="button">Open movement capture</button>
        <hr /><h4>Measurement boundaries</h4><dl class="companion-boundaries"><dt>Bone density</dt><dd>Not measured</dd><dt>Muscle strength</dt><dd>Not measured</dd><dt>Injury probability</dt><dd>Not validated</dd></dl>
        <button id="crew-delete" type="button" class="companion-danger" disabled>Delete local profile</button>
      </aside>
      <div class="companion-main">
        <section class="companion-band"><div class="companion-band-heading"><h3>Personal movement timeline</h3><select id="crew-metric" aria-label="Timeline measurement"><option value="knee_extension_deg">Knee extension</option></select></div><div id="crew-timeline-empty" class="companion-empty">No saved observations</div><canvas id="crew-timeline" width="800" height="240" aria-label="Personal movement observations by mission day" role="img" hidden></canvas><p id="crew-baseline-note">Baseline not recorded</p><div class="companion-table-scroll"><table><thead><tr><th>Measurement</th><th>Baseline</th><th>Current</th><th>Change</th></tr></thead><tbody id="crew-comparison"><tr><td colspan="4">Run a review after a follow-up observation.</td></tr></tbody></table></div></section>
        <section class="companion-band"><h3>Onboard review</h3><form id="companion-review-form"><div id="companion-prompt-group"><label for="companion-prompt">Review request</label><textarea id="companion-prompt" maxlength="1500" rows="2">Compare my latest movement assessment with my personal baseline and retrieve relevant NASA evidence.</textarea></div><p id="browser-review-note" hidden>Browser-only mode compares the latest observation with the locked baseline using fixed rules and shows curated NASA context. No language model or open-ended agent is running.</p><div class="companion-review-options"><label><input id="companion-use-llm" type="checkbox" checked /> Use local Llama / Gemma</label><label><input id="companion-red-flag" type="checkbox" /> Crew reports new severe pain or loss of function</label></div><div class="companion-actions"><button id="companion-run" class="primary-action" type="submit" disabled>Run verified review</button><button id="companion-export" type="button" disabled>Export report</button></div></form><div id="companion-result" aria-live="polite"><p class="companion-empty">No review completed</p></div></section>
        <section class="companion-band"><h3>Research evidence</h3><div id="companion-sources" class="companion-sources"><p class="companion-empty">Sources appear after retrieval.</p></div></section>
      </div>
      <aside class="companion-audit"><h3>Review trace</h3><ol id="companion-trace"><li>Waiting for review</li></ol><h3>Verification gates</h3><dl id="companion-gates"><dt>Evidence</dt><dd>Not checked</dd><dt>Physics</dt><dd>Not established</dd><dt>Mission constraints</dt><dd>Not checked</dd><dt>Action authority</dt><dd>Human review required</dd></dl></aside>
    </div>
    <dialog id="crew-create-dialog"><form id="crew-create-form"><h3>Create local crew profile</h3><label for="crew-id-input">Astronaut ID</label><input id="crew-id-input" name="astronaut_id" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" placeholder="CREW-001" required /><label for="crew-name-input">Display name or pseudonym</label><input id="crew-name-input" name="display_name" maxlength="60" required /><label for="crew-mission-input">Mission</label><input id="crew-mission-input" name="mission_name" maxlength="80" value="Exploration analog" required /><fieldset><legend>Available equipment</legend><label><input type="checkbox" name="equipment" value="camera" checked /> Camera</label><label><input type="checkbox" name="equipment" value="imu" /> IMU</label><label><input type="checkbox" name="equipment" value="resistance_device" /> Resistance device</label><label><input type="checkbox" name="equipment" value="treadmill" /> Treadmill</label></fieldset><div class="companion-actions"><button type="submit" class="primary-action">Create profile</button><button type="button" data-close="crew-create-dialog">Cancel</button></div></form></dialog>
    <dialog id="crew-save-dialog"><form id="crew-save-form"><h3>Store aggregate observation</h3><p id="crew-save-summary"></p><label><input id="crew-as-baseline" type="checkbox" /> Set as the locked personal baseline</label><label><input id="crew-store-consent" type="checkbox" required /> I consent to saving these aggregate observations in this browser or on this computer.</label><p>No video or raw landmarks are stored. Local storage is not encrypted in this prototype; do not use identifying health records.</p><div class="companion-actions"><button type="submit" class="primary-action">Save observation</button><button type="button" data-close="crew-save-dialog">Cancel</button></div></form></dialog>`;
  document.querySelector(".workspace").after(panel);
  panel.querySelector("#crew-create-form h3").after(node("p", "Use a pseudonym. Browser profiles are stored unencrypted on this device when the private service is unavailable."));
  const radiationPanel = document.createElement("details");
  radiationPanel.className = "companion-radiation";
  radiationPanel.innerHTML = `<summary>Radiation context</summary><p id="crew-radiation-status">No personal dosimeter record</p><form id="crew-dose-form"><label for="crew-dose-day">Reading mission day</label><input id="crew-dose-day" type="number" min="0" max="2000" required /><label for="crew-dose-mgy">Cumulative personal absorbed dose (mGy)</label><input id="crew-dose-mgy" type="number" min="0" max="100000" step="any" required /><label for="crew-instrument-id">Dosimeter ID (manual entry)</label><input id="crew-instrument-id" maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" required /><label class="companion-dose-consent"><input id="crew-dose-consent" type="checkbox" required /> I consent to storing this instrument reading locally.</label><button id="crew-save-dose" type="submit" disabled>Record reading</button></form><small>Manual entry is unverified. No bone dose or combined risk score is inferred.</small>`;
  panel.querySelector("#crew-camera").after(radiationPanel);
  const healthOverview = document.createElement("section");
  healthOverview.className = "health-overview";
  healthOverview.setAttribute("aria-labelledby", "health-overview-title");
  healthOverview.innerHTML = `
    <div><span class="section-label">Mission health / functional observation</span><h2 id="health-overview-title">Movement assessment</h2><p>Capture a repeatable movement by webcam or local video, check quality, then compare with this crew member's own baseline. Video-derived motion cannot measure bone density or diagnose injury.</p></div>
    <div class="health-overview-actions"><span id="health-capture-status" role="status">No assessment recorded</span><button id="health-open-review" class="primary-action" type="button">Open personal review</button></div>`;
  document.querySelector(".workspace").prepend(healthOverview);
  const healthControlsHeading = document.createElement("div");
  healthControlsHeading.className = "health-controls-heading";
  healthControlsHeading.innerHTML = `<span class="section-label">01 / Capture</span><h2>Movement capture</h2><p>Keep both legs visible. Use the same movement protocol and input source for every comparison.</p>`;
  document.querySelector(".controls").insertBefore(healthControlsHeading, document.querySelector("#stage-evidence"));
  const tabs = document.createElement("div");
  tabs.className = "companion-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "AstroBone workspace");
  tabs.innerHTML = '<button type="button" role="tab" id="twin-tab" aria-controls="twin-view-grid" aria-selected="true">Movement capture</button><button type="button" role="tab" id="companion-tab" aria-controls="crew-companion" aria-selected="false">Personal review</button><button type="button" role="tab" id="research-tab" aria-controls="stage-evidence" aria-selected="false">Research tools</button>';
  document.querySelector(".topbar").after(tabs);
  const $ = (id) => panel.querySelector(`#${id}`);
  let profile = null, history = [], radiationHistory = [], healthHistory = [], followups = [], reviewDay = Infinity, report = null, busy = false, connected = false, profileRequest = 0;
  let reviewRevision = 0;
  let missionDemo = location.hash === "#mission-demo";
  const browserCompanion = createBrowserCompanion();
  let serviceMode = "unknown";
  const visibleHistory = () => history.filter(row => row.mission_day <= reviewDay);
  const activeStrip = node("div", "No crew selected / captures are unassigned until saved with consent", "active-crew-strip");
  const exitPresentation = node("button", "Exit presentation", "exit-presentation"); exitPresentation.type = "button"; tabs.after(exitPresentation);
  exitPresentation.onclick = () => { missionDemo = false; setView("review"); };
  activeStrip.id = "active-crew-strip"; tabs.after(activeStrip);
  const casePanel = createMissionCasePanel({ parent: panel.querySelector(".companion-main"),
    onDemo: () => $("crew-demo").click(), onCapture: () => setView("capture"),
    onResearch: () => { missionDemo = false; setView("review"); },
    onDay: day => { if (busy) return; reviewDay = day; $("crew-day").value = day; invalidateReport("Selected observation changed. Run a new evidence review."); renderProfile(); },
    onSaveAction: async action => {
      if (!profile || busy) return;
      busy = true; controls();
      try { await api(`/profiles/${encodeURIComponent(profile.astronaut_id)}/followups`, { method: "POST", body: JSON.stringify(action) });
        const selected = reviewDay; await selectProfile(profile.astronaut_id); reviewDay = selected; renderProfile(); message("Repeat request recorded. No treatment or clearance issued.");
      } catch (error) { message(error.message, true); } finally { busy = false; controls(); }
    },
  });
  const multisystem = createMultisystemPanel({ parent: panel.querySelector(".companion-main"), getDay: () => Number($("crew-day").value), getPulse,
    save: async (id, observation) => {
      await api(`/profiles/${encodeURIComponent(id)}/health`, { method: "POST", body: JSON.stringify(observation) });
      if (profile?.astronaut_id === id) await selectProfile(id);
    },
  });
  const advanced = document.createElement("details"); advanced.className = "review-advanced";
  advanced.append(node("summary", "Advanced analysis & sensor records"));
  for (const band of [...panel.querySelectorAll(".companion-main > .companion-band")]) advanced.append(band);
  advanced.append(panel.querySelector(".companion-audit")); panel.querySelector(".companion-main").append(advanced);
  $("companion-title").textContent = "Mission health review";
  $("crew-demo").textContent = "Load demo astronaut";
  $("companion-run").textContent = "Run bounded evidence review";
  document.querySelector("#companion-tab").textContent = "Crew records";
  document.querySelector("#research-tab").textContent = "Experimental tools";
  const labButton = document.querySelector("#research-tab");
  labButton.removeAttribute("role"); labButton.removeAttribute("aria-controls"); advanced.append(labButton);
  const manage = node("details", "", "crew-management"); manage.append(node("summary", "Crew & data management"));
  manage.append(panel.querySelector(".companion-profile")); panel.querySelector(".companion-main").append(manage);
  const service = panel.querySelector(".companion-heading > div:last-child"); advanced.querySelector("summary").after(service);
  const implementation = document.querySelector("#open-mission-review"); advanced.append(implementation);
  advanced.addEventListener("toggle", drawTimeline);
  panel.querySelector("#case-action").after($("companion-red-flag").closest("label"));
  const message = (text, error = false) => {
    $("companion-message").textContent = text;
    $("companion-message").dataset.error = String(error);
    const dialog = panel.querySelector("dialog[open]");
    if (dialog && error) {
      let alert = dialog.querySelector("[data-dialog-error]");
      if (!alert) {
        alert = node("p", "", "companion-warning");
        alert.dataset.dialogError = "true";
        alert.setAttribute("role", "alert");
        dialog.append(alert);
      }
      alert.textContent = text;
    }
  };

  async function api(path, options = {}) {
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
      serviceMode = "browser";
      return browserCompanion.request(path, options);
    }
    if (serviceMode === "browser") {
      return browserCompanion.request(path, options);
    }
    try {
      const response = await fetch(API + path, { ...options, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Invalid observation or request. Check the input fields.");
      serviceMode = "service";
      return payload;
    } catch (error) {
      if (serviceMode === "unknown" && (error instanceof TypeError || error.name === "TimeoutError")) {
        serviceMode = "browser";
        return browserCompanion.request(path, options);
      }
      throw error;
    }
  }

  function updateCaptureStatus() {
    const assessment = getAssessment();
    healthOverview.querySelector("#health-capture-status").textContent = assessment?.status === "complete"
      ? `${Math.round(assessment.trackingQuality * 100)}% tracking quality / assessment ready`
      : "No assessment recorded";
  }

  function setView(mode, { updateHash = true, connectIfNeeded = true } = {}) {
    const review = mode === "review";
    const capture = mode === "capture";
    document.body.classList.toggle("companion-active", review);
    document.body.classList.toggle("health-active", capture);
    document.body.classList.toggle("mission-demo", review && missionDemo);
    casePanel.setPresentation(review && missionDemo);
    for (const selector of [".mission-brief", ".support-lifecycle"]) document.querySelector(selector).hidden = !(!review && !capture);
    document.querySelector(".workspace").hidden = review;
    panel.hidden = !review;
    for (const [id, selected] of [["twin-tab", capture], ["companion-tab", review], ["research-tab", !capture && !review]]) {
      document.querySelector(`#${id}`).setAttribute("aria-selected", String(selected));
    }
    if (capture) {
      document.querySelector('[data-workflow-stage="0"]').click();
      document.querySelector(".motionguard-capture-details").open = true;
      updateCaptureStatus();
    }
    if (updateHash) {
      const hash = review ? missionDemo ? "#mission-demo" : "#crew-companion" : capture ? "#movement-capture" : "#research-tools";
      window.history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    window.dispatchEvent(new Event("resize"));
    if (review && !connected && connectIfNeeded) void connect();
  }
  document.querySelector("#twin-tab").addEventListener("click", () => setView("capture"));
  document.querySelector("#companion-tab").addEventListener("click", () => setView("review"));
  document.querySelector("#research-tab").addEventListener("click", () => setView("research"));
  healthOverview.querySelector("#health-open-review").addEventListener("click", () => setView("review"));
  $("crew-camera").addEventListener("click", () => setView("capture"));

  function controls() {
    $("companion-connect").disabled = busy;
    $("companion-run").disabled = !profile || busy;
    $("crew-save").disabled = !profile || profile.is_demo || busy || getAssessment()?.status !== "complete";
    $("crew-delete").disabled = !profile || busy;
    $("crew-save-dose").disabled = !profile || profile.is_demo || busy;
    $("crew-select").disabled = busy;
    $("crew-demo").disabled = busy;
    $("crew-new").disabled = busy;
    $("companion-export").disabled = !report || busy;
  }
  function invalidateReport(reason = "No review completed") {
    reviewRevision += 1;
    report = null;
    $("companion-trace").replaceChildren(node("li", "Waiting for current review"));
    $("companion-gates").replaceChildren(...[
      ["Evidence", "Not checked"], ["Physics", "Not established"],
      ["Mission constraints", "Not checked"], ["Action authority", "Human review required"],
    ].flatMap(([key, value]) => [node("dt", key), node("dd", value)]));
    $("companion-result").replaceChildren(node("p", reason, "companion-empty"));
    $("companion-sources").replaceChildren(node("p", "Sources appear after current retrieval."));
    $("crew-comparison").replaceChildren();
    message(reason);
    controls();
  }
  async function listProfiles(selected) {
    const profiles = await api("/profiles");
    if (busy) return;
    $("crew-select").replaceChildren(new Option("Select a profile", ""), ...profiles.map((p) => new Option(`${p.display_name}${p.is_demo ? " [SYNTHETIC]" : ""}`, p.astronaut_id)));
    if (selected) { $("crew-select").value = selected; await selectProfile(selected); }
  }
  async function connect(event = null) {
    if (busy) return;
    try {
      const priorMode = serviceMode;
      // The first screen works immediately; probing the optional service is explicit.
      serviceMode = event ? "unknown" : "browser";
      message("Opening personal review...");
      const status = await api("/health");
      connected = true;
      const browserOnly = status.mode === "browser";
      $("companion-service").textContent = browserOnly ? "Browser-only / no LLM" : status.llm.available ? `Local ${status.llm.model}` : "Rules ready / LLM unavailable";
      $("companion-connect").textContent = browserOnly && ["localhost", "127.0.0.1"].includes(location.hostname) ? "Check local service" : "Refresh connection";
      $("companion-use-llm").checked = !browserOnly && status.llm.available;
      $("companion-use-llm").disabled = browserOnly || !status.llm.available;
      $("companion-prompt-group").hidden = browserOnly;
      $("browser-review-note").hidden = !browserOnly;
      if (priorMode !== "unknown" && priorMode !== serviceMode) await selectProfile("");
      await listProfiles(profile?.astronaut_id);
      message(browserOnly
        ? "Browser-only review: consented aggregates stay here. Fixed rules and cited NASA context are used; no LLM or clinical prediction."
        : status.llm.available ? "Local model connected. No cloud fallback." : "Local analysis is ready. Install the local model to enable LLM planning; deterministic reviews remain available.");
    } catch (error) { connected = false; $("companion-service").textContent = "Service unavailable"; message(error.message.includes("fetch") ? "Start the local companion service on port 8010, then connect again." : error.message, true); }
  }
  async function selectProfile(id) {
    const version = ++profileRequest;
    profile = null;
    history = [];
    radiationHistory = [];
    healthHistory = [];
    followups = []; reviewDay = Infinity;
    $("companion-red-flag").checked = false;
    invalidateReport();
    renderProfile();
    if (!id) return;
    const data = await api(`/profiles/${encodeURIComponent(id)}`);
    if (version !== profileRequest) return;
    profile = data.profile; history = data.history; radiationHistory = data.radiation || [];
    healthHistory = data.health || [];
    followups = data.followups || [];
    $("crew-day").value = history.at(-1)?.mission_day ?? 1;
    $("crew-gravity").value = history.at(-1)?.gravity || "earth";
    renderProfile();
    message(profile.is_demo ? "SYNTHETIC DEMONSTRATION: these observations are scripted, not astronaut or clinical data." : "Real-observation profile selected. Only consented aggregates are stored.");
  }
  function renderProfile() {
    casePanel.update({ profile, history, health: healthHistory, radiation: radiationHistory, followups, day: reviewDay, redFlags: $("companion-red-flag").checked });
    const rows = visibleHistory();
    multisystem.update(profile, healthHistory.filter(row => row.mission_day <= reviewDay), rows);
    activeStrip.textContent = profile ? `${profile.display_name} / ${profile.astronaut_id} / Day ${rows.at(-1)?.mission_day ?? "--"}${profile.is_demo ? " / SYNTHETIC: camera captures cannot be saved to this profile" : " / local observation record"}` : "No crew selected / captures are unassigned until saved with consent";
    window.dispatchEvent(new CustomEvent("astrobone-active-case", { detail: { profile, day: rows.at(-1)?.mission_day ?? null } }));
    $("crew-identity").replaceChildren();
    if (profile) {
      $("crew-identity").append(node("strong", profile.display_name), node("p", profile.mission_name), node("p", profile.astronaut_id), node("small", profile.equipment.join(" / ") || "No equipment listed"));
      if (profile.is_demo) $("crew-identity").append(node("strong", "SYNTHETIC DEMO", "companion-demo-badge"));
    }
    const keys = [...new Set(history.flatMap((row) => Object.keys(row.metrics)))];
    const selected = $("crew-metric").value;
    $("crew-metric").replaceChildren(...keys.map((key) => new Option(formatMetric(key), key)));
    if (keys.includes(selected)) $("crew-metric").value = selected;
    const baseline = history.find((row) => row.is_baseline);
    $("crew-baseline-note").textContent = baseline ? `Locked baseline: Day ${baseline.mission_day} / ${baseline.protocol} / ${baseline.gravity} / ${Math.round(baseline.tracking_quality*100)}% capture quality` : "Baseline not recorded";
    const dose = radiationHistory.filter(row => row.mission_day <= reviewDay).at(-1);
    $("crew-radiation-status").textContent = dose
      ? `Day ${dose.mission_day}: ${dose.cumulative_personal_absorbed_dose_mgy} mGy ${profile?.is_demo ? "SYNTHETIC" : "entered"} for ${dose.instrument_id}. Context only.`
      : "No personal dosimeter record";
    $("crew-dose-day").value = dose?.mission_day ?? history.at(-1)?.mission_day ?? 1;
    $("crew-instrument-id").value = dose?.instrument_id ?? "";
    $("crew-dose-mgy").value = "";
    $("crew-dose-consent").checked = false;
    controls(); drawTimeline();
  }
  function drawTimeline() {
    const canvas = $("crew-timeline"), key = $("crew-metric").value;
    const rows = visibleHistory().filter((row) => Number.isFinite(row.metrics[key]));
    canvas.hidden = !rows.length; $("crew-timeline-empty").hidden = Boolean(rows.length);
    if (!rows.length || panel.hidden) return;
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(320, rect.width * ratio); canvas.height = 240 * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const w = canvas.width/ratio, h = 240, left = 48, right = w-20, bottom = 198, top = 22;
    const minDay = Math.min(...rows.map((r) => r.mission_day)), maxDay = Math.max(minDay+1, ...rows.map((r) => r.mission_day));
    const maxValue = Math.max(1, ...rows.map((r) => r.metrics[key])) * 1.15;
    const x = (day) => left + (day-minDay)/(maxDay-minDay)*(right-left);
    const y = (value) => bottom - value/maxValue*(bottom-top);
    const dark = document.documentElement.dataset.theme === "dark";
    ctx.font = "12px sans-serif"; ctx.fillStyle = dark ? "#bdcdc7" : "#465e55";
    for (let i=0;i<4;i++) { const value=maxValue*i/3, yy=y(value); ctx.fillText(value.toFixed(0),4,yy+4); ctx.strokeStyle=dark?"#34433d":"#d9e3de"; ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke(); }
    const baseline = rows.find((row) => row.is_baseline);
    if (baseline) {ctx.setLineDash([4,4]);ctx.strokeStyle="#cc8351";ctx.beginPath();ctx.moveTo(left,y(baseline.metrics[key]));ctx.lineTo(right,y(baseline.metrics[key]));ctx.stroke();ctx.setLineDash([]);}
    ctx.strokeStyle=dark?"#75e6c2":"#087f6f";ctx.lineWidth=2;ctx.beginPath();let connectedPoint=false;
    rows.forEach(r=>{if(!captureUsable(r)){connectedPoint=false;return;}if(connectedPoint)ctx.lineTo(x(r.mission_day),y(r.metrics[key]));else ctx.moveTo(x(r.mission_day),y(r.metrics[key]));connectedPoint=true;});ctx.stroke();
    rows.forEach(r=>{const xx=x(r.mission_day),yy=y(r.metrics[key]);if(captureUsable(r)){ctx.fillStyle=dark?"#75e6c2":"#087f6f";ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fill();}else{ctx.strokeStyle="#c88920";ctx.beginPath();ctx.moveTo(xx-5,yy-5);ctx.lineTo(xx+5,yy+5);ctx.moveTo(xx+5,yy-5);ctx.lineTo(xx-5,yy+5);ctx.stroke();}});
    ctx.fillStyle=dark?"#bdcdc7":"#465e55";ctx.fillText(`Day ${minDay}`,left,bottom+24);ctx.textAlign="right";ctx.fillText(`Day ${maxDay}`,right,bottom+24);
    canvas.setAttribute("aria-label", `${formatMetric(key)}: ${rows.map(r=>`Day ${r.mission_day}, ${captureUsable(r)?r.metrics[key]:"withheld, poor capture"}`).join("; ")}. Dashed line is the locked baseline. Crosses mark withheld observations.`);
  }
  function renderTrace(trace) {
    const latest = new Map(trace.map(row => [row.tool, row]));
    $("companion-trace").replaceChildren(...[...latest.values()].map((row) => {
      const li=node("li"); li.dataset.state=row.status;
      li.append(node("strong", `${row.agent} / ${row.status}`), node("span", row.tool.replaceAll("_", " ")), node("small", row.detail || `${row.elapsed_ms} ms`)); return li;
    }));
  }
  function renderReport(value) {
    report=value; const result=$("companion-result"); result.replaceChildren();
    result.append(node("h4", value.priority.status.replaceAll("_", " ")),node("p",value.priority.reason),node("small", `${value.engine} / ${value.model}${value.is_demo?" / SYNTHETIC":""}`));
    if (value.environment) {
      const context = node("section", "", "companion-environment");
      const radiation = value.environment.radiation;
      context.append(node("h4", "Mission environment"), node("p", ["instrument_recorded", "synthetic"].includes(radiation.status)
        ? `${radiation.status === "synthetic" ? "SYNTHETIC" : "User-entered"} personal dosimeter: ${radiation.cumulative_personal_absorbed_dose_mgy} mGy cumulative absorbed dose, Day ${radiation.reading_day}, instrument ${radiation.instrument_id}.`
        : "Personal radiation dose: not provided."), node("small", radiation.interpretation));
      const source = node("a", "NASA radiation monitoring context");
      source.href = radiation.source_url; source.target = "_blank"; source.rel = "noopener noreferrer";
      context.append(source);
      result.append(context);
    }
    const list=node("ul"); value.findings.forEach(f=>list.append(node("li",f.text))); result.append(list);
    if (value.multisystem) result.append(node("p", value.multisystem.interpretation, "health-caution"));
    for (const action of value.actions) {const item=node("p",action.text);item.append(node("small",action.approval));result.append(item);}
    value.warnings.forEach(w=>result.append(node("p",w,"companion-warning")));
    $("crew-comparison").replaceChildren(...value.comparison.changes.map(row=>{
      const tr=node("tr"); [formatMetric(row.metric),`${row.baseline} ${row.unit}`,`${row.current} ${row.unit}`,row.percent_change===null?`${row.delta} ${row.unit}`:`${row.percent_change>0?"+":""}${row.percent_change.toFixed(1)}%`].forEach(text=>tr.append(node("td",text))); return tr;
    }));
    $("companion-sources").replaceChildren(...value.evidence.map(source=>{
      const article=node("article"); const a=node("a",source.title);a.href=source.url;a.target="_blank";a.rel="noopener noreferrer";
      article.append(a,node("small",`${source.id} / ${source.section}`),node("p",source.text),node("small",source.population));return article;
    }));
    $("companion-gates").replaceChildren(...Object.entries(value.verification).flatMap(([key,gate])=>[node("dt",key),node("dd",`${gate.status.replaceAll("_"," ")}. ${gate.detail}`)]));
    renderTrace(value.trace); controls();
  }
  async function review(event) {
    event.preventDefault(); if (!profile || busy) return;
    busy=true; invalidateReport("Review in progress. No current report is approved.");
    const version = reviewRevision;
    $("companion-result").replaceChildren(node("p", "Review in progress. No current report is approved.", "companion-empty"));
    $("companion-sources").replaceChildren(node("p", "Retrieval pending."));
    $("companion-gates").replaceChildren(node("dt", "Verification"), node("dd", "Pending current review"));
    message(serviceMode === "browser"
      ? "Comparing stored aggregates with fixed rules; no model request is sent."
      : "Running local review. Only aggregate observations are provided to the local model.");
    try {
      const run=await api("/runs",{method:"POST",body:JSON.stringify({astronaut_id:profile.astronaut_id,as_of_day:Number.isFinite(reviewDay)?reviewDay:null,prompt:$("companion-prompt").value,use_llm:$("companion-use-llm").checked,red_flags:$("companion-red-flag").checked?["new_severe_pain"]:[]})});
      const deadline=Date.now()+7*60*1000;
      while (Date.now()<deadline) {
        const state=await api(`/runs/${run.id}`);
        if (version !== reviewRevision) return;
        renderTrace(state.trace);
        if(state.status==="complete"){renderReport(state.report);message(state.report.is_demo?"Synthetic scenario review complete. Clinical predictions remain unavailable.":"Review complete. Any health-related action requires human review.");return;}
        if(state.status==="error")throw new Error(state.error);
        await new Promise(resolve=>setTimeout(resolve,1200));
      }
      throw new Error("Review exceeded the UI wait limit. Check the local service; do not treat this as an approved result.");
    } catch(error){message(error.message,true);} finally{busy=false;controls();}
  }
  $("companion-review-form").addEventListener("submit",review);
  $("companion-connect").addEventListener("click",connect);
  $("crew-select").addEventListener("change",()=>selectProfile($("crew-select").value).catch(e=>message(e.message,true)));
  $("crew-metric").addEventListener("change",drawTimeline);
  $("crew-new").addEventListener("click",()=>$("crew-create-dialog").showModal());
  panel.querySelectorAll("[data-close]").forEach(button=>button.addEventListener("click",()=>$(button.dataset.close).close()));
  $("crew-create-form").addEventListener("submit",async event=>{event.preventDefault();try{const data=new FormData(event.target);const p=await api("/profiles",{method:"POST",body:JSON.stringify({astronaut_id:data.get("astronaut_id"),display_name:data.get("display_name"),mission_name:data.get("mission_name"),equipment:data.getAll("equipment")})});$("crew-create-dialog").close();await listProfiles(p.astronaut_id);}catch(e){message(e.message,true);}});
  $("crew-dose-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!profile || busy) return;
    busy = true; controls();
    try {
      await api(`/profiles/${encodeURIComponent(profile.astronaut_id)}/radiation`, {
        method: "POST", body: JSON.stringify({
          mission_day: Number($("crew-dose-day").value),
          cumulative_personal_absorbed_dose_mgy: Number($("crew-dose-mgy").value),
          instrument_id: $("crew-instrument-id").value.trim(),
          consent_to_store: $("crew-dose-consent").checked,
        }),
      });
      const id = profile.astronaut_id;
      busy = false;
      await selectProfile(id);
      message("Personal dosimeter reading stored as mission context. No combined risk score was calculated.");
    } catch (error) { message(error.message, true); }
    finally { busy = false; controls(); }
  });
  async function loadDemo() { if(busy)return;busy=true;controls();try{const p=await api("/demo",{method:"POST",body:"{}"});busy=false;await listProfiles(p.astronaut_id);reviewDay=180;$("crew-day").value=180;renderProfile();message("SYNTHETIC DEMONSTRATION: one fictional astronaut, one locked baseline. No clinical effect or diagnosis is demonstrated.");}catch(e){message(e.message,true);}finally{busy=false;controls();} }
  $("crew-demo").addEventListener("click", loadDemo);
  $("crew-save").addEventListener("click",()=>{const assessment=getAssessment();$("crew-save-summary").textContent=`Day ${$("crew-day").value}: ${assessment?.sampleCount||0} aggregate samples. No frames will be sent.`;$("crew-as-baseline").disabled=history.some(r=>r.is_baseline);$("crew-as-baseline").checked=!history.some(r=>r.is_baseline);$("crew-store-consent").checked=false;$("crew-save-dialog").showModal();});
  $("crew-save-form").addEventListener("submit",async event=>{event.preventDefault();try{const record=assessmentForCompanion(getAssessment(),Number($("crew-day").value),{baseline:$("crew-as-baseline").checked,consent:$("crew-store-consent").checked,gravity:$("crew-gravity").value});await api(`/profiles/${encodeURIComponent(profile.astronaut_id)}/assessments`,{method:"POST",body:JSON.stringify(record)});$("crew-save-dialog").close();await selectProfile(profile.astronaut_id);message("Aggregate observation stored locally with consent.");}catch(e){message(e.message,true);}});
  $("crew-delete").addEventListener("click",async()=>{if(!profile||!confirm("Delete this local profile, its observations, and reports? This cannot be undone."))return;try{await api(`/profiles/${encodeURIComponent(profile.astronaut_id)}`,{method:"DELETE"});await selectProfile("");await listProfiles();message("Local profile and related records deleted.");}catch(e){message(e.message,true);}});
  $("companion-export").addEventListener("click",()=>{if(!report)return;const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=node("a");a.href=url;a.download=`astrobone-companion-${report.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  window.addEventListener("astrobone-assessment-ready", () => { controls(); updateCaptureStatus(); });
  $("companion-red-flag").addEventListener("change", () => { invalidateReport("Crew condition changed. Previous review invalidated."); renderProfile(); });
  window.addEventListener("resize",drawTimeline);
  window.addEventListener("astrobone-theme-change",drawTimeline);
  async function startPresentation() {
    missionDemo = true;
    if (document.documentElement.dataset.theme !== "dark") document.querySelector("#theme-toggle").click();
    setView("review", { connectIfNeeded: false });
    // The presentation uses an isolated in-memory fixture, never a saved crew record.
  }
  // The mission story lives on the home page (the digital twin); it is not repeated here.
  window.addEventListener("hashchange", () => {
    if (location.hash === "#mission-demo") void startPresentation();
    else if (location.hash === "#crew-companion") { missionDemo = false; setView("review"); }
  });
  const startingMode = ["#crew-companion", "#validation-title", "#mission-demo"].includes(location.hash) ? "review"
    : location.hash === "#research-tools" ? "research" : "capture";
  if (missionDemo) void startPresentation();
  else setView(startingMode, { updateHash: false });
}
