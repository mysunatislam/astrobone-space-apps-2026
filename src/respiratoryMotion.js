// Experimental motion periodicity only. These engineering gates have not been
// validated against a respiratory belt and do not establish clinical accuracy.
import { bandPass } from "./rppg.js";

export const RESPIRATORY_PROTOCOL = Object.freeze({
  id: "respiratory-motion-v1", minSeconds: 30, windowSeconds: 60,
  lowHz: 0.1, highHz: 2 / 3, minFps: 5, maxGapMs: 750,
  maxMotion: 0.025, maxMovingShare: 0.08, minVisibility: 0.65,
});
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const variance = xs => { const m = mean(xs); return mean(xs.map(x => (x - m) ** 2)); };
const clamp = value => Math.min(1, Math.max(0, value));
const refusal = (reason, extra = {}) => ({ status: "insufficient", rate: null, quality: 0, waveform: [], reason, ...extra });

function detrend(xs) {
  const mid = (xs.length - 1) / 2, avg = mean(xs);
  const denominator = xs.reduce((sum, _, i) => sum + (i - mid) ** 2, 0);
  const slope = xs.reduce((sum, x, i) => sum + (i - mid) * (x - avg), 0) / denominator;
  return xs.map((x, i) => x - avg - slope * (i - mid));
}

function spectrum(xs, fs, lowHz, highHz) {
  const duration = xs.length / fs, step = 1 / (8 * duration), powers = [];
  for (let hz = lowHz; hz <= highHz + step / 2; hz += step) {
    let real = 0, imaginary = 0;
    for (let i = 0; i < xs.length; i++) {
      const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (xs.length - 1));
      real += xs[i] * weight * Math.cos(2 * Math.PI * hz * i / fs);
      imaginary += xs[i] * weight * Math.sin(2 * Math.PI * hz * i / fs);
    }
    powers.push({ hz, power: real ** 2 + imaginary ** 2 });
  }
  const peak = powers.reduce((a, b) => b.power > a.power ? b : a);
  const total = powers.reduce((sum, p) => sum + p.power, 0);
  const share = total > 0 ? powers.filter(p => Math.abs(p.hz - peak.hz) <= 1 / duration).reduce((sum, p) => sum + p.power, 0) / total : 0;
  return { ...peak, share };
}

function periodicity(xs, fs, hz) {
  const lag = Math.round(fs / hz);
  if (lag >= xs.length / 2) return 0;
  let cross = 0, a = 0, b = 0;
  for (let i = lag; i < xs.length; i++) { cross += xs[i] * xs[i - lag]; a += xs[i] ** 2; b += xs[i - lag] ** 2; }
  return a > 0 && b > 0 ? cross / Math.sqrt(a * b) : 0;
}

function sinusoidalFit(xs, fs, hz) {
  let ss = 0, cc = 0, sc = 0, ys = 0, yc = 0, energy = 0;
  for (let i = 0; i < xs.length; i++) {
    const s = Math.sin(2 * Math.PI * hz * i / fs), c = Math.cos(2 * Math.PI * hz * i / fs);
    ss += s * s; cc += c * c; sc += s * c; ys += xs[i] * s; yc += xs[i] * c; energy += xs[i] ** 2;
  }
  const det = ss * cc - sc * sc;
  return energy > 0 && det > 0 ? clamp(((cc * ys - sc * yc) * ys + (ss * yc - sc * ys) * yc) / det / energy) : 0;
}

