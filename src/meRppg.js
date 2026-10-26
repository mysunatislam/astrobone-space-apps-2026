// ME-rPPG (Wang et al., arXiv 2504.01774, 2025; MIT licence): a 2.5 MB recurrent deep model that turns
// one 36 x 36 face crop per frame into one pulse-wave sample. Run as its official web demo runs it:
// a BlazeFace short-range box (here derived from the face mesh, see blazeBoxFromMesh), smoothed by four Kalman filters, made 20 % taller and raised to
// take in the forehead, cropped from the full frame, values 0-1. The time step is the seconds since
// the previous crop, at least 1/90 s. Validated offline on real video in docs/real-video-validation.md.

export const ME_CROP = 36;

// The demo's one-dimensional Kalman filter.
export class Kalman1D {
  constructor(q, r, x, p) { Object.assign(this, { q, r, x, p }); }
  update(z) {
    const p = this.p + this.q, k = p / (p + this.r);
    this.x += k * (z - this.x); this.p = (1 - k) * p;
    return this.x;
  }
}

// The face-mesh landmark box mapped to the box BlazeFace draws (fitted on 540 frames of real face
// video, median error about 2 % of face width), so the app crops from the mesh it already runs.
export const MESH_TO_BLAZE = Object.freeze([-0.0077, 0.1079, 1.0849, 0.9405]);
export function blazeBoxFromMesh(landmarks, width, height) {
  if (!landmarks?.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of landmarks) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const w = (x1 - x0) * width, h = (y1 - y0) * height, [a, b, c, d] = MESH_TO_BLAZE;
  return { originX: x0 * width + a * w, originY: y0 * height + b * h, width: c * w, height: d * h };
}

// BlazeFace box (pixels) -> smoothed crop box: process noise 0.01, measurement noise 0.5.
export class FaceBoxSmoother {
  constructor() { this.reset(); }
  reset() { this.kf = null; }
  update({ originX, originY, width, height }) {
    const raw = [originX, originY, width, height];
    if (!this.kf) this.kf = raw.map(v => new Kalman1D(1e-2, 5e-1, v, 1));
    else raw.forEach((v, i) => this.kf[i].update(v));
    const [x, y, w, h0] = this.kf.map(k => k.x), h = h0 * 1.2;
    return { x, y: y - h * 0.2, w, h };
  }
}

// Clamp the box to the frame the way the demo does; null when too small to crop.
export function clampCropBox(box, frameWidth, frameHeight) {
  const x = Math.max(0, box.x), y = Math.max(0, box.y);
  const w = Math.min(box.w, frameWidth - x), h = Math.min(box.h, frameHeight - y);
  return w >= 2 && h >= 2 ? { x, y, w, h } : null;
}

// RGBA pixels of a 36 x 36 crop -> Float32Array in height, width, channel order, 0-1.
export function rgbaToModelInput(rgba) {
  const out = new Float32Array(ME_CROP * ME_CROP * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i] / 255; out[j + 1] = rgba[i + 1] / 255; out[j + 2] = rgba[i + 2] / 255; }
  return out;
}

export function meTimeStep(previousT, t) {
  return Math.max(previousT == null ? 1 / 30 : (t - previousT) / 1000, 1 / 90);
}

// Loads ONNX Runtime (WebAssembly, single thread; the bundler ships its .wasm), the model and its starting state.
export async function loadMeRppg(baseUrl) {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1; // GitHub Pages is not cross-origin isolated
  const root = new URL(`${baseUrl}models/me-rppg/`, location.href).href;
  const [model, shapes, stateBytes] = await Promise.all([
    fetch(`${root}model.onnx`).then(r => r.arrayBuffer()), fetch(`${root}state.json`).then(r => r.json()), fetch(`${root}state.bin`).then(r => r.arrayBuffer()),
  ]);
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const all = new Float32Array(stateBytes); let offset = 0;
  const init = shapes.map(({ name, dims }) => { const size = dims.reduce((a, b) => a * b, 1), data = all.slice(offset, offset + size); offset += size; return { name, dims, data }; });
  if (session.inputNames.length !== init.length + 2 || session.inputNames.slice(1, -1).some((n, i) => n !== init[i].name)) throw new Error("ME-rPPG model and state do not match");
  let state = null, lastT = null;
  const reset = () => { state = init.map(({ data, dims }) => new ort.Tensor("float32", data, dims)); lastT = null; };
  reset();
  return {
    reset,
    // frame: Float32Array(36*36*3); t: ms on the source clock. Returns one pulse-wave sample.
    async step(frame, t) {
      const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", frame, [1, 1, ME_CROP, ME_CROP, 3]) };
      state.forEach((s, i) => { feeds[session.inputNames[i + 1]] = s; });
      feeds[session.inputNames.at(-1)] = new ort.Tensor("float32", new Float32Array([meTimeStep(lastT, t)]), []);
      lastT = t;
      const out = await session.run(feeds);
      state = session.outputNames.slice(1).map(n => out[n]);
      return out[session.outputNames[0]].data[0];
    },
  };
}
