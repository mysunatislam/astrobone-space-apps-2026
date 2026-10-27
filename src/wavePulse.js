// Heart rate from a pulse wave (one sample per camera frame), as validated offline in
// docs/real-video-validation.md: resample on the source clock, zero-phase band-pass, Hann-windowed
// spectrum on a fine grid, and a peak-share quality gate. The same function scores every method in
// scripts/validation/score-wave-pulse.mjs, so the reported accuracy is this code's accuracy.
import { bandPass } from "./rppg.js";

export const WAVE_PULSE = Object.freeze({
  lowHz: 0.7, // 42 bpm
  highHz: 3.0, // 180 bpm
  windowSeconds: 30, // pulse window, as for the face-colour method
  minSeconds: 15, // first estimate
  // Share of band power in the peak below which a window is refused. Chosen on MCD-rPPG
  // (see docs/real-video-validation.md); refusing is safer than a wrong resting heart rate.
  minQuality: 0.3,
});

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

// Uniform resampling at the observed frame rate, bridging short gaps (a dropped frame) only.
export function resampleWave(samples, { maxGapMs = 700 } = {}) {
  const usable = samples.filter(s => Number.isFinite(s.v) && Number.isFinite(s.t));
  if (usable.length < 2) return null;
  const duration = (usable.at(-1).t - usable[0].t) / 1000;
  if (!(duration > 0)) return null;
  for (let i = 1; i < usable.length; i++) if (usable[i].t - usable[i - 1].t > maxGapMs || usable[i].t <= usable[i - 1].t) return null;
  const fs = (usable.length - 1) / duration, out = [];
  let k = 0;
  for (let i = 0; i < usable.length; i++) {
    const t = usable[0].t + i * 1000 / fs;
    while (k < usable.length - 2 && usable[k + 1].t < t) k++;
    const a = usable[k], b = usable[k + 1], f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    out.push(a.v + f * (b.v - a.v));
  }
  return { signal: out, fs, duration };
}