export function estimateRespiratoryMotion(samples, { source = "webcam", minSeconds = RESPIRATORY_PROTOCOL.minSeconds } = {}) {
  if (!["webcam", "depth"].includes(source)) return refusal("Unsupported respiratory capture source.");
  if (!Array.isArray(samples) || samples.length < 2) return refusal("Start a 45-second capture with your shoulders and hips visible.");
  if (samples.length > 18000) return refusal("Capture exceeds the supported 18,000-sample limit.");
  if (samples.some(s => !s || !Number.isFinite(s.t))) return refusal("Invalid sample timestamps; restart capture.");
  for (let i = 1; i < samples.length; i++) if (samples[i].t <= samples[i - 1].t) return refusal("Timestamps must increase; restart capture.");
  const end = samples.at(-1).t;
  const recent = samples.filter(s => end - s.t <= RESPIRATORY_PROTOCOL.windowSeconds * 1000);
  const duration = (recent.at(-1).t - recent[0].t) / 1000;
  const diagnostics = { duration, frames: recent.length, source, protocol: `${RESPIRATORY_PROTOCOL.id}-${source}`, validation: "Reference-belt validation pending" };
  if (recent.some(s => s.valid === false || !Number.isFinite(s.chest) || !Number.isFinite(s.abdomen) || !Number.isFinite(s.visibility ?? 1) || (s.visibility ?? 1) < RESPIRATORY_PROTOCOL.minVisibility || (s.visibility ?? 1) > 1)) return refusal("Torso tracking or image texture was lost; restart while seated and still.", diagnostics);
  if (recent.some(s => !Number.isFinite(s.motion ?? 0) || (s.motion ?? 0) < 0) || recent.filter(s => (s.motion ?? 0) > RESPIRATORY_PROTOCOL.maxMotion).length > RESPIRATORY_PROTOCOL.maxMovingShare * recent.length) return refusal("Body or camera movement is too large; capture rejected.", { ...diagnostics, status: "rejected" });
  if (recent.slice(1).some((s, i) => s.t - recent[i].t > RESPIRATORY_PROTOCOL.maxGapMs)) return refusal("Capture has a long timing gap; restart.", diagnostics);
  const fps = (recent.length - 1) / duration;
  if (duration < minSeconds) return refusal(`Collecting ${minSeconds} seconds of usable motion (${Math.max(0, Math.floor(duration))} s).`, diagnostics);
  if (!(fps >= RESPIRATORY_PROTOCOL.minFps)) return refusal("Camera cadence is too low; at least 5 samples/second are needed.", diagnostics);
  // First reconstruct the observed native cadence, bridging only the short gaps
  // checked above. Filtering AFTER decimation would alias high-frequency depth
  // sensor motion into the respiratory band (e.g. 9.75 Hz -> 0.25 Hz at 10 Hz).
  const nativeChannels = [[], []]; let cursor = 0;
  for (let i = 0; i < recent.length; i++) {
    const t = recent[0].t + i * 1000 / fps;
    while (cursor < recent.length - 2 && recent[cursor + 1].t < t) cursor++;
    const a = recent[cursor], b = recent[cursor + 1], blend = clamp((t - a.t) / (b.t - a.t));
    nativeChannels[0].push(a.chest + blend * (b.chest - a.chest));
    nativeChannels[1].push(a.abdomen + blend * (b.abdomen - a.abdomen));
  }
  const fs = Math.min(10, fps), count = Math.floor(duration * fs) + 1;
  // The existing mirrored FFT filter has zero gain beyond 1.15 Hz, safely below
  // the 5 Hz Nyquist frequency of the retained 10 Hz series. Detrending first
  // avoids carrying depth-distance offsets into the numerical filtering.
  const antiAliased = fps > 10 ? nativeChannels.map(xs => bandPass(detrend(xs), fps, 0, 1)) : nativeChannels;
  const channels = antiAliased.map(xs => Array.from({ length: count }, (_, i) => {
    const position = Math.min(xs.length - 1, i * fps / fs), lower = Math.floor(position), upper = Math.min(xs.length - 1, lower + 1);
    return xs[lower] + (position - lower) * (xs[upper] - xs[lower]);
  }));
  const waves = channels.map(detrend);
  const energy = waves.map(variance), strongest = energy[0] >= energy[1] ? 0 : 1;
  const raw = waves[strongest], std = Math.sqrt(energy[strongest]);
  const minimumMotion = source === "depth" ? 0.05 : 0.015;
  if (!(std > minimumMotion)) return refusal("No measurable respiratory motion; try textured clothing and steady lighting.", diagnostics);
  const peak = spectrum(raw, fs, 0.07, 0.85);
  // A grid-bin center can fall just outside an exact 6 or 40/min boundary.
  // Permit half a bin of numerical resolution, then bound the reported rate.
  const edgeTolerance = 1 / (16 * (raw.length / fs));
  if (peak.hz < RESPIRATORY_PROTOCOL.lowHz - edgeTolerance || peak.hz > RESPIRATORY_PROTOCOL.highHz + edgeTolerance) return refusal("The dominant motion lies outside the supported 6–40 breaths/min range.", diagnostics);
  const peakHz = Math.max(RESPIRATORY_PROTOCOL.lowHz, Math.min(RESPIRATORY_PROTOCOL.highHz, peak.hz));
  const fit = sinusoidalFit(raw, fs, peakHz), repeat = periodicity(raw, fs, peakHz);
  const quality = clamp(Math.min(peak.share, fit, repeat));
  const midpoint = Math.floor(raw.length / 2);
  const halves = [raw.slice(0, midpoint), raw.slice(midpoint)].map(xs => spectrum(detrend(xs), fs, 0.07, 0.85));
  const rateDifference = Math.abs(halves[0].hz - halves[1].hz) * 60;
  const filtered = bandPass(raw, fs, RESPIRATORY_PROTOCOL.lowHz, RESPIRATORY_PROTOCOL.highHz);
  const waveform = filtered.filter((_, i) => i % 2 === 0).map((v, i) => ({ t: recent[0].t + i * 2000 / fs, v }));
  const enriched = { ...diagnostics, quality, fps, waveform, periodicity: repeat, spectralShare: peak.share, signalFit: fit, rateDifference, dominantRegion: strongest ? "abdomen" : "chest" };
  if (peak.share < 0.65 || fit < 0.45 || repeat < 0.6 || rateDifference > 3) return refusal("Motion is not consistently periodic; no respiratory estimate is reported.", enriched);
  return { ...enriched, status: "estimated", rate: Math.round(peakHz * 600) / 10, reason: "Experimental respiratory motion estimation", units: "breaths/min", motionUnits: source === "depth" ? "mm" : "image pixels" };
}

