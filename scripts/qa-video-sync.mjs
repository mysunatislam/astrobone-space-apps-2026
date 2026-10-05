import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";

// Measures how closely Live Capture follows an uploaded video:
//   startup  - upload to the first pose shown on the playing video
//   offset   - how far the pose on screen trails the video frame on screen (video time - pose time)
//   twinOffset - video time minus the pose time the twin last drew, read on the same animation frame
//   twinVsDriven - twin knee minus the knee it was aimed at (bone smoothing would show here)
//   poseRate - distinct poses per second of video
// and, for a clip with a visible face, the camera pulse and stress readings.
// Usage: node scripts/qa-video-sync.mjs <video> [baseUrl] [--legacy]
const [file = ".artifacts/knee-video/squat-7s.mp4", base = "http://127.0.0.1:5182/"] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const legacy = process.argv.includes("--legacy");
const output = resolve(".artifacts/video-sync");
await mkdir(output, { recursive: true });
// Extra Chrome flags (for example --disable-frame-rate-limit) via SYNC_CHROME_ARGS.
// SYNC_CHANNEL=chromium runs full Chrome in its new headless mode (the default shell composites
// video at a lower rate, which starves per-frame callbacks).
const browser = await chromium.launch({ headless: true, ...(process.env.SYNC_CHANNEL ? { channel: process.env.SYNC_CHANNEL } : {}), args: ["--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required", ...(process.env.SYNC_CHROME_ARGS ?? "").split(" ").filter(Boolean)] });
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // MediaPipe logs its runtime INFO lines on the error channel; they are not failures.
  page.on("console", m => { if (m.type() === "error" && !/^INFO:/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}lab.html#movement-capture`);
  await page.waitForFunction(() => document.querySelector("#twin-canvas")?.dataset.rigReady === "true", null, { timeout: 120000 });
  // Warm the pose model first so startup measures the video path, not the model download.
  await page.evaluate(() => window.__astroboneLab.poseController.prepare());
  const precompute = page.locator("#video-precompute");
  if (await precompute.count()) await (legacy ? precompute.uncheck() : precompute.check());
  await page.evaluate(() => {
    const lab = window.__astroboneLab, video = document.querySelector("#pose-video"), canvas = document.querySelector("#twin-canvas");
    const log = window.__syncLog = { samples: [], firstPose: null, uploadedAt: null, firstAnalysis: null, statuses: [], pulse: [] };
    new MutationObserver(() => log.uploadedAt && log.statuses.push([Math.round(performance.now() - log.uploadedAt), document.querySelector("#camera-status").textContent]))
      .observe(document.querySelector("#camera-status"), { childList: true, characterData: true, subtree: true });
    document.querySelector("#exercise-video-file").addEventListener("change", () => { log.uploadedAt = performance.now(); }, { capture: true });
    log.sync = [];
    const tick = () => {
      const frame = lab.frame, pc = lab.poseController;
      if (log.uploadedAt && pc.videoTrack && log.sync.length < 4000) log.sync.push({ t: Math.round(performance.now() - log.uploadedAt), video: +video.currentTime.toFixed(3), paused: video.paused, hold: pc.syncHold,
        ahead: pc.lookahead ? +pc.lookahead.position.toFixed(3) : null, rate: pc.lookahead?.video.playbackRate, covered: +pc.videoTrack.coveredUntil(video.currentTime).toFixed(3), inferMs: Math.round(pc.analysisInferenceMs ?? -1), detail: pc.detailWorkerReady });
      if (log.uploadedAt && !log.firstAnalysis && lab.poseController.videoTrack?.size) log.firstAnalysis = { at: performance.now(), inferenceMs: lab.poseController.analysisInferenceMs };
      if (frame && log.uploadedAt && !video.paused && Number.isFinite(frame.mediaTime)) {
        log.firstPose ??= performance.now();
        const flex = side => Number.isFinite(frame.angles?.[side]?.knee) ? 180 - frame.angles[side].knee : null;
        // The knee as the twin is driven: angle between the thigh and shin directions it is aimed along.
        const a = frame.segments?.leftUpLeg?.direction, b = frame.segments?.leftLeg?.direction;
        const seg = a && b ? Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / Math.hypot(a.x, a.y, a.z) / Math.hypot(b.x, b.y, b.z)))) * 180 / Math.PI : null;
        log.samples.push({ t: performance.now(), video: video.currentTime, pose: frame.mediaTime, usable: frame.usable, hasAngles: Boolean(frame.angles), twinRaw: canvas.dataset.leftKneeFlexion, tracking: canvas.dataset.tracking, twinPose: Number(canvas.dataset.poseMediaTime) || null,
          twin: Number(canvas.dataset.leftKneeFlexion) || null, tracked: flex("left"), seg });
      }
      const pulse = lab.pulse;
      const track = lab.poseController.detailTrack;
      if (pulse && log.uploadedAt) log.pulse.push({ video: video.currentTime, bpm: pulse.bpm ?? null, fps: pulse.fps ?? null, status: pulse.status, reason: pulse.reason, collected: pulse.collectedSeconds, stress: pulse.stress ?? null,
        faceSamples: track ? track.samples.filter(s => s.face).length : 0, faceRate: track ? +track.rateAround(video.currentTime, 2).toFixed(1) : 0 });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // SYNC_HIDE_TWIN=1: take the 3D twin off screen (diagnoses GPU contention with video compositing).
  if (process.env.SYNC_HIDE_TWIN) await page.evaluate(() => { document.querySelector("#twin-canvas").closest("section").style.display = "none"; });
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#upload-video").click();
  await (await chooser).setFiles(resolve(file));
  await page.waitForFunction(() => window.__syncLog.firstPose, null, { timeout: 180000 });
  // Synchronized playback may hold briefly while analysis catches up; wait for the clip's end.
  const limit = Number(process.env.SYNC_TIMEOUT_MS ?? 240000);
  const timedOut = await page.waitForFunction(() => { const v = document.querySelector("#pose-video"), pc = window.__astroboneLab.poseController; return v.ended || pc.videoWindowComplete || (v.paused && !pc.syncHold && v.currentTime > 1 && !pc.videoTrack); }, null, { timeout: limit }).then(() => false, () => true);
  const log = await page.evaluate(() => window.__syncLog);
  const playback = await page.evaluate(() => { const q = document.querySelector("#pose-video").getVideoPlaybackQuality?.(); return q ? { total: q.totalVideoFrames, dropped: q.droppedVideoFrames } : null; });
  const samples = log.samples;
  const offsets = samples.map(s => (s.video - s.pose) * 1000);
  const mediaSpan = samples.length ? samples.at(-1).pose - samples[0].pose : 0;
  const report = {
    file: basename(file), mode: legacy ? "legacy live" : "synchronized",
    timedOut,
    startupMs: Math.round(log.firstPose - log.uploadedAt),
    firstAnalysisMs: log.firstAnalysis ? Math.round(log.firstAnalysis.at - log.uploadedAt) : null,
    inferenceMs: log.firstAnalysis?.inferenceMs ? Math.round(log.firstAnalysis.inferenceMs) : null,
    statuses: log.statuses.filter((s, i, all) => i === 0 || s[1] !== all[i - 1][1]).slice(0, 8),
    frames: { total: samples.length, usable: samples.filter(s => s.usable).length, withAngles: samples.filter(s => s.hasAngles).length, twin: [...new Set(samples.map(s => s.tracking))].join("/"), twinValues: samples.filter(s => s.twinRaw).length },
    offsetMs: { median: Math.round(median(offsets)), p95: Math.round(pct(offsets, .95)), max: Math.round(Math.max(...offsets)) },
    // The twin's own pose time against the video on screen, read on the same animation frame.
    twinOffsetMs: (() => { const o = samples.filter(s => s.twinPose !== null).map(s => (s.video - s.twinPose) * 1000); return o.length ? { median: Math.round(median(o)), p95: Math.round(pct(o, .95)) } : null; })(),
    // On frames where the twin drew the current pose: twin knee minus the knee it was aimed at.
    twinVsDrivenDeg: (() => { const d = samples.filter(s => s.twinPose !== null && Math.abs(s.twinPose - s.pose) < 1e-3 && s.seg !== null && s.twin !== null).map(s => s.twin - s.seg); return d.length ? { n: d.length, median: +median(d).toFixed(2), p95abs: +pct(d.map(Math.abs), .95).toFixed(2) } : null; })(),
    poseRateHz: mediaSpan > 0 ? Math.round(new Set(samples.map(s => s.pose)).size / mediaSpan) : null,
    playback,
    holds: log.sync.filter((s, i, all) => s.hold && !all[i - 1]?.hold).length,
    pulse: log.pulse.filter(p => p.status === "estimated").slice(-1)[0] ?? log.pulse.slice(-1)[0] ?? null,
    errors,
  };
  await writeFile(resolve(output, `${basename(file)}-${legacy ? "legacy" : "sync"}.json`), JSON.stringify({ report, samples: process.env.SYNC_ALL_SAMPLES ? samples : samples.filter((_, i) => i % 5 === 0), sync: log.sync.filter((s, i, all) => i === 0 || s.hold !== all[i - 1].hold || s.paused !== all[i - 1].paused || i % 20 === 0), pulse: log.pulse.filter((_, i) => i % 30 === 0) }, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
