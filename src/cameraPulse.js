// Resting pulse from the camera for the daily self-check: a deep-led hybrid of ME-rPPG (deep model)
// and the face-colour POS wave, fused in the spectrum (src/wavePulse.js). The result is a resting
// heart rate compared only with the same person's earlier camera readings (protocol
// RESTING_CAMERA_PROTOCOL), never with a wearable's, and never a diagnosis.
import { estimateFusedPulse, estimateWavePulse, colourWaves, WAVE_PULSE } from "./wavePulse.js";

export const RESTING_CAMERA_PROTOCOL = "resting-camera-hybrid-v1";
export const CAMERA_PULSE = Object.freeze({ seconds: 45, settleSeconds: 3, maxMotion: 0.035, maxMovingShare: 0.1 });
// Spectral weight of each wave in the self-check hybrid. On 40 people (MCD-rPPG) an equal-weight
// fusion of ME-rPPG, POS and CHROM was less accurate than ME-rPPG alone; the deep model leading with
// POS at a quarter weight was more accurate than either, chosen leave-one-person-out
// (docs/real-video-validation.md). CHROM added nothing and is left out.
export const FUSION_WEIGHTS = Object.freeze({ me: 1, pos: 0.25, chrom: 0 });

// Head-movement and lighting refusals shared by every camera pulse estimate.
const LIGHTING_REASON = "Lighting is too dark or too bright on the face";
const outOfRange = s => s.rgb.some(v => v < 20 || v > 240);
function colourGate(withColour, { lighting = "refuse" } = {}) {
  const moving = withColour.filter(s => !(s.motion <= CAMERA_PULSE.maxMotion)).length;
  if (withColour.length && moving > CAMERA_PULSE.maxMovingShare * withColour.length) return { status: "insufficient", reason: "Too much head movement: hold still", bpm: null, quality: 0 };
  if (lighting === "refuse" && withColour.some(outOfRange)) return { status: "insufficient", reason: LIGHTING_REASON, bpm: null, quality: 0 };
  return null;
}

// The self-check's read of its camera minute: the whole 42 s left after settling (not only the last 30 s), with
// the quality gate at 0.25. A longer window spreads the same pulse over a narrower peak band (±1.5/duration), so
// its peak share runs lower than a 30 s window's for the same signal. On 58 new MCD-rPPG people, three cameras,
// 655 clips cut like the self-check (data/validation/mcd-selfcheck-read.csv): 0.25 was chosen on half of the people
// as the gate that kept the earlier read's answer rate with no answer more than 10 bpm off, and on the other half it
// cut answers more than 10 bpm off from 4 to 1 for 2.7 points fewer answers. It does not make the phone answer more
// often (47 % of phone clips, from 51 %); it makes fewer of its answers wrong. Light out of range no longer refuses on
// its own: it becomes the reason when the pulse is unclear, because on the same clips the 4 that showed a clear pulse
// under out-of-range light read within 0.5 bpm.
export const SELF_CHECK_READ = Object.freeze({ windowSeconds: CAMERA_PULSE.seconds - CAMERA_PULSE.settleSeconds + 1, minQuality: 0.25, lighting: "advise" });

// samples: [{ t (ms), bvp, rgb, motion }] from the pulse worker. Returns the fused estimate on the
// last WAVE_PULSE.windowSeconds (or options.windowSeconds), with the same refusals the offline validation applied.
// lighting: "refuse" (default, as validated on 30 s windows) refuses any window with a face frame out of range;
// "advise" (the self-check, SELF_CHECK_READ) reads the pulse anyway and names the light only if the pulse is unclear.
export function fusedPulseFromSamples(samples, { weights = FUSION_WEIGHTS, lighting = "refuse", ...options } = {}) {
  const usable = samples.filter(s => Number.isFinite(s.t));
  if (!usable.length) return { status: "insufficient", reason: "No face found yet", bpm: null, quality: 0 };
  const end = usable.at(-1).t, recent = usable.filter(s => end - s.t <= (options.windowSeconds ?? WAVE_PULSE.windowSeconds) * 1000);
  const withColour = recent.filter(s => s.rgb);
  const refused = colourGate(withColour, { lighting });
  if (refused) return refused;
  const waves = [];
  const me = recent.filter(s => Number.isFinite(s.bvp)).map(s => ({ t: s.t, v: s.bvp }));
  if (me.length && weights.me > 0) waves.push({ name: "ME-rPPG", samples: me, weight: weights.me });
  const colour = weights.pos > 0 || weights.chrom > 0 ? colourWaves(withColour) : null;
  if (colour && weights.pos > 0) waves.push({ name: "POS", samples: colour.pos, weight: weights.pos });
  if (colour && weights.chrom > 0) waves.push({ name: "CHROM", samples: colour.chrom, weight: weights.chrom });
  const result = estimateFusedPulse(waves, options);
  const unclear = result.status !== "estimated" && /ambiguous|No clear pulse/.test(result.reason);
  if (lighting === "advise" && unclear && withColour.filter(outOfRange).length > CAMERA_PULSE.maxMovingShare * withColour.length) return { ...result, reason: LIGHTING_REASON };
  return result;
}

