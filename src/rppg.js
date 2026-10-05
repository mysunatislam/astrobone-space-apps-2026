// POS projection: Wang et al., Algorithmic Principles of Remote PPG (2017).
// Experimental browser implementation; engineering quality gates are not clinical validation.
const mean = a => a.reduce((sum, v) => sum + v, 0) / a.length;
const std = a => { const avg = mean(a); return Math.sqrt(mean(a.map(v => (v - avg) ** 2))); };
const failure = reason => ({ status: "insufficient", reason, bpm: null, quality: 0, waveform: [] });

export const PULSE_WINDOW = Object.freeze({
  minSeconds: 12, // first pulse estimate
  pulseSeconds: 30, // window for the pulse rate
  variabilitySeconds: 30, // minimum window for beat-to-beat variability (stress)
  maxSeconds: 60, // longest window kept
});

// Face-mesh landmarks bounding each skin region: inner forehead and both cheeks, away from the
// eyes, brows, lips and hairline.
export const SKIN_REGIONS = Object.freeze({
  forehead: [103, 332, 10, 151],
  leftCheek: [117, 118, 101, 36, 205, 187, 123, 50],
  rightCheek: [346, 347, 330, 266, 425, 411, 352, 280],
});

// Normalized boxes for each skin region, shrunk inwards so their edges stay on skin.
export function skinRegions(landmarks, shrink = 0.15) {
  if (!landmarks?.length) return null;
  const boxes = {};
  for (const [name, indices] of Object.entries(SKIN_REGIONS)) {
    const points = indices.map(i => landmarks[i]);
    if (!points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const dx = (x1 - x0) * shrink, dy = (y1 - y0) * shrink;
    boxes[name] = { x: x0 + dx, y: y0 + dy, w: x1 - x0 - 2 * dx, h: y1 - y0 - 2 * dy };
  }
  return boxes;
}

// Checks the window and returns the POS pulse signal, uniformly resampled on the source clock.
// gapBudget: share of the window that may fall in gaps over 100 ms (frames a busy page skipped).
export function posSignal(samples, { gapBudget = 0.12, maxGapMs = 700 } = {}) {
  if (samples.length < 2) return failure("Collecting the pulse window");
  const duration = (samples.at(-1).t - samples[0].t) / 1000;
  const fs = (samples.length - 1) / duration;
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
  // A busy page can skip a frame or stall briefly; resampling bridges short gaps, within a budget.
  const longGaps = gaps.filter(g => g > 100).reduce((sum, g) => sum + g, 0);
  if (fs < 15 || Math.max(...gaps) > maxGapMs || gaps.some(g => g <= 0) || longGaps > gapBudget * duration * 1000) return failure("Camera cadence is too low or irregular");
  if (samples.some(s => s.rgb.some(v => !Number.isFinite(v) || v < 20 || v > 240))) return failure("Lighting is too dark or saturated");
  // The skin regions follow the face mesh, so brief small movements are tolerated; sustained ones are not.
  if (samples.some(s => !Number.isFinite(s.motion)) || samples.filter(s => s.motion > 0.035).length > 0.1 * samples.length) return failure("Face movement is too large");
  // Uniform resampling keeps spectral timing tied to the observed source clock.
  const rgb = []; let index = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[0].t + i * 1000 / fs;
    while (index < samples.length - 2 && samples[index + 1].t < t) index++;
    const a = samples[index], b = samples[index + 1], f = (t - a.t) / (b.t - a.t);
    rgb.push(a.rgb.map((v, j) => v + f * (b.rgb[j] - v)));
  }
  const signal = new Array(rgb.length).fill(0), counts = new Array(rgb.length).fill(0);
  const width = Math.ceil(1.6 * fs);
  for (let end = width; end <= rgb.length; end++) {
    const window = rgb.slice(end - width, end), avg = [0, 1, 2].map(c => mean(window.map(p => p[c])));
    const x = window.map(p => p[1] / avg[1] - p[2] / avg[2]);
    const y = window.map(p => -2 * p[0] / avg[0] + p[1] / avg[1] + p[2] / avg[2]);
    const sy = std(y); if (sy < 1e-8) continue;
    const ratio = std(x) / sy;
    const h = x.map((v, i) => v + ratio * y[i]), center = mean(h);
    h.forEach((v, i) => { signal[end - width + i] += v - center; counts[end - width + i]++; });
  }
  signal.forEach((v, i) => { signal[i] = counts[i] ? v / counts[i] : 0; });
  if (std(signal) < 1e-5) return failure("No measurable pulse variation");
  return { signal, fs, duration };
}

