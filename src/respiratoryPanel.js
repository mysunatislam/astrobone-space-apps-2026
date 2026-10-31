import "./respiratoryPanel.css";
import { estimateRespiratoryMotion, RESPIRATORY_PROTOCOL, validateDepthRecording } from "./respiratoryMotion.js";
import { fingerprintDepthSamples, hasSavedRespiratoryCapture } from "./respiratoryHistory.js";

const HISTORY_KEY = "astrobone.respiratory.accepted.v1";
const PROFILE_KEY = "astrobone.respiratory.profile.v1";
const W = 160, H = 120, CAPTURE_SECONDS = 45;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const median = xs => { const sorted = [...xs].sort((a, b) => a - b), count = sorted.length; return count ? (sorted[Math.floor((count - 1) / 2)] + sorted[Math.floor(count / 2)]) / 2 : 0; };
const average = xs => xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : 0;

// Small Lucas–Kanade patches measure subpixel image displacement. The background
// patches estimate common camera translation; pose movement supplies a second gate.
// This is a prototype optical-flow implementation, not validated respiratory sensing.
function patchFlow(previous, current, x, y, radius = 5) {
  x = Math.round(x); y = Math.round(y);
  if (x < radius + 1 || x >= W - radius - 1 || y < radius + 1 || y >= H - radius - 1) return null;
  let temporalMean = 0, count = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { const k = (y + dy) * W + x + dx; temporalMean += current[k] - previous[k]; count++; }
  temporalMean /= count;
  let xx = 0, yy = 0, xy = 0, xt = 0, yt = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const k = (y + dy) * W + x + dx;
    const gx = (previous[k + 1] - previous[k - 1] + current[k + 1] - current[k - 1]) / 4;
    const gy = (previous[k + W] - previous[k - W] + current[k + W] - current[k - W]) / 4;
    const gt = current[k] - previous[k] - temporalMean;
    xx += gx * gx; yy += gy * gy; xy += gx * gy; xt += gx * gt; yt += gy * gt;
  }
  const det = xx * yy - xy * xy, trace = xx + yy;
  if (trace < 120 || det < 0.005 * trace * trace) return null;
  const u = (xy * yt - yy * xt) / det, v = (xy * xt - xx * yt) / det;
  if (!Number.isFinite(u) || !Number.isFinite(v) || Math.hypot(u, v) > 2.5) return null;
  return { u, v, lightChange: Math.abs(temporalMean) };
}

function torsoRegion(landmarks) {
  const points = [11, 12, 23, 24].map(i => landmarks?.[i]);
  if (!points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0.03 && p.x < 0.97 && p.y > 0.03 && p.y < 0.97 && Math.min(p.visibility ?? 1, p.presence ?? 1) >= RESPIRATORY_PROTOCOL.minVisibility)) return null;
  const [a, b, c, d] = points, top = (a.y + b.y) / 2, bottom = (c.y + d.y) / 2;
  const left = Math.min(a.x, b.x, c.x, d.x), right = Math.max(a.x, b.x, c.x, d.x);
  if (bottom - top < 0.16 || right - left < 0.12 || Math.abs(a.y - b.y) > 0.12) return null;
  return { left, right, top, bottom, x: average(points.map(p => p.x)), y: average(points.map(p => p.y)), scale: bottom - top, visibility: Math.min(...points.map(p => p.visibility ?? 1)) };
}

function loadHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value.filter(r => r && typeof r.id === "string" && typeof r.protocol === "string" && ["webcam", "depth"].includes(r.source) && Number.isFinite(r.rate) && r.rate >= 6 && r.rate <= 40 && Number.isFinite(r.quality) && Number.isFinite(Date.parse(r.recordedAt))).slice(-100) : [];
  } catch { return []; }
}