// Live Capture has no deep model running, so its pulse is the face-colour POS wave alone, read by the
// same wave estimator scored on real webcam video (docs/real-video-validation.md). The gate was 0.3 (chosen on
// 40 people, front webcam). On 58 new people filmed by a front webcam, a phone and a side camera
// (docs/validation-expansion-2026-11.md, data/validation/mcd-scale-live-gate.csv), the colour-only wave locked onto
// an artefact near 50 bpm with peak shares up to 0.45, up to 67 bpm off. 0.45 looked safe on half of the people and
// still let a 37 bpm error through on the other half; at 0.5 the worst reading on either half was 1.5 bpm. So the
// gate is 0.5. It rarely answers on a phone: the self-check's 45-second camera minute (deep-led hybrid) is the
// reading to use.
export const LIVE_PULSE = Object.freeze({ minSeconds: 12, minQuality: 0.5 });
// Beat-to-beat heart-rate variability (RMSSD) from the face colour, as Live Capture computed it, scored against the
// finger PPG over the same 60 s (scripts/validation/score-scale.mjs, data/validation/mcd-scale-hrv.csv). It is not
// shown in the app: it answered almost never, and read far from the finger sensor when it did.
export const LIVE_VARIABILITY_CHECK = Object.freeze({
  recordings: 343, answered: 16, maeMs: 53.4,
  summary: "On 343 real recordings it answered 16 times, about 53 ms from a finger sensor",
});
export function colourPulseFromSamples(samples, options = {}) {
  const withColour = samples.filter(s => Number.isFinite(s.t) && s.rgb);
  if (!withColour.length) return { status: "insufficient", reason: "A clearly visible face is required", bpm: null, quality: 0 };
  const refused = colourGate(withColour);
  if (refused) return refused;
  const waves = colourWaves(withColour);
  if (!waves) return { status: "insufficient", reason: `Collecting a ${LIVE_PULSE.minSeconds}-second window`, bpm: null, quality: 0 };
  const result = estimateWavePulse(waves.pos, { minSeconds: LIVE_PULSE.minSeconds, minQuality: LIVE_PULSE.minQuality, ...options });
  return result.status === "estimated" ? { ...result, reason: "Experimental camera estimate" } : result;
}

export function createCameraPulse({ video, onStatus = () => {}, onSample = () => {} }) {
  const base = import.meta.env.BASE_URL;
  let stream = null, worker = null, running = false, samples = [], pending = 0, session = 0;

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open a camera.");
    onStatus("Requesting camera permission");
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: "user" }, audio: false });
    video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
    worker = new Worker(new URL("./pulseDetection.worker.js", import.meta.url), { type: "module" });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Pulse models did not load within 180 s.")), 180000);
      worker.onerror = e => { clearTimeout(timer); e.preventDefault?.(); reject(new Error(e.message || "Pulse worker failed to start")); };
      worker.onmessage = ({ data }) => {
        if (data?.type === "progress") onStatus(data.label);
        else if (data?.type === "ready") { clearTimeout(timer); resolve(); }
        else if (data?.type === "error") { clearTimeout(timer); reject(new Error(data.error)); }
      };
      const url = path => new URL(`${base}${path}`, location.href).href;
      worker.postMessage({ type: "initialize", baseUrl: base, wasmUrl: url("mediapipe"), meshUrl: url("models/face_landmarker.task") });
    });
    worker.onmessage = ({ data }) => {
      if (data?.type === "sample") { pending = Math.max(0, pending - 1); samples.push(data); onSample(data); }
      else if (data?.type === "error") { pending = Math.max(0, pending - 1); onStatus(`Pulse error: ${data.error}`); }
    };
    running = true; session++;
    loop(session);
  }

  // One frame at a time, timed by the camera's capture time where the browser reports it.
  function loop(my) {
    if (!running || my !== session) return;
    const next = (now, meta) => {
      if (!running || my !== session) return;
      const t = Number.isFinite(meta?.captureTime) ? meta.captureTime : meta?.presentationTime ?? now ?? performance.now();
      if (pending < 3 && video.readyState >= 2) {
        pending++;
        createImageBitmap(video).then(bitmap => worker?.postMessage({ type: "frame", bitmap, t }, [bitmap])).catch(() => { pending--; });
      }
      loop(my);
    };
    if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(next);
    else requestAnimationFrame(now => next(now));
  }

  // Measure for `seconds`, discarding the first settle seconds while the model state warms up, then read
  // everything after the settle (SELF_CHECK_READ).
  function measure(seconds = CAMERA_PULSE.seconds, onProgress = () => {}) {
    if (!running) return Promise.reject(new Error("Camera is not running."));
    samples = []; worker.postMessage({ type: "reset" });
    const started = performance.now();
    return new Promise(resolve => {
      const tick = setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        const settled = samples.filter(s => s.t - (samples[0]?.t ?? 0) >= CAMERA_PULSE.settleSeconds * 1000);
        // The running "about N bpm" hint keeps the 30 s read validated for windows that short; the result reads all 42 s.
        const live = elapsed > 15 ? fusedPulseFromSamples(settled) : null;
        onProgress({ elapsed, seconds, live, faceShare: samples.length ? samples.filter(s => s.bvp !== null).length / samples.length : 0 });
        if (elapsed >= seconds || !running) {
          clearInterval(tick);
          const result = fusedPulseFromSamples(settled, SELF_CHECK_READ);
          const fps = settled.length > 1 ? (settled.length - 1) / ((settled.at(-1).t - settled[0].t) / 1000) : 0;
          resolve({ ...result, fps, frames: settled.length, protocol: RESTING_CAMERA_PROTOCOL, parts: result.parts?.map(p => ({ name: p.name, bpm: Math.round(p.hz * 60), quality: Number(p.quality.toFixed(2)) })),
            // Face cues and head height per frame, for the crewmate check (src/faceCues.js, breathingFromHead).
            cues: samples.map(s => s.cues).filter(Boolean) });
        }
      }, 500);
    });
  }

  function stop() {
    running = false; session++;
    stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    try { worker?.postMessage({ type: "close" }); } catch { /* closed */ }
    worker = null; pending = 0;
  }

  return { start, measure, stop, get running() { return running; } };
}