export function estimatePulse(samples, { minSeconds = PULSE_WINDOW.minSeconds } = {}) {
  if (samples.length < minSeconds * 12 || (samples.at(-1).t - samples[0].t) / 1000 < minSeconds) return failure(`Collecting a ${minSeconds}-second window`);
  const pos = posSignal(samples);
  if (pos.status) return pos;
  const { signal, fs, duration } = pos;
  const spectrum = [];
  const center = mean(signal);
  // Evaluated on a 4x finer grid than the window's resolution so the peak is not quantized to it.
  for (let hz = 0.75; hz <= 3; hz += 1 / (4 * duration)) {
    let re = 0, im = 0;
    signal.forEach((v, i) => {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (signal.length - 1)));
      const phase = 2 * Math.PI * hz * i / fs;
      re += (v - center) * w * Math.cos(phase); im += (v - center) * w * Math.sin(phase);
    });
    spectrum.push({ hz, power: re * re + im * im });
  }
  const peak = spectrum.reduce((a, b) => b.power > a.power ? b : a);
  const total = spectrum.reduce((sum, p) => sum + p.power, 0);
  const quality = spectrum.filter(p => Math.abs(p.hz - peak.hz) <= 1.5 / duration).reduce((sum, p) => sum + p.power, 0) / total;
  if (!Number.isFinite(quality) || quality < 0.6) return failure("Pulse spectrum is ambiguous; use a contact sensor");
  return { status: "estimated", reason: "Experimental camera estimate", bpm: Math.round(peak.hz * 60), quality, fps: fs, duration, waveform: signal.slice(-Math.round(4 * fs)) };
}

