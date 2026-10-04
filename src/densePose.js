import { validateDensePoseResult, sameDensePoseSource } from "./densePoseResult.js";
import "./densePose.css";

const API = "http://127.0.0.1:8012";
export function initDensePose({ video, getSource, getMirror, beforeStart }) {
  const panel = document.createElement("section"); panel.className = "densepose-panel";
  panel.innerHTML = `<div class="densepose-heading"><strong>DensePose surface mapping</strong><span id="densepose-state">Off</span></div><div class="densepose-actions"><label><input id="densepose-consent" type="checkbox"> Process camera or uploaded-video frames in the private local DensePose service.</label><button id="densepose-start" type="button">Start DensePose</button><button id="densepose-stop" type="button" disabled>Stop</button><button id="densepose-export" type="button" disabled>Export IUV</button></div><p id="densepose-status" role="status">Optional / visible body surface only / no internal anatomy or clinical interpretation.</p>`;
  document.querySelector(".capture-source-bar").after(panel);
  const $ = id => panel.querySelector(`#${id}`);
  const overlay = document.createElement("canvas"); overlay.className = "densepose-overlay"; overlay.hidden = true; video.parentElement.append(overlay);
  const label = document.createElement("div"); label.className = "densepose-frame-label"; label.hidden = true; video.parentElement.append(label);
  const capture = document.createElement("canvas"), ctx = capture.getContext("2d"), output = overlay.getContext("2d");
  let active = false, generation = 0, epoch = 0, timer, abort, staleTimer, lastMediaTime = -1, lastPacket;
  function clear() { overlay.hidden = true; label.hidden = true; clearTimeout(staleTimer); lastPacket = null; $("densepose-export").disabled = true; }
  function stop(reason = "DensePose off. Fast body tracking remains available.") {
    active = false; generation++; abort?.abort(); clearTimeout(timer); clear(); lastMediaTime = -1;
    $("densepose-state").textContent = "Off"; $("densepose-start").disabled = false; $("densepose-stop").disabled = true; $("densepose-status").textContent = reason;
  }
  function unavailable(error) {
    stop(`DensePose service unavailable: ${error.message}. Start the local WSL service with scripts/start-densepose.ps1. If WSL times out, restart WSL first. Body tracking is unchanged.`);
    $("densepose-state").textContent = "Service unavailable";
  }
  async function request(path, options, timeout = 15000) {
    const response = await fetch(API + path, { ...options, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) });
    const data = await response.json(); if (!response.ok) throw new Error(data.detail || `DensePose ${response.status}`); return data;
  }
  async function frame(version) {
    if (!active || version !== generation) return;
    const source = getSource(), sourceEpoch = epoch;
    if (!source.active || source.starting || video.readyState < 2 || video.seeking || document.hidden || (video.paused && lastMediaTime === video.currentTime)) {
      if (!source.active || source.starting || video.seeking) clear();
      timer = setTimeout(() => frame(version), 200); return;
    }
    const started = performance.now(), mediaTime = video.currentTime;
    try {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      capture.width = Math.round(video.videoWidth * scale); capture.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, capture.width, capture.height);
      const blob = await new Promise(resolve => capture.toBlob(resolve, "image/jpeg", .82));
      if (!active || version !== generation) return;
      if (!blob) { clear(); timer = setTimeout(() => frame(version), 200); return; }
      const data = validateDensePoseResult(await request("/frame", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob }, lastMediaTime < 0 ? 60000 : 15000));
      if (data.width !== capture.width || data.height !== capture.height) throw new Error("DensePose frame dimensions do not match the captured source");
      if (!active || version !== generation) return;
      if (!sameDensePoseSource(source, getSource(), sourceEpoch, epoch)) { clear(); timer = setTimeout(() => frame(version), 0); return; }
      lastMediaTime = mediaTime;
      const age = Math.round(performance.now() - started);
      $("densepose-state").textContent = data.device === "cuda" ? "GPU" : "CPU";
      $("densepose-status").textContent = data.status === "estimated"
        ? `${data.visible_parts.length}/24 visible surface charts / detection score ${data.detection_score.toFixed(2)} / ${data.inference_ms} ms inference / ${age} ms round trip. No accuracy claim.`
        : `${data.status === "multiple_people" ? "Multiple people" : "No person detected"}. Surface mapping withheld.`;
      if (data.status === "estimated") {
        const image = new Image(); image.src = data.overlay; await image.decode();
        if (image.naturalWidth !== capture.width || image.naturalHeight !== capture.height) throw new Error("DensePose overlay dimensions are invalid");
        if (!active || version !== generation) return;
        if (!sameDensePoseSource(source, getSource(), sourceEpoch, epoch)) { clear(); timer = setTimeout(() => frame(version), 0); return; }
        overlay.width = capture.width; overlay.height = capture.height;
        // Display the map over its own captured frame, never over a newer video frame.
        output.drawImage(capture, 0, 0); output.drawImage(image, 0, 0);
        overlay.style.transform = getMirror() ? "scaleX(-1)" : "";
        overlay.hidden = false; label.hidden = false;
        label.textContent = `DensePose analyzed frame / ${source.kind === "video" ? `${mediaTime.toFixed(2)} s / ` : ""}${age} ms latency`;
        clearTimeout(staleTimer); staleTimer = setTimeout(() => {
          // A paused, unchanged video frame is still the exact analyzed source.
          if (source.kind === "video" && video.paused && Math.abs(video.currentTime - mediaTime) < .02
            && sameDensePoseSource(source, getSource(), sourceEpoch, epoch)) return;
          overlay.hidden = true; label.hidden = true;
        }, 1500);
        lastPacket = { ...data, source_kind: source.kind, source_time_seconds: mediaTime }; $("densepose-export").disabled = false;
      } else clear();
      timer = setTimeout(() => frame(version), 80);
    } catch (error) { if (active && version === generation) unavailable(error); }
  }
  $("densepose-start").onclick = async () => {
    if (active) return;
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) { $("densepose-status").textContent = "This private DensePose service is available from the local desktop web app only."; return; }
    if (!$("densepose-consent").checked) { $("densepose-status").textContent = "Consent is required before transferring frames to the local service."; return; }
    beforeStart(); active = true; const version = ++generation; abort = new AbortController();
    $("densepose-start").disabled = true; $("densepose-stop").disabled = false;
    $("densepose-state").textContent = "Starting"; $("densepose-status").textContent = "Loading the local DensePose model...";
    try {
      const data = await request("/initialize", { method: "POST" }, 180000);
      if (!active || version !== generation) return;
      if (!data.ready || data.retains_frames !== false) throw new Error("DensePose did not confirm private inference readiness");
      $("densepose-state").textContent = "Ready"; $("densepose-status").textContent = "Waiting for a camera or uploaded video.";
      void frame(version);
    } catch (error) { if (active && version === generation) unavailable(error); }
  };
  $("densepose-stop").onclick = () => stop();
  $("densepose-consent").onchange = () => { if (!$("densepose-consent").checked) stop("Consent withdrawn. Frame transfer stopped."); };
  $("densepose-export").onclick = () => {
    if (!lastPacket) return;
    const link = document.createElement("a"); link.href = lastPacket.iuv; link.download = "astrobone-densepose-IUV.png"; link.click();
  };
  for (const event of ["seeking", "emptied", "loadedmetadata"]) video.addEventListener(event, () => { epoch++; clear(); lastMediaTime = -1; });
  window.addEventListener("beforeunload", () => stop());
  return { stop };
}
