// Casiez et al. (2012), 1 Euro Filter: derivative-adaptive first-order low pass.
export class OneEuroVector {
  constructor({ minCutoff = 1.2, beta = .08, derivativeCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, derivativeCutoff }); this.reset();
  }
  reset() { this.previous = null; this.filtered = null; this.derivative = null; this.time = null; }
  update(values, time) {
    if (!values.every(Number.isFinite) || !Number.isFinite(time)) return null;
    const dt = (time - this.time) / 1000;
    if (!this.previous || values.length !== this.previous.length || dt <= 0 || dt > 1) {
      this.previous = [...values]; this.filtered = [...values]; this.derivative = values.map(() => 0); this.time = time; return [...values];
    }
    const alpha = cutoff => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const da = alpha(this.derivativeCutoff);
    values.forEach((value, i) => {
      this.derivative[i] += da * ((value - this.previous[i]) / dt - this.derivative[i]);
      const a = alpha(this.minCutoff + this.beta * Math.abs(this.derivative[i]));
      this.filtered[i] += a * (value - this.filtered[i]);
    });
    this.time = time; this.previous = [...values]; return [...this.filtered];
  }
}
