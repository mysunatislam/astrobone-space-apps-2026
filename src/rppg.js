// POS projection: Wang et al., Algorithmic Principles of Remote PPG (2017).
// Experimental browser implementation; engineering quality gates are not clinical validation.
const mean = a => a.reduce((sum, v) => sum + v, 0) / a.length;
const std = a => { const avg = mean(a); return Math.sqrt(mean(a.map(v => (v - avg) ** 2))); };
const failure = reason => ({ status: "insufficient", reason, bpm: null, quality: 0, waveform: [] });

export function estimatePulse(samples) {
  if (samples.length < 240) return failure("Collecting a 20-second window");
  const duration = (samples.at(-1).t - samples[0].t) / 1000;
  if (duration < 20) return failure("Collecting a 20-second window");
  const fs = (samples.length - 1) / duration;
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
  if (fs < 15 || Math.max(...gaps) > 200 || gaps.some(g => g <= 0) || std(gaps) / mean(gaps) > 0.35) return failure("Camera cadence is too low or irregular");
  if (samples.some(s => s.rgb.some(v => !Number.isFinite(v) || v < 20 || v > 240))) return failure("Lighting is too dark or saturated");
  if (samples.some(s => !Number.isFinite(s.motion) || s.motion > 0.035)) return failure("Face movement is too large");
  // Uniform resampling keeps spectral timing tied to the observed camera clock.
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
  const spectrum = [];
  const center = mean(signal);
  for (let hz = 0.75; hz <= 3; hz += 1 / duration) {
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
  return { status: "estimated", reason: "Experimental camera estimate", bpm: Math.round(peak.hz * 60), quality, fps: fs, duration, waveform: signal.slice(-120) };
}

export class PulseCapture {
  constructor({ video, getFace, isLiveCamera, onResult }) {
    Object.assign(this, { video, getFace, isLiveCamera, onResult });
    this.canvas = document.createElement("canvas"); this.canvas.width = 32; this.canvas.height = 32;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.active = false; this.samples = []; this.lastTime = -1; this.lastReport = 0; this.previousCenter = null;
  }
  start() { this.stop(); this.active = true; this.tick(); }
  stop() { this.active = false; cancelAnimationFrame(this.frame); this.samples = []; this.lastTime = -1; this.previousCenter = null; this.onResult(failure("Pulse capture stopped")); }
  tick = () => {
    if (!this.active) return;
    this.frame = requestAnimationFrame(this.tick);
    const now = performance.now(), face = this.getFace();
    const pts = face?.face?.landmarks;
    if (document.hidden || !this.isLiveCamera() || this.video.paused || !pts || now - face.timestamp > 900) {
      this.samples = []; this.previousCenter = null;
      if (now - this.lastReport > 1000) { this.lastReport = now; this.onResult(failure("Live camera and a clearly visible face are required")); }
      return;
    }
    if (this.video.currentTime === this.lastTime) return;
    this.lastTime = this.video.currentTime;
    // Inner forehead ROI avoids eyes, eyebrows, lips and background.
    const left = pts[103], right = pts[332], top = pts[10], bottom = pts[151];
    if (![left, right, top, bottom].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    const x = Math.min(left.x, right.x), y = Math.min(top.y, bottom.y), w = Math.abs(right.x - left.x), h = Math.abs(bottom.y - top.y);
    if (w * this.video.videoWidth < 24 || h * this.video.videoHeight < 8 || x < 0 || y < 0 || x + w > 1 || y + h > 1) {
      this.samples = []; this.onResult(failure("Move closer: the forehead region is too small")); return;
    }
    const cx = x + w / 2, cy = y + h / 2;
    const motion = this.previousCenter ? Math.hypot(cx - this.previousCenter[0], cy - this.previousCenter[1]) / w : 0;
    this.previousCenter = [cx, cy];
    this.ctx.drawImage(this.video, x * this.video.videoWidth, y * this.video.videoHeight, w * this.video.videoWidth, h * this.video.videoHeight, 0, 0, 32, 32);
    const pixels = this.ctx.getImageData(0, 0, 32, 32).data, rgb = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += pixels[i + c] / 1024;
    this.samples.push({ t: now, rgb, motion }); this.samples = this.samples.filter(s => now - s.t <= 22000);
    if (now - this.lastReport > 1500) { this.lastReport = now; this.onResult({ ...estimatePulse(this.samples), collectedSeconds: this.samples.length ? (now - this.samples[0].t) / 1000 : 0 }); }
  };
}