function syntheticSamples() {
  return Array.from({ length: 451 }, (_, i) => ({ t: i * 100, chest: 1.8 * Math.sin(2 * Math.PI * 0.25 * i / 10) + 0.03 * Math.sin(i * 0.8), abdomen: 1.2 * Math.sin(2 * Math.PI * 0.25 * i / 10 - 0.25), motion: 0, visibility: 1, valid: true }));
}

export function initRespiratoryPanel({ container, video, getSourceKind = () => "camera", getLandmarks = () => null, ensureCamera = null } = {}) {
  if (!container) return { updatePose() {}, destroy() {} };
  container.classList.add("resp-panel");
  container.innerHTML = `<div class="resp-heading"><div><p class="resp-eyebrow">PHYSIOLOGICAL CONTEXT · MODULE 04</p><h2>Every breath. A clearer picture.</h2><p>Experimental respiratory motion estimation, processed on this device.</p></div><span class="resp-badge">EXPERIMENTAL</span></div>
    <div class="resp-profile"><label>LOCAL CREW PROFILE <input data-resp="profile" type="text" maxlength="40" value="crew-01" autocomplete="off" spellcheck="false" aria-label="Local crew profile code"></label><span>Use your own profile code to keep personal trends separate.</span></div>
    <div class="resp-layout"><div class="resp-main"><div class="resp-statline"><div><span class="resp-label">RESPIRATORY MOTION RATE</span><p class="resp-rate"><strong data-resp="rate">—</strong><span>breaths/min</span></p></div><div class="resp-quality"><span class="resp-label">SIGNAL QUALITY</span><strong data-resp="quality">Awaiting capture</strong><span data-resp="source">Normal webcam · image motion</span></div></div>
      <div class="resp-wave-wrap"><span class="resp-wave-label" data-resp="wave-label">45-SECOND MOTION WINDOW</span><canvas data-resp="wave" width="900" height="180" aria-label="Respiratory motion waveform"></canvas><span class="resp-wave-foot">Relative motion · no lung volume measurement</span></div>
      <p class="resp-status" data-resp="status" role="status">Sit facing the camera with shoulders and hips visible. Wear textured clothing and keep the camera still.</p>
      <progress data-resp="progress" max="45" value="0" aria-label="Respiratory capture progress"></progress>
      <div class="resp-actions"><button type="button" class="resp-primary" data-resp="capture">Start 45-second check</button><button type="button" data-resp="demo">Preview demo</button><button type="button" data-resp="save" disabled>Save usable reading</button><button type="button" data-resp="export" disabled>Export capture</button></div>
      <p class="resp-local-note">Saving is optional. Only aggregate readings stay in this browser; camera frames and raw video are never stored by this module.</p></div>
    <aside class="resp-diagnostics"><div class="resp-diag-title"><span class="resp-label">CAPTURE DIAGNOSTICS</span><span data-resp="capture-state">IDLE</span></div><div class="resp-body-map" aria-label="Chest and abdomen relative image motion map"><div class="resp-map-grid" data-resp="map"></div><span>CHEST</span><span>ABDOMEN</span></div><p class="resp-map-caption" data-resp="map-caption">Webcam: relative optical-flow map, not depth.</p><dl><div><dt>Torso tracking</dt><dd data-resp="tracking">Waiting</dd></div><div><dt>Usable samples</dt><dd data-resp="samples">0</dd></div><div><dt>Camera / body movement</dt><dd data-resp="movement">Waiting</dd></div><div><dt>Reference validation</dt><dd>Not yet validated</dd></div></dl></aside></div>
    <div class="resp-lower"><div class="resp-history"><div class="resp-history-heading"><h3>Your usable measurements</h3><button type="button" data-resp="clear">Clear this profile</button></div><p data-resp="baseline">Save three usable readings with the same source to establish your own baseline.</p><div class="resp-history-trend" data-resp="trend"></div><div data-resp="history"></div></div><details class="resp-depth"><summary>Depth camera & research details</summary><p>An ordinary webcam cannot measure depth. Import a recording from a compatible RGB-D camera adapter with measured chest and abdomen distances, timestamps, and declared camera/body motion compensation.</p><label class="resp-import">Import depth JSON<input data-resp="depth" type="file" accept=".json,application/json"></label><p>Format: <code>schema: "astrobone-depth-respiratory-v1", units: "mm", motionCompensated: true, samples: [{t, chest, abdomen, motion, visibility}]</code>. Time is milliseconds; distances are millimeters. Region summaries are imported, not pixel depth heatmaps.</p><p>Supported motion periodicity: 6–40 breaths/min. Short, irregular, poorly tracked, or moving captures are rejected. A periodic motion signal alone does not prove that breathing caused it.</p><p>Respiratory-belt comparison is still required. This module does not measure oxygen saturation, diagnose illness, or infer bone loss.</p><a href="https://github.com/NoceAnto/breath_visual_depthcamera" target="_blank" rel="noopener noreferrer">Depth visualization research inspiration ↗</a><span class="resp-source-note">Independent implementation. Original project code is not bundled.</span></details></div>`;
  const $ = name => container.querySelector(`[data-resp="${name}"]`);
  const map = $("map");
  for (let i = 0; i < 24; i++) map.append(document.createElement("i"));
  const imageCanvas = document.createElement("canvas"); imageCanvas.width = W; imageCanvas.height = H;
  const context = imageCanvas.getContext("2d", { willReadFrequently: true });
  let samples = [], result = null, history = loadHistory(), active = false, demo = false, source = "webcam", previous = null, reference = null;
  let startedAt = 0, lastSample = -Infinity, lastPoseAt = -Infinity, timer = null, chest = 0, abdomen = 0, saved = false, destroyed = false, starting = false, captureId = null, stateVersion = 0;
  let subjectId = "crew-01";
  try { subjectId = localStorage.getItem(PROFILE_KEY)?.trim().slice(0, 40).toLowerCase() || subjectId; } catch { /* browser storage is optional */ }
  $("profile").value = subjectId;

  function setStatus(message) { $("status").textContent = message; }
  function drawWave(wave = []) {
    const canvas = $("wave"), ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(131,184,205,.13)"; ctx.lineWidth = 1;
    for (let x = 0; x <= 900; x += 75) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 180); ctx.stroke(); }
    for (let y = 30; y < 180; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(900, y); ctx.stroke(); }
    if (wave.length < 2) return;
    const values = wave.map(p => typeof p === "number" ? p : p.v), center = average(values), amp = Math.max(0.01, ...values.map(v => Math.abs(v - center)));
    const gradient = ctx.createLinearGradient(0, 0, 900, 0); gradient.addColorStop(0, "#4e9fff"); gradient.addColorStop(0.5, "#7fe3ff"); gradient.addColorStop(1, "#73f4cc");
    ctx.strokeStyle = gradient; ctx.lineWidth = 2.5; ctx.shadowColor = "#74dcff"; ctx.shadowBlur = 8; ctx.beginPath();
    values.forEach((v, i) => { const x = 900 * i / (values.length - 1), y = 90 - (v - center) / amp * 60; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  function updateHistory() {
    const el = $("history"); el.replaceChildren();
    const personalHistory = history.filter(r => (r.subjectId || "crew-01") === subjectId);
    if (!personalHistory.length) { const empty = document.createElement("p"); empty.className = "resp-empty-history"; empty.textContent = "No saved readings for this profile yet. Demo signals never enter your history."; el.append(empty); }
    for (const record of personalHistory.slice(-5).reverse()) {
      const row = document.createElement("div"); row.className = "resp-history-row";
      for (const text of [new Date(record.recordedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), `${record.rate.toFixed(1)} breaths/min`, record.source === "depth" ? "RGB-D import" : "Webcam", `${Math.round(record.quality * 100)}% signal quality`]) { const span = document.createElement("span"); span.textContent = text; row.append(span); }
      el.append(row);
    }
    const protocol = result?.protocol || `${RESPIRATORY_PROTOCOL.id}-${source}`;
    const comparable = personalHistory.filter(r => r.protocol === protocol && r.source === source).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
    const prior = comparable.slice(0, -1), sourceLabel = source === "depth" ? "RGB-D" : "webcam";
    if (prior.length >= 3) {
      const baseline = median(prior.map(r => r.rate)), difference = comparable.at(-1).rate - baseline;
      $("baseline").textContent = `Latest ${sourceLabel} reading: ${difference >= 0 ? "+" : ""}${difference.toFixed(1)} breaths/min versus your prior median of ${baseline.toFixed(1)} (${prior.length} prior usable readings). Descriptive change only; no medical threshold.`;
    } else if (comparable.length >= 3) {
      $("baseline").textContent = `Your initial ${sourceLabel} median: ${median(comparable.map(r => r.rate)).toFixed(1)} breaths/min from 3 usable readings. The next saved reading can be compared against these three prior measurements.`;
    } else {
      $("baseline").textContent = `Save ${3 - comparable.length} more usable ${sourceLabel} reading${3 - comparable.length === 1 ? "" : "s"} to establish your own baseline.`;
    }
    drawHistoryTrend(comparable);
  }
  function drawHistoryTrend(comparable) {
    const target = $("trend"); target.replaceChildren();
    if (!comparable.length) { target.hidden = true; return; }
    target.hidden = false;
    const records = comparable.slice(-12), values = records.map(r => r.rate);
    const min = Math.max(0, Math.floor(Math.min(...values) - 2)), max = Math.ceil(Math.max(...values) + 2);
    const namespace = "http://www.w3.org/2000/svg";
    const node = (tag, attrs = {}, text = null) => {
      const item = document.createElementNS(namespace, tag);
      for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value));
      if (text !== null) item.textContent = text; return item;
    };
    const svg = node("svg", { viewBox: "0 0 480 136", role: "img", "aria-label": `${records.length} saved ${source === "depth" ? "depth" : "webcam"} readings for ${subjectId}, in saved reading order: ${values.map(v => v.toFixed(1)).join(", ")} breaths per minute. Same source and protocol only.` });
    svg.append(node("title", {}, "Personal respiratory motion history"));
    svg.append(node("desc", {}, "Only saved usable readings from the selected crew profile, capture source and protocol are shown. The vertical scale is labeled in breaths per minute; readings are evenly spaced in saved order, not elapsed time. Demo signals are excluded."));
    const y = value => 104 - (value - min) / (max - min) * 78;
    for (const value of [min, (min + max) / 2, max]) {
      svg.append(node("line", { x1: 38, x2: 466, y1: y(value), y2: y(value), class: "resp-trend-grid" }));
      svg.append(node("text", { x: 29, y: y(value) + 3, "text-anchor": "end", class: "resp-trend-axis" }, value.toFixed(1)));
    }
    const points = records.map((record, i) => ({ x: records.length === 1 ? 252 : 44 + i * 416 / (records.length - 1), y: y(record.rate), record }));
    if (points.length > 1) svg.append(node("polyline", { points: points.map(p => `${p.x},${p.y}`).join(" "), class: "resp-trend-line" }));
    points.forEach((point, i) => {
      const circle = node("circle", { cx: point.x, cy: point.y, r: i === points.length - 1 ? 4 : 3, class: i === points.length - 1 ? "resp-trend-point resp-trend-latest" : "resp-trend-point" });
      circle.append(node("title", {}, `${new Date(point.record.recordedAt).toLocaleString()}: ${point.record.rate.toFixed(1)} breaths/min`)); svg.append(circle);
    });
    svg.append(node("text", { x: 38, y: 12, class: "resp-trend-axis" }, "BREATHS / MIN"));
    svg.append(node("text", { x: 38, y: 127, class: "resp-trend-axis" }, "SAVED READING ORDER"));
    svg.append(node("text", { x: 466, y: 127, "text-anchor": "end", class: "resp-trend-axis" }, "LATEST"));
    target.append(svg);
    const caption = document.createElement("p"); caption.textContent = `Last ${records.length} usable ${source === "depth" ? "RGB-D" : "webcam"} reading${records.length === 1 ? "" : "s"} · ${subjectId} · same protocol`; target.append(caption);
  }
  function render(final = false) {
    result = estimateRespiratoryMotion(samples, { source });
    const canReport = result.status === "estimated";
    $("rate").textContent = canReport ? result.rate.toFixed(1) : "—";
    $("quality").textContent = result.quality > 0 ? `${Math.round(result.quality * 100)}% · ${canReport ? "usable motion" : "insufficient"}` : "No usable signal yet";
    $("source").textContent = demo ? "SYNTHETIC DEMO · no camera measurement" : source === "depth" ? "RGB-D import · measured mm, adapter-supplied" : "Normal webcam · image motion";
    $("wave-label").textContent = demo ? "SYNTHETIC DEMONSTRATION · NOT A MEASUREMENT" : source === "depth" ? "IMPORTED DEPTH MOTION · REGION SUMMARY" : "45-SECOND MOTION WINDOW";
    $("capture-state").textContent = demo ? "DEMO" : active ? "CAPTURING" : final ? canReport ? "USABLE" : "REJECTED" : "IDLE";
    container.dataset.state = demo ? "demo" : result.status;
    $("samples").textContent = String(samples.filter(s => s.valid !== false).length);
    const duplicate = hasSavedRespiratoryCapture(history, { captureId, subjectId, source, protocol: result.protocol });
    $("save").disabled = active || demo || !canReport || saved || duplicate;
    if (duplicate) $("save").textContent = "Recording already saved";
    $("export").disabled = active || samples.length === 0;
    if (result.waveform?.length) drawWave(result.waveform);
    else if (samples.length > 1) drawWave(samples.slice(-300).map(s => s.chest));
    setStatus(`${demo ? "Synthetic example. " : ""}${active ? `${Math.min(45, Math.floor((performance.now() - startedAt) / 1000))}/45 seconds · ` : ""}${result.reason}${final && canReport && !demo ? " · Save this reading only if you followed the still, seated capture protocol." : ""}`);
    updateHistory();
  }
  function stopCapture() {
    stateVersion++;
    active = false; clearInterval(timer); timer = null;
    $("capture").textContent = "Start 45-second check"; $("demo").disabled = false; $("depth").disabled = false; $("profile").disabled = false;
    render(true);
  }
  function resetMotion() {
    stateVersion++;
    samples = []; result = null; previous = null; reference = null; chest = 0; abdomen = 0; lastSample = -Infinity; saved = false; captureId = null;
    for (const cell of map.children) cell.style.opacity = ".18";
    drawWave(); $("progress").value = 0; $("save").textContent = "Save usable reading";
    $("rate").textContent = "—"; $("quality").textContent = "Awaiting capture"; $("save").disabled = true; $("export").disabled = true;
  }
  async function startCapture() {
    if (starting) return;
    if (active) { stopCapture(); return; }
    const requestedVersion = ++stateVersion;
    if (ensureCamera) {
      starting = true;
      try { await ensureCamera(); } catch (error) { if (stateVersion === requestedVersion && !destroyed) setStatus(`Camera could not start: ${error.message}`); return; }
      finally { starting = false; }
    }
    if (destroyed || stateVersion !== requestedVersion) return;
    if (getSourceKind() !== "camera" || !video?.srcObject || video.readyState < 2) { setStatus("Start the Live Capture camera above, then begin the respiratory check. Prerecorded video is not a live measurement."); return; }
    resetMotion(); active = true; demo = false; source = "webcam"; startedAt = performance.now(); lastPoseAt = startedAt;
    $("capture").textContent = "Stop & review capture"; $("demo").disabled = true; $("depth").disabled = true; $("profile").disabled = true;
    $("map-caption").textContent = "Webcam: relative optical-flow map, not depth.";
    $("tracking").textContent = "Waiting for torso";
    timer = setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000; $("progress").value = Math.min(45, elapsed);
      if (performance.now() - lastPoseAt > 900) { samples.push({ t: performance.now(), chest, abdomen, motion: 0, visibility: 0, valid: false }); $("tracking").textContent = "Tracking lost"; }
      if (elapsed >= CAPTURE_SECONDS || getSourceKind() !== "camera") stopCapture(); else render();
    }, 500);
    setStatus("Capture started. Breathe naturally, keep still, and keep shoulders and hips in view.");
  }
  function updatePose(frame, suppliedLandmarks) {
    if (!active || source !== "webcam") return;
    const now = performance.now(); lastPoseAt = now;
    if (now - lastSample < 95) return;
    lastSample = now;
    const torso = torsoRegion(suppliedLandmarks ?? getLandmarks());
    if (!frame || !torso || video?.readyState < 2 || getSourceKind() !== "camera") {
      samples.push({ t: now, chest, abdomen, motion: 0, visibility: 0, valid: false }); previous = null;
      $("tracking").textContent = "Torso not usable"; return;
    }
    try {
      context.drawImage(video, 0, 0, W, H);
      const rgba = context.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H);
      for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114;
      if (!reference) reference = { ...torso };
      if (!previous) { previous = gray; return; }
      const background = [];
      for (const y of [18, 60, 102]) for (const x of [12, 28, 132, 148]) {
        if (x / W > torso.left - .04 && x / W < torso.right + .04 && y / H > torso.top - .05 && y / H < torso.bottom + .05) continue;
        const flow = patchFlow(previous, gray, x, y); if (flow) background.push(flow);
      }
      const commonU = median(background.map(p => p.u)), commonV = median(background.map(p => p.v));
      const regions = [[], []]; let good = 0;
      for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
        const x = (torso.left + (col + .5) / 4 * (torso.right - torso.left)) * W;
        const y = (torso.top + (.12 + .76 * (row + .5) / 6) * (torso.bottom - torso.top)) * H;
        const flow = patchFlow(previous, gray, x, y, 4), cell = map.children[row * 4 + col];
        if (flow) {
          good++;
          const u = flow.u - commonU, v = flow.v - commonV;
          // Outward chest/abdomen displacement; global translation is removed.
          regions[row < 3 ? 0 : 1].push(.75 * u * (col < 2 ? -1 : 1) + .25 * v);
          cell.style.opacity = String(clamp(.18 + Math.hypot(u, v) * 1.3, .18, 1));
        } else cell.style.opacity = ".1";
      }
      chest += average(regions[0]); abdomen += average(regions[1]);
      const positionChange = Math.hypot(torso.x - reference.x, torso.y - reference.y);
      const motion = Math.max(positionChange, Math.abs(torso.scale / reference.scale - 1) * .5, Math.hypot(commonU / W, commonV / H));
      const light = average(gray), lightChange = average(background.map(p => p.lightChange));
      const valid = good >= 12 && regions.every(r => r.length >= 4) && background.length >= 2 && light > 20 && light < 235 && lightChange < 8;
      samples.push({ t: now, chest, abdomen, motion, visibility: torso.visibility, valid });
      $("tracking").textContent = valid ? `${Math.round(torso.visibility * 100)}% · ${good}/24 patches` : "Texture / light insufficient";
      $("movement").textContent = motion > RESPIRATORY_PROTOCOL.maxMotion ? "Movement detected" : "Within capture gate";
      previous = gray;
    } catch (error) {
      samples.push({ t: now, chest, abdomen, motion: 0, visibility: 0, valid: false });
      $("tracking").textContent = "Frame unavailable";
    }
  }
  const onCapture = () => void startCapture(); $("capture").addEventListener("click", onCapture);
  $("profile").addEventListener("change", () => {
    subjectId = $("profile").value.trim().slice(0, 40).toLowerCase() || "crew-01"; $("profile").value = subjectId;
    try { localStorage.setItem(PROFILE_KEY, subjectId); } catch { /* history save reports storage failure */ }
    resetMotion(); demo = false; render(); setStatus("Profile selected. Start a fresh capture or import a depth recording for this crew member.");
  });
  $("demo").addEventListener("click", () => { clearInterval(timer); active = false; resetMotion(); demo = true; source = "webcam"; samples = syntheticSamples(); $("progress").value = 45; $("capture").textContent = "Start 45-second check"; $("map-caption").textContent = "Demo signal only. No motion heatmap was measured."; $("tracking").textContent = "Synthetic input"; $("movement").textContent = "Synthetic input"; render(true); });
  $("save").addEventListener("click", () => {
    if (active || demo || saved || result?.status !== "estimated") return;
    if (hasSavedRespiratoryCapture(history, { captureId, subjectId, source, protocol: result.protocol })) { $("save").disabled = true; setStatus("This depth recording is already saved for this crew profile and protocol."); return; }
    const record = { id: globalThis.crypto?.randomUUID?.() || `resp-${Date.now()}`, captureId, subjectId, recordedAt: new Date().toISOString(), rate: result.rate, quality: result.quality, duration: result.duration, source, protocol: result.protocol, validation: "Reference-belt validation pending" };
    const next = [...history, record].slice(-100);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); history = next; saved = true; $("save").disabled = true; $("save").textContent = "Saved on this device"; updateHistory(); }
    catch { setStatus("Browser storage is unavailable. You can export this capture instead."); }
  });
  $("clear").addEventListener("click", () => { try { const otherProfiles = history.filter(r => (r.subjectId || "crew-01") !== subjectId); localStorage.setItem(HISTORY_KEY, JSON.stringify(otherProfiles)); history = otherProfiles; updateHistory(); } catch { setStatus("Browser storage could not be cleared."); } });
  $("export").addEventListener("click", () => {
    if (!samples.length || active) return;
    const payload = { schema: "astrobone-respiratory-capture-v1", exportedAt: new Date().toISOString(), captureId, subjectId, synthetic: demo, source, result, samples, notes: "Experimental respiratory motion estimation; reference-belt validation pending. No bone-loss inference." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `astrobone-respiratory-${demo ? "synthetic-demo-" : ""}${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("depth").addEventListener("change", async event => {
    const input = event.currentTarget, file = input.files?.[0]; if (!file) return;
    const importVersion = ++stateVersion;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Import a JSON file smaller than 2 MB.");
      const recording = JSON.parse(await file.text());
      const imported = validateDepthRecording(recording);
      const importedCaptureId = await fingerprintDepthSamples(imported);
      if (destroyed || stateVersion !== importVersion) return;
      clearInterval(timer); active = false; resetMotion(); demo = recording.synthetic === true; source = "depth"; samples = imported; $("progress").value = 45;
      captureId = importedCaptureId;
      $("tracking").textContent = "Adapter-supplied regions"; $("movement").textContent = "Adapter declares compensation";
      $("map-caption").textContent = "Depth: region waveform only. No spatial heatmap is present in this import.";
      render(true);
    } catch (error) { if (!destroyed && stateVersion === importVersion) setStatus(`Depth import rejected: ${error.message}`); }
    finally { input.value = ""; }
  });
  updateHistory(); drawWave();
  return { updatePose, destroy() { destroyed = true; clearInterval(timer); active = false; container.replaceChildren(); } };
}