// Beat-to-beat variability from the pulse waveform, summarized as Baevsky's stress index
// (sympathetic load: a narrow, regular beat-interval distribution scores high). Strict gates: a
// camera waveform resolves beats far less precisely than an ECG, so most windows are refused.
export function estimateStress(samples, bpm) {
  const duration = samples.length > 1 ? (samples.at(-1).t - samples[0].t) / 1000 : 0;
  if (duration < PULSE_WINDOW.variabilitySeconds) return { status: "insufficient", reason: `Stress needs ${PULSE_WINDOW.variabilitySeconds} s of steady face video` };
  // Beat timing needs nearly every frame: a device too busy to deliver them gets no stress estimate.
  if ((samples.length - 1) / duration < 24) return { status: "insufficient", reason: "Stress needs at least 24 frames per second; this device is skipping frames" };
  const pos = posSignal(samples, { gapBudget: 0.03, maxGapMs: 250 });
  if (pos.status) return { status: "insufficient", reason: pos.reason };
  const { signal, fs } = pos;
  // Zero-phase band-pass around the pulse rate: beat timing follows the pulse wave's fundamental,
  // not noise or the second (dicrotic) wave, and filtering adds no delay. The ±0.6 Hz band keeps the
  // beat-to-beat changes of breathing (0.15-0.4 Hz).
  const smooth = bandPass(signal, fs, Math.max(0.5, bpm / 60 - 0.6), bpm / 60 + 0.6);
  const minimumSpacing = 0.6 * 60 / bpm * fs, peaks = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    if (smooth[i] <= smooth[i - 1] || smooth[i] < smooth[i + 1] || smooth[i] <= 0) continue;
    // Parabolic interpolation places the peak between samples.
    const a = smooth[i - 1], b = smooth[i], c = smooth[i + 1], offset = (a - c) / (2 * (a - 2 * b + c) || 1);
    const at = i + Math.max(-0.5, Math.min(0.5, offset));
    if (peaks.length && at - peaks.at(-1).at < minimumSpacing) { if (b > peaks.at(-1).value) peaks[peaks.length - 1] = { at, value: b }; continue; }
    peaks.push({ at, value: b });
  }
  const intervals = peaks.slice(1).map((p, i) => (p.at - peaks[i].at) / fs);
  const sorted = [...intervals].sort((x, y) => x - y), typical = sorted[sorted.length >> 1];
  // Physiological range, then reject intervals more than 20 % from the typical beat (missed or extra beats).
  const clean = intervals.filter(v => v >= 0.33 && v <= 1.5 && Math.abs(v - typical) <= 0.2 * typical);
  const retained = intervals.length ? clean.length / intervals.length : 0;
  const hr = clean.length ? 60 / mean(clean) : NaN;
  if (clean.length < 20 || retained < 0.8 || !(Math.abs(hr - bpm) <= 6)) return { status: "insufficient", reason: "Beat timing is too irregular for a stress estimate" };
  const ms = clean.map(v => v * 1000);
  const rmssd = Math.sqrt(mean(ms.slice(1).map((v, i) => (v - ms[i]) ** 2)));
  const sdnn = std(ms);
  // Baevsky: SI = AMo / (2 x Mo x MxDMn), 50 ms bins; Mo and MxDMn in seconds, AMo in %.
  const bins = new Map();
  for (const v of ms) { const bin = Math.round(v / 50) * 50; bins.set(bin, (bins.get(bin) ?? 0) + 1); }
  const [modeMs, modeCount] = [...bins.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
  const range = (Math.max(...ms) - Math.min(...ms)) / 1000;
  const stressIndex = (modeCount / ms.length * 100) / (2 * (modeMs / 1000) * Math.max(range, 0.05));
  const level = stressIndex < 150 ? "low" : stressIndex < 500 ? "elevated" : "high";
  return { status: "estimated", stressIndex: Math.round(stressIndex), level, rmssdMs: Math.round(rmssd), sdnnMs: Math.round(sdnn), beats: clean.length + 1, retained };
}