export function validateDepthRecording(input) {
  if (!input || input.schema !== "astrobone-depth-respiratory-v1" || input.units !== "mm") throw new Error("Expected astrobone-depth-respiratory-v1 with measured units: mm.");
  if (!Array.isArray(input.samples) || input.samples.length < 2 || input.samples.length > 18000) throw new Error("Depth file must contain 2–18,000 timestamped samples.");
  const samples = input.samples.map(s => {
    if (!s || ![s.t, s.chest, s.abdomen].every(Number.isFinite) || s.t < 0 || s.chest <= 0 || s.abdomen <= 0 || s.chest > 10000 || s.abdomen > 10000) throw new Error("Depth samples require t in milliseconds and chest/abdomen distances in millimeters (0–10,000).");
    if (s.motion !== undefined && (!Number.isFinite(s.motion) || s.motion < 0 || s.motion > 1)) throw new Error("motion must be normalized camera/body displacement from 0 to 1.");
    if (s.visibility !== undefined && (!Number.isFinite(s.visibility) || s.visibility < 0 || s.visibility > 1)) throw new Error("visibility must be from 0 to 1.");
    return { t: s.t, chest: s.chest, abdomen: s.abdomen, motion: s.motion ?? 0, visibility: s.visibility ?? 1, valid: s.valid !== false };
  });
  if (samples.some((s, i) => i > 0 && s.t <= samples[i - 1].t)) throw new Error("Depth timestamps must strictly increase.");
  if (samples.at(-1).t - samples[0].t > 180000) throw new Error("Import a depth recording of at most 3 minutes.");
  if (input.motionCompensated !== true) throw new Error("Depth capture must declare motionCompensated: true after camera/body compensation in the camera adapter.");
  return samples;
}
