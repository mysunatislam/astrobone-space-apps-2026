import { HEALTH_METRICS, summarizeHealth } from "./healthObservations.js";
import { captureUsable } from "./missionCase.js";
import "./multisystem.css";

const element = (tag, text, className = "") => { const el = document.createElement(tag); el.textContent = text; el.className = className; return el; };
const sourceLabel = source => ({ instrument: "Manual instrument reading", camera_rppg: "Experimental webcam estimate", synthetic: "SYNTHETIC" })[source] || source;

export function createMultisystemPanel({ parent, save, getDay, getPulse }) {
  const section = document.createElement("section"); section.className = "companion-band multisystem-band";
  section.innerHTML = `<div class="companion-band-heading"><div><span class="section-label">MOVEMENT / CARDIOVASCULAR / EXPOSURE</span><h3>Multisystem observations</h3></div><button type="button" id="health-export" disabled>Export observations</button></div>
    <p id="health-profile-status" role="status">Select a crew profile.</p>
    <div class="health-coverage" id="health-coverage"></div>
    <div class="companion-table-scroll"><table><thead><tr><th>Measurement / source</th><th>First reference</th><th>Latest</th><th>Change</th></tr></thead><tbody id="health-comparison"></tbody></table></div>
    <h4>Exposure and physiology timeline</h4><div id="health-charts" class="health-charts"></div>
    <p class="health-caution">Separate axes and acquisition protocols. Co-occurring changes do not establish radiation causation, disease, or bone loss.</p>
    <details id="health-entry"><summary>Record a sensor observation</summary><form id="health-form" class="health-form">
      <label>Source<select name="source"><option value="instrument">Manual instrument reading</option><option value="camera_rppg">Current webcam pulse estimate</option></select></label>
      <label>Measurement<select name="metric">${Object.entries(HEALTH_METRICS).map(([key, spec]) => `<option value="${key}">${spec.label} (${spec.unit})</option>`).join("")}</select></label>
      <label>Value<input name="value" type="number" step="any" required /></label>
      <label>Device ID<input name="device_id" maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" placeholder="PPG-001" required /></label>
      <label>Protocol<input name="protocol" maxlength="80" minlength="3" value="resting-seated-5min-v1" required /></label>
      <label>Measurement time<input name="observed_at" type="datetime-local" required /></label>
      <label class="health-consent"><input name="consent" type="checkbox" required /> Save this aggregate locally. Device provenance is not authenticated.</label>
      <button type="submit" class="primary-action">Save reading</button><p id="health-form-status" role="status"></p>
    </form></details>
    <div class="health-evidence"><a href="https://www.nasa.gov/directorates/esdmd/hhp/cv-risk/" target="_blank" rel="noopener noreferrer">NASA cardiovascular risk context</a><span>Research context, not validation of this prototype.</span></div>`;
  parent.prepend(section);
  const $ = selector => section.querySelector(selector), form = $("#health-form");
  let profile = null, rows = [], movements = [];
  function resetTime() { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); form.elements.observed_at.value = date.toISOString().slice(0, 16); }
  resetTime();
  function configure() {
    const camera = form.elements.source.value === "camera_rppg";
    form.elements.metric.disabled = camera; form.elements.value.readOnly = camera;
    form.elements.observed_at.readOnly = camera; form.elements.device_id.readOnly = camera; form.elements.protocol.readOnly = camera;
    if (camera) { form.elements.metric.value = "heart_rate_bpm"; form.elements.device_id.value = "WEBCAM-POS"; form.elements.protocol.value = "seated-camera-pulse-v1"; form.elements.value.value = getPulse()?.bpm ?? ""; resetTime(); }
    const spec = HEALTH_METRICS[form.elements.metric.value];
    form.elements.value.min = spec.min; form.elements.value.max = spec.max;
  }
  form.elements.source.addEventListener("change", configure); form.elements.metric.addEventListener("change", configure); configure();
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (!profile || profile.is_demo) return;
    const status = $("#health-form-status"), button = form.querySelector("button"); button.disabled = true;
    try {
      const camera = form.elements.source.value === "camera_rppg", pulse = getPulse();
      if (camera && (!pulse || pulse.status !== "estimated" || performance.now() - pulse.receivedAt > 5000)) throw new Error("A fresh, quality-qualified webcam pulse estimate is required.");
      await save(profile.astronaut_id, { mission_day: getDay(), observed_at: camera ? new Date().toISOString() : new Date(form.elements.observed_at.value).toISOString(), source: form.elements.source.value, device_id: form.elements.device_id.value.trim(), protocol: form.elements.protocol.value.trim(), metrics: { [form.elements.metric.value]: camera ? pulse.bpm : Number(form.elements.value.value) }, quality: camera ? pulse.quality : 1, consent_to_store: form.elements.consent.checked });
      status.textContent = "Observation saved. No clinical interpretation assigned."; form.elements.consent.checked = false; resetTime();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  function chart(series, minDay, maxDay) {
    const wrapper = element("div", "", "health-chart"), heading = element("strong", `${series.label} (${series.unit})`);
    const canvas = document.createElement("canvas"); canvas.width = 700; canvas.height = 120; canvas.setAttribute("role", "img");
    const points = series.points;
    canvas.setAttribute("aria-label", points.map(p => `Day ${p.day}: ${p.quality >= .6 ? `${p.value} ${series.unit}` : "withheld, low quality"}`).join("; "));
    wrapper.append(heading, element("small", `${sourceLabel(series.source)} / ${series.device} / ${series.protocol}`), canvas);
    const ctx = canvas.getContext("2d"), low = Math.min(...points.map(p => p.value)), high = Math.max(...points.map(p => p.value));
    const pad = Math.max((high - low) * .15, high * .03, .1), x = d => 65 + (d - minDay) / Math.max(1, maxDay - minDay) * 610, y = v => 80 - (v - low + pad) / (high - low + 2 * pad) * 60;
    ctx.font = "12px sans-serif"; ctx.fillStyle = "#829d9d"; ctx.strokeStyle = "#789090"; ctx.lineWidth = 1;
    ctx.fillText((high + pad).toFixed(1), 3, 20); ctx.fillText((low - pad).toFixed(1), 3, 85);
    ctx.beginPath(); ctx.moveTo(65, 90); ctx.lineTo(675, 90); ctx.stroke();
    ctx.fillText(`Day ${minDay}`, 65, 110); ctx.textAlign = "right"; ctx.fillText(`Day ${maxDay}`, 675, 110);
    ctx.strokeStyle = series.system === "exposure" ? "#ce922d" : series.system === "movement" ? "#21a492" : "#e76e8b"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
    // Observations are discrete; a line is a visual connector, not interpolated evidence.
    ctx.beginPath(); let connected = false;
    points.forEach(p => { if (p.quality < .6) { connected = false; return; } if (connected) ctx.lineTo(x(p.day), y(p.value)); else ctx.moveTo(x(p.day), y(p.value)); connected = true; }); ctx.stroke();
    points.filter(p => p.quality >= .6).forEach(p => { ctx.beginPath(); ctx.arc(x(p.day), y(p.value), 4, 0, Math.PI * 2); ctx.fill(); });
    return wrapper;
  }
  function render() {
    const summary = summarizeHealth(rows), body = $("#health-comparison"); body.replaceChildren();
    $("#health-export").disabled = !profile;
    $("#health-profile-status").textContent = profile ? `${profile.display_name} / ${profile.is_demo ? "SYNTHETIC DEMONSTRATION" : "Consented local observations"}` : "Select a crew profile.";
    $("#health-entry").hidden = !profile || profile.is_demo;
    $("#health-coverage").replaceChildren(...[["Movement", movements.length], ["Cardiovascular", summary.coverage.cardiovascular], ["Exposure", summary.coverage.exposure]].map(([label, present]) => element("span", `${label}: ${present ? "recorded" : "missing"}`)));
    for (const s of summary.series) {
      const tr = document.createElement("tr"), title = element("td", s.label); title.append(element("small", `${sourceLabel(s.source)} / ${s.device} / ${s.protocol}`));
      tr.append(title, element("td", s.first ? `${s.first.value} ${s.unit} / Day ${s.first.day}` : "Insufficient quality"), element("td", s.last ? `${s.last.value} ${s.unit} / Day ${s.last.day}` : `Withheld / Day ${s.latestDay}`), element("td", s.delta === null ? "Usable follow-up needed" : `${s.delta > 0 ? "+" : ""}${Number(s.delta.toFixed(2))} ${s.unit}`)); body.append(tr);
    }
    if (!summary.series.length) { const tr = document.createElement("tr"), td = element("td", "No cardiovascular or dose-equivalent observations saved."); td.colSpan = 4; tr.append(td); body.append(tr); }
    const series = [...summary.series];
    const movementSeries = new Map();
    for (const row of movements) {
      const value = row.metrics.knee_extension_deg; if (!Number.isFinite(value)) continue;
      const key = JSON.stringify([row.protocol, row.gravity, row.source, row.pose_model]);
      if (!movementSeries.has(key)) movementSeries.set(key, { label: "Knee extension", unit: "deg", system: "movement", source: row.source, device: row.pose_model, protocol: `${row.protocol} / ${row.gravity}`, points: [] });
      movementSeries.get(key).points.push({ day: row.mission_day, value, quality: captureUsable(row) ? 1 : 0 });
    }
    series.push(...movementSeries.values());
    const days = series.flatMap(s => s.points.map(p => p.day)), min = Math.min(...days), max = Math.max(...days);
    $("#health-charts").replaceChildren(...series.map(s => chart(s, min, max)));
    if (!series.length) $("#health-charts").append(element("p", "No longitudinal data yet."));
    window.dispatchEvent(new CustomEvent("astrobone-health-history", { detail: { profile, rows, summary } }));
  }
  $("#health-export").addEventListener("click", () => {
    if (!profile) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: "astrobone-multisystem-v1", astronaut_id: profile.astronaut_id, synthetic: profile.is_demo, observations: rows, movement: movements, review: summarizeHealth(rows) }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `astrobone-${profile.astronaut_id}-multisystem.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return { update(nextProfile, nextRows, nextMovements) { profile = nextProfile; rows = nextRows; movements = nextMovements; render(); } };
}