// Hann-windowed DFT on a grid 4x finer than the window's resolution; peak and its power share.
export function waveSpectrumPeak(signal, fs, lowHz, highHz) {
  const n = signal.length, duration = n / fs, center = mean(signal), step = 1 / (4 * duration);
  const window = signal.map((v, i) => (v - center) * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
  const spectrum = [];
  for (let hz = lowHz; hz <= highHz + 1e-9; hz += step) {
    let re = 0, im = 0; const w = 2 * Math.PI * hz / fs;
    for (let i = 0; i < n; i++) { re += window[i] * Math.cos(w * i); im += window[i] * Math.sin(w * i); }
    spectrum.push({ hz, power: re * re + im * im });
  }
  const peak = spectrum.reduce((a, b) => (b.power > a.power ? b : a));
  const total = spectrum.reduce((s, p) => s + p.power, 0);
  const quality = total > 0 ? spectrum.filter(p => Math.abs(p.hz - peak.hz) <= 1.5 / duration).reduce((s, p) => s + p.power, 0) / total : 0;
  return { hz: peak.hz, quality, spectrum };
}

// samples: [{ t: ms on the source clock, v: pulse-wave value }], oldest first.
export function estimateWavePulse(samples, { lowHz = WAVE_PULSE.lowHz, highHz = WAVE_PULSE.highHz, windowSeconds = WAVE_PULSE.windowSeconds, minSeconds = WAVE_PULSE.minSeconds, minQuality = WAVE_PULSE.minQuality } = {}) {
  if (!samples?.length) return { status: "insufficient", reason: "Collecting the pulse window", bpm: null, quality: 0 };
  const end = samples.at(-1).t, recent = samples.filter(s => end - s.t <= windowSeconds * 1000);
  const wave = resampleWave(recent);
  if (!wave || wave.duration < minSeconds) return { status: "insufficient", reason: `Collecting a ${minSeconds}-second window`, bpm: null, quality: 0 };
  if (wave.fs < 15) return { status: "insufficient", reason: "Camera cadence is too low", bpm: null, quality: 0 };
  const filtered = bandPass(wave.signal, wave.fs, lowHz, highHz);
  const peak = waveSpectrumPeak(filtered, wave.fs, lowHz, highHz);
  const bpm = peak.hz * 60;
  // A peak on the band edge is a slope, not a pulse.
  if (peak.hz - lowHz < 0.02 || highHz - peak.hz < 0.02) return { status: "insufficient", reason: "No clear pulse peak", bpm: null, quality: peak.quality };
  if (!(peak.quality >= minQuality)) return { status: "insufficient", reason: "Pulse signal is ambiguous; hold still in steady light", bpm: null, quality: peak.quality };
  return { status: "estimated", bpm: Math.round(bpm), bpmExact: bpm, quality: peak.quality, fps: wave.fs, duration: wave.duration, waveform: filtered.slice(-Math.round(4 * wave.fs)) };
}

// Hybrid: spectral fusion of several pulse waves from the same frames (for example the deep ME-rPPG
// wave and the face-colour POS and CHROM waves). Each wave's band spectrum is normalized to unit
// power and weighted by its own peak share, so a clean wave outvotes a noisy one; the fused peak is
// the heart rate. Agreement between independent methods is what the fused quality measures.
export function estimateFusedPulse(waves, { lowHz = WAVE_PULSE.lowHz, highHz = WAVE_PULSE.highHz, windowSeconds = WAVE_PULSE.windowSeconds, minSeconds = WAVE_PULSE.minSeconds, minQuality = WAVE_PULSE.minQuality, power = 2 } = {}) {
  const parts = [];
  let slow = null;
  for (const { samples, weight = 1, name } of waves) {
    if (!samples?.length) continue;
    const end = samples.at(-1).t, wave = resampleWave(samples.filter(s => end - s.t <= windowSeconds * 1000));
    if (!wave || wave.duration < minSeconds) continue;
    if (wave.fs < 15) { slow = wave.fs; continue; }
    const peak = waveSpectrumPeak(bandPass(wave.signal, wave.fs, lowHz, highHz), wave.fs, lowHz, highHz);
    const total = peak.spectrum.reduce((s, p) => s + p.power, 0);
    if (!(total > 0)) continue;
    parts.push({ name, weight: weight * peak.quality ** power, quality: peak.quality, hz: peak.hz, spectrum: peak.spectrum.map(p => ({ hz: p.hz, power: p.power / total })) });
  }
  if (!parts.length) {
    const reason = slow !== null ? `Only ${Math.round(slow)} frames a second were analyzed (15 needed): close other apps or tabs and try again` : `Collecting a ${minSeconds}-second window`;
    return { status: "insufficient", reason, bpm: null, quality: 0, parts };
  }
  // Common grid: the finest one, each spectrum read by nearest bin.
  const grid = parts.reduce((a, b) => (b.spectrum.length > a.spectrum.length ? b : a)).spectrum.map(p => p.hz);
  const step = grid[1] - grid[0];
  const fused = grid.map(hz => parts.reduce((sum, part) => {
    const s = part.spectrum, i = Math.min(s.length - 1, Math.max(0, Math.round((hz - s[0].hz) / (s[1].hz - s[0].hz))));
    return sum + part.weight * s[i].power;
  }, 0));
  let k = 0; fused.forEach((v, i) => { if (v > fused[k]) k = i; });
  const total = fused.reduce((s, v) => s + v, 0), duration = 1 / (4 * step);
  const quality = total > 0 ? fused.reduce((s, v, i) => s + (Math.abs(grid[i] - grid[k]) <= 1.5 / duration ? v : 0), 0) / total : 0;
  const hz = grid[k];
  if (hz - lowHz < 0.02 || highHz - hz < 0.02) return { status: "insufficient", reason: "No clear pulse peak", bpm: null, quality, parts };
  if (!(quality >= minQuality)) return { status: "insufficient", reason: "Pulse signal is ambiguous; hold still in steady light", bpm: null, quality, parts };
  return { status: "estimated", bpm: Math.round(hz * 60), bpmExact: hz * 60, quality, parts };
}

// Face-colour pulse waves for the hybrid, from [{ t, rgb }] skin samples: uniform resampling, then
// POS (Wang et al., IEEE TBME 2017) and CHROM (de Haan & Jeanne, IEEE TBME 2013), both overlap-added
// over 1.6 s windows. Returned as [{ t, v }] waves on the resampled clock.
export function colourWaves(samples, { winSeconds = 1.6 } = {}) {
  const channels = [0, 1, 2].map(c => resampleWave(samples.map(s => ({ t: s.t, v: s.rgb?.[c] }))));
  if (channels.some(c => !c)) return null;
  const { fs } = channels[0], n = Math.min(...channels.map(c => c.signal.length));
  const rgb = Array.from({ length: n }, (_, i) => channels.map(c => c.signal[i]));
  const t0 = samples.find(s => s.rgb?.every(Number.isFinite)).t;
  const width = Math.ceil(winSeconds * fs);
  if (n < 2 * width) return null;
  const pos = new Array(n).fill(0), posCount = new Array(n).fill(0), chrom = new Array(n).fill(0);
  for (let end = width; end <= n; end++) {
    const w = rgb.slice(end - width, end), avg = [0, 1, 2].map(c => mean(w.map(p => p[c])));
    const x = w.map(p => p[1] / avg[1] - p[2] / avg[2]), y = w.map(p => -2 * p[0] / avg[0] + p[1] / avg[1] + p[2] / avg[2]);
    const sx = Math.sqrt(mean(x.map(v => (v - mean(x)) ** 2))), sy = Math.sqrt(mean(y.map(v => (v - mean(y)) ** 2)));
    if (sy < 1e-9) continue;
    const h = x.map((v, i) => v + sx / sy * y[i]), hc = mean(h);
    h.forEach((v, i) => { pos[end - width + i] += v - hc; posCount[end - width + i]++; });
  }
  // CHROM: chrominance from colour normalized by its 1.6 s running mean, band-passed over the whole
  // window (a 1.6 s piece is too short to filter on its own), then alpha per half-overlapping piece.
  const half = Math.max(1, Math.floor(width / 2)), hann = Array.from({ length: 2 * half }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (2 * half - 1)));
  const local = rgb.map((_, i) => { const a = Math.max(0, i - half), b = Math.min(n, i + half + 1), w = rgb.slice(a, b); return [0, 1, 2].map(c => mean(w.map(p => p[c]))); });
  const xs = bandPass(rgb.map((p, i) => 3 * p[0] / local[i][0] - 2 * p[1] / local[i][1]), fs, 0.7, 3.0);
  const ys = bandPass(rgb.map((p, i) => 1.5 * p[0] / local[i][0] + p[1] / local[i][1] - 1.5 * p[2] / local[i][2]), fs, 0.7, 3.0);
  for (let start = 0; start + 2 * half <= n; start += half) {
    const xw = xs.slice(start, start + 2 * half), yw = ys.slice(start, start + 2 * half);
    const sx = Math.sqrt(mean(xw.map(v => v * v))), sy = Math.sqrt(mean(yw.map(v => v * v))), a = sy > 1e-12 ? sx / sy : 0;
    xw.forEach((v, i) => { chrom[start + i] += (v - a * yw[i]) * hann[i]; });
  }
  const toWave = values => values.map((v, i) => ({ t: t0 + i * 1000 / fs, v }));
  return { fs, pos: toWave(pos.map((v, i) => (posCount[i] ? v / posCount[i] : 0))), chrom: toWave(chrom) };
}
