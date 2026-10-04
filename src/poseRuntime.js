export async function createPoseRuntime({ createLandmarker, createCanvas, preference = "AUTO", onProgress = () => {} }) {
  if (!["AUTO", "GPU", "CPU"].includes(preference)) throw new Error("Unknown pose delegate preference");
  let fallbackReason = null;
  if (preference !== "CPU") {
    let canvas;
    try {
      canvas = createCanvas();
      if (!canvas) throw new Error("Offscreen GPU canvas unavailable");
      onProgress("initializing GPU pose inference");
      const landmarker = await createLandmarker("GPU", canvas);
      return { landmarker, canvas, info: { delegate: "GPU", preference, fallbackReason: null } };
    } catch (error) {
      releasePoseCanvas(canvas);
      if (preference === "GPU") throw error;
      fallbackReason = error instanceof Error ? error.message : String(error);
    }
  }
  onProgress(fallbackReason ? "GPU unavailable; initializing CPU pose inference" : "initializing CPU pose inference");
  const landmarker = await createLandmarker("CPU");
  return { landmarker, canvas: null, info: { delegate: "CPU", preference, fallbackReason } };
}

export function releasePoseCanvas(canvas) {
  try { canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* Already disposed. */ }
}

export function closePoseRuntime(runtime) {
  try { runtime?.landmarker.close(); } finally { releasePoseCanvas(runtime?.canvas); }
}