// In-place radix-2 FFT (inverse when invert is true, unscaled).
function fft(re, im, invert = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (invert ? 2 : -2) * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k, b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Zero-phase band-pass with raised-cosine edges (0.15 Hz wide); the signal is mirrored at both ends
// so the edges do not ring.
export function bandPass(signal, fs, lowHz, highHz) {
  const mirrored = [...signal.slice(1).reverse(), ...signal, ...signal.slice(0, -1).reverse()];
  let n = 1; while (n < mirrored.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const center = mean(mirrored);
  mirrored.forEach((v, i) => { re[i] = v - center; });
  fft(re, im);
  const edge = 0.15;
  for (let k = 0; k < n; k++) {
    const hz = Math.min(k, n - k) * fs / n;
    let gain = 0;
    if (hz >= lowHz && hz <= highHz) gain = 1;
    else if (hz > lowHz - edge && hz < lowHz) gain = 0.5 - 0.5 * Math.cos(Math.PI * (hz - lowHz + edge) / edge);
    else if (hz > highHz && hz < highHz + edge) gain = 0.5 + 0.5 * Math.cos(Math.PI * (hz - highHz) / edge);
    re[k] *= gain; im[k] *= gain;
  }
  fft(re, im, true);
  const offset = signal.length - 1;
  return Array.from({ length: signal.length }, (_, i) => re[offset + i] / n);
}

// Collects skin colour from each frame of a camera or video source. Frames arrive with a time on
// the source clock: the page clock for a live camera, the media time for a recorded video.
export class PulseCapture {
  constructor({ onResult, reportEveryMs = 1000 }) {
    Object.assign(this, { onResult, reportEveryMs });
    // One 32 x 32 tile per skin region, downscaled with area averaging so every skin pixel counts.
    this.canvas = document.createElement("canvas"); this.canvas.width = 32; this.canvas.height = 96;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.ctx.imageSmoothingQuality = "high";
    this.samples = []; this.lastT = null; this.lastReportT = -Infinity; this.previousCenter = null; this.lastReason = null; this.regions = null;
  }

  // Skin boxes held steady over ~0.4 s: face-mesh jitter moving the box edges changes the mean colour
  // more than the pulse does. A real head movement (rejected by the motion gate anyway) resets them.
  steadyRegions(boxes, t, motion) {
    const previous = this.regions, dt = previous ? t - previous.t : 0;
    if (!previous || motion > 0.05 || dt > 500) { this.regions = { t, boxes }; return boxes; }
    const k = 1 - Math.exp(-dt / 400), steady = {};
    for (const [name, box] of Object.entries(boxes)) {
      const old = previous.boxes[name];
      steady[name] = { x: old.x + k * (box.x - old.x), y: old.y + k * (box.y - old.y), w: old.w + k * (box.w - old.w), h: old.h + k * (box.h - old.h) };
    }
    this.regions = { t, boxes: steady };
    return steady;
  }

  reset(reason = null) {
    this.samples = []; this.lastT = null; this.previousCenter = null; this.lastReportT = -Infinity; this.regions = null;
    if (reason) this.report(failure(reason));
  }

  report(result) {
    this.lastReason = result.reason;
    this.onResult({ ...result, collectedSeconds: this.samples.length > 1 ? (this.samples.at(-1).t - this.samples[0].t) / 1000 : 0 });
  }

  addFrame(source, landmarks, t) {
    if (this.lastT !== null && t === this.lastT) return;
    // A seek, a pause gap or a jump back starts a new window.
    if (this.lastT !== null && (t < this.lastT || t - this.lastT > 700)) { this.samples = []; this.previousCenter = null; this.lastReportT = -Infinity; }
    this.lastT = t;
    const boxes = skinRegions(landmarks), width = source.videoWidth, height = source.videoHeight;
    if (!boxes || !width || !height) {
      this.samples = []; this.previousCenter = null;
      if (t - this.lastReportT > this.reportEveryMs) { this.lastReportT = t; this.report(failure("A clearly visible face is required")); }
      return;
    }
    const forehead = boxes.forehead;
    if (forehead.w * width < 20 || forehead.h * height < 6) {
      this.samples = [];
      if (t - this.lastReportT > this.reportEveryMs) { this.lastReportT = t; this.report(failure("The face is too small: move closer or use a closer video")); }
      return;
    }
    const cx = forehead.x + forehead.w / 2, cy = forehead.y + forehead.h / 2;
    const motion = this.previousCenter ? Math.hypot(cx - this.previousCenter[0], cy - this.previousCenter[1]) / forehead.w : 0;
    this.previousCenter = [cx, cy];
    Object.values(this.steadyRegions(boxes, t, motion)).forEach((box, k) => {
      const x = Math.max(0, box.x), y = Math.max(0, box.y), w = Math.min(1, box.x + box.w) - x, h = Math.min(1, box.y + box.h) - y;
      if (w > 0 && h > 0) this.ctx.drawImage(source, x * width, y * height, w * width, h * height, 0, k * 32, 32, 32);
    });
    // Average only skin-range pixels, so stray hair, brows or glare do not dilute the pulse.
    const pixels = this.ctx.getImageData(0, 0, 32, 96).data, rgb = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (luminance < 25 || luminance > 240) continue;
      rgb[0] += pixels[i]; rgb[1] += pixels[i + 1]; rgb[2] += pixels[i + 2]; count++;
    }
    if (count < 192) { this.samples = []; return; }
    this.samples.push({ t, rgb: rgb.map(v => v / count), motion });
    while (this.samples.length && t - this.samples[0].t > PULSE_WINDOW.maxSeconds * 1000) this.samples.shift();
    if (t - this.lastReportT < this.reportEveryMs) return;
    this.lastReportT = t;
    const recent = this.samples.filter(s => t - s.t <= PULSE_WINDOW.pulseSeconds * 1000);
    const pulse = estimatePulse(recent);
    if (pulse.status === "estimated") pulse.stress = estimateStress(this.samples, pulse.bpm);
    this.report(pulse);
  }
}
