import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { skinRegions } from "./rppg.js";
import { FaceBoxSmoother, blazeBoxFromMesh, clampCropBox, rgbaToModelInput, loadMeRppg, ME_CROP } from "./meRppg.js";

// Camera pulse worker: per frame, the ME-rPPG wave sample (face crop from the face mesh) and the mean skin colour of
// the forehead and cheeks (face mesh), both timed by the frame's own timestamp. The validated hybrid
// (docs/real-video-validation.md) fuses these on the main thread.
let mesh = null, me = null;
const box = new FaceBoxSmoother();
const crop = new OffscreenCanvas(ME_CROP, ME_CROP), cropCtx = crop.getContext("2d", { willReadFrequently: true });
const tiles = new OffscreenCanvas(32, 96), tilesCtx = tiles.getContext("2d", { willReadFrequently: true });
let steady = null, previousCenter = null, previousT = null;

self.addEventListener("message", event => { void handle(event.data); });

async function handle(message) {
  if (message?.type === "initialize") {
    try {
      self.postMessage({ type: "progress", label: "Loading face models" });
      const vision = await FilesetResolver.forVisionTasks(message.wasmUrl, true);
      self.postMessage({ type: "progress", label: "Loading face mesh" });
      mesh = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetBuffer: await fetchModel(message.meshUrl), delegate: "CPU" }, runningMode: "VIDEO", numFaces: 1 });
      self.postMessage({ type: "progress", label: "Loading pulse model" });
      me = await loadMeRppg(message.baseUrl);
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
    }
  } else if (message?.type === "reset") {
    box.reset(); me?.reset(); steady = null; previousCenter = null; previousT = null;
  } else if (message?.type === "frame") {
    const { bitmap, t } = message;
    try { self.postMessage({ type: "sample", t, ...(await analyze(bitmap, t)) }); } catch (error) { self.postMessage({ type: "error", error: String(error) }); } finally { bitmap.close(); }
  } else if (message?.type === "close") {
    mesh?.close(); self.close();
  }
}

async function fetchModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Face model request failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function analyze(bitmap, t) {
  const W = bitmap.width, H = bitmap.height, out = { bvp: null, rgb: null, motion: null, face: null };
  const landmarks = mesh.detectForVideo(bitmap, t).faceLandmarks?.[0];
  const found = blazeBoxFromMesh(landmarks, W, H);
  if (found) {
    const b = clampCropBox(box.update(found), W, H);
    if (b) {
      cropCtx.imageSmoothingEnabled = true; cropCtx.imageSmoothingQuality = "high";
      cropCtx.drawImage(bitmap, b.x, b.y, b.w, b.h, 0, 0, ME_CROP, ME_CROP);
      out.bvp = await me.step(rgbaToModelInput(cropCtx.getImageData(0, 0, ME_CROP, ME_CROP).data), t);
      out.face = { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H };
    }
  }
  const regions = landmarks ? skinRegions(landmarks) : null;
  if (regions) {
    const f = regions.forehead, center = [f.x + f.w / 2, f.y + f.h / 2];
    // Movement per 1/30 s, the frame rate the movement gate was validated at: a slower device processes
    // fewer frames, so its raw step between processed frames is larger for the same head movement.
    const gap = previousCenter ? t - previousT : 0;
    const motion = gap > 0 ? Math.hypot(center[0] - previousCenter[0], center[1] - previousCenter[1]) / f.w * Math.min(1, 1000 / 30 / gap) : 0;
    previousCenter = center; previousT = t;
    // Skin boxes held over ~0.4 s, as in src/rppg.js PulseCapture.
    const dt = steady ? t - steady.t : 0, k = 1 - Math.exp(-dt / 400);
    const held = !steady || motion > 0.05 || dt > 500 ? regions : Object.fromEntries(Object.entries(regions).map(([n, r]) => { const o = steady.boxes[n]; return [n, { x: o.x + k * (r.x - o.x), y: o.y + k * (r.y - o.y), w: o.w + k * (r.w - o.w), h: o.h + k * (r.h - o.h) }]; }));
    steady = { t, boxes: held };
    Object.values(held).forEach((r, i) => {
      const x = Math.max(0, r.x), y = Math.max(0, r.y), w = Math.min(1, r.x + r.w) - x, h = Math.min(1, r.y + r.h) - y;
      if (w > 0 && h > 0) tilesCtx.drawImage(bitmap, x * W, y * H, w * W, h * H, 0, i * 32, 32, 32);
    });
    const px = tilesCtx.getImageData(0, 0, 32, 96).data, rgb = [0, 0, 0]; let count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < 25 || lum > 240) continue;
      rgb[0] += px[i]; rgb[1] += px[i + 1]; rgb[2] += px[i + 2]; count++;
    }
    if (count >= 192) { out.rgb = rgb.map(v => v / count); out.motion = motion; }
  } else { previousCenter = null; previousT = null; }
  return out;
}
