import { PoseLandmarkFilter } from "./poseRetargeting.js";
import { analyzePoseLandmarks, summarizeFunctionalAssessment } from "./functionalAssessment.js";

// Camera knee-extension capture for the self-check. Uses the same pose worker, landmark
// filter, offscreen-joint rule and summary as the Movement capture workspace, so the
// knee-extension definition (95th percentile interior angle) is identical.
const EDGES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [11, 13], [13, 15], [12, 14], [14, 16]];

export function createSelfCheckCamera({ video, overlay, onStatus = () => {}, onFrame = () => {} }) {
  const base = import.meta.env.BASE_URL;
  let stream = null, worker = null, busy = false, running = false, session = 0, recording = null, raf = null;
  const worldFilter = new PoseLandmarkFilter({ minimumAlpha: 0.55, maximumAlpha: 0.9 });
  const imageFilter = new PoseLandmarkFilter({ minimumAlpha: 0.55, maximumAlpha: 0.9 });

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a camera.");
    onStatus("Requesting camera permission");
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
    video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
    onStatus("Loading pose model");
    worker = new Worker(new URL("./poseDetection.worker.js", import.meta.url), { type: "module" });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Pose model did not load within 45 s.")), 45000);
      worker.onerror = event => { clearTimeout(timer); event.preventDefault?.(); reject(new Error(event.message || "Pose worker failed to start")); };
      worker.onmessage = event => {
        const message = event.data;
        if (message?.type === "progress") onStatus(message.label);
        else if (message?.type === "ready") { clearTimeout(timer); resolve(); }
        else if (message?.type === "error") { clearTimeout(timer); reject(new Error(message.error)); }
      };
      worker.postMessage({ type: "initialize", modelUrl: new URL(`${base}models/pose_landmarker_lite.task`, location.href).href, wasmUrl: new URL(`${base}mediapipe`, location.href).href, delegate: "AUTO" });
    });
    worker.onmessage = event => handle(event.data);
    running = true; session++; onStatus("Camera live · keep both legs in view");
    loop();
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (busy || video.readyState < 2) return;
    busy = true;
    createImageBitmap(video).then(bitmap => {
      if (!running) { bitmap.close(); busy = false; return; }
      worker.postMessage({ type: "frame", bitmap, timestamp: performance.now(), cameraSessionId: session, mediaTime: video.currentTime }, [bitmap]);
    }).catch(() => { busy = false; });
  }

  function handle(message) {
    if (message?.type === "error") { busy = false; onStatus(`Pose error: ${message.error}`); return; }
    if (message?.type !== "result") return;
    busy = false;
    const image = message.landmarks?.[0] ?? null, world = message.worldLandmarks?.[0] ?? image;
    const filteredWorld = worldFilter.update(world), filteredImage = imageFilter.update(image);
    // Offscreen joints are model extrapolations, even if world confidence is high.
    for (let i = 0; i < (image?.length ?? 0); i++) {
      const p = image[i], quality = !p || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 ? 0 : Math.min(p.visibility ?? 1, p.presence ?? 1);
      if (filteredWorld?.[i]) filteredWorld[i].visibility = Math.min(filteredWorld[i].visibility, quality);
      if (filteredImage?.[i]) filteredImage[i].visibility = Math.min(filteredImage[i].visibility, quality);
    }
    const frame = filteredWorld ? analyzePoseLandmarks(filteredWorld, filteredImage ?? filteredWorld, { timestamp: message.timestamp, inferenceMs: message.inferenceMs }) : null;
    draw(image, frame);
    if (recording && frame) recording.samples.push(frame);
    if (recording) recording.telemetry.push({ timestamp: message.timestamp, inferenceMs: message.inferenceMs, detected: Boolean(image) });
    onFrame(frame);
  }

  function draw(points, frame) {
    const ctx = overlay.getContext("2d"), w = overlay.width = overlay.clientWidth * (devicePixelRatio || 1), h = overlay.height = overlay.clientHeight * (devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h); if (!points) return;
    // The preview is mirrored, so mirror the overlay to match.
    const x = p => (1 - p.x) * w, y = p => p.y * h;
    ctx.lineWidth = 3 * (devicePixelRatio || 1); ctx.strokeStyle = frame?.usable ? "rgba(127,227,255,.95)" : "rgba(255,190,110,.9)";
    for (const [a, b] of EDGES) { const p = points[a], q = points[b]; if (!p || !q || p.visibility < .3 || q.visibility < .3) continue; ctx.beginPath(); ctx.moveTo(x(p), y(p)); ctx.lineTo(x(q), y(q)); ctx.stroke(); }
    ctx.fillStyle = "#fff"; for (const i of [23, 24, 25, 26, 27, 28]) { const p = points[i]; if (p?.visibility >= .3) { ctx.beginPath(); ctx.arc(x(p), y(p), 4 * (devicePixelRatio || 1), 0, Math.PI * 2); ctx.fill(); } }
    if (frame?.angles) {
      ctx.font = `${12 * (devicePixelRatio || 1)}px monospace`; ctx.fillStyle = "#fff";
      for (const [side, i] of [["left", 25], ["right", 26]]) { const p = points[i]; if (p) ctx.fillText(`${Math.round(frame.angles[side].knee)}°`, x(p) + 8, y(p)); }
    }
  }

  // Record a fixed-length capture and summarize it with the shared assessment rules.
  function record(durationMs = 10000) {
    if (!running) return Promise.reject(new Error("Camera is not running."));
    recording = { samples: [], telemetry: [], start: performance.now() };
    return new Promise(resolve => setTimeout(() => {
      const { samples, telemetry } = recording; recording = null;
      const summary = summarizeFunctionalAssessment(samples, null, { telemetry, durationMs });
      const rom = summary.rangeOfMotion ? (summary.rangeOfMotion.left.knee + summary.rangeOfMotion.right.knee) / 2 : null;
      resolve({
        status: summary.status, trackingQuality: summary.trackingQuality ?? 0, sampleCount: summary.sampleCount ?? 0,
        kneeExtension: summary.cameraFeatures?.kneeExtensionP95Degrees ?? null, kneeRom: rom === null ? null : Math.round(rom * 10) / 10,
        reason: summary.reason ?? null, durationMs, protocol: "self-check-seated-knee-extension-v1",
      });
    }, durationMs));
  }

  function stop() {
    running = false; cancelAnimationFrame(raf); recording = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    try { worker?.postMessage({ type: "close" }); } catch { /* already closed */ }
    worker = null; busy = false;
    overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
  }

  return { start, record, stop, get running() { return running; } };
}
