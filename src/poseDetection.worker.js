import {
  FilesetResolver,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import { createPoseRuntime, closePoseRuntime } from "./poseRuntime.js";

let runtime = null;
let createLandmarker = null;

self.addEventListener("message", (event) => {
  void handleMessage(event.data);
});

async function handleMessage(message) {
  if (message?.type === "initialize") {
    await initializeLandmarker(message);
    return;
  }
  if (message?.type === "frame") {
    await detectFrame(message);
    return;
  }
  if (message?.type === "close") {
    closePoseRuntime(runtime);
    runtime = null;
    self.close();
  }
}

async function initializeLandmarker({ modelUrl, wasmUrl, delegate = "AUTO" }) {
  try {
    self.postMessage({ type: "progress", label: "loading vision runtime" });
    const vision = await FilesetResolver.forVisionTasks(wasmUrl, true);
    self.postMessage({ type: "progress", label: "loading pose model" });
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Pose model request failed with HTTP ${response.status}.`);
    }
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    createLandmarker = (backend, canvas) => PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetBuffer,
        delegate: backend,
      },
      ...(canvas ? { canvas } : {}),
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputSegmentationMasks: false,
    });
    runtime = await createPoseRuntime({ createLandmarker, preference: delegate,
      createCanvas: () => typeof OffscreenCanvas === "function" ? new OffscreenCanvas(640, 640) : null,
      onProgress: label => self.postMessage({ type: "progress", label }),
    });
    self.postMessage({ type: "ready", runtime: runtime.info });
  } catch (error) {
    postError(error);
  }
}

async function detectFrame({ bitmap, timestamp, cameraSessionId, mediaTime }) {
  if (!runtime) {
    bitmap?.close?.();
    postError(new Error("Pose landmarker is not ready."));
    return;
  }
  const startedAt = performance.now();
  try {
    let result;
    try {
      result = runtime.landmarker.detectForVideo(bitmap, timestamp);
    } catch (error) {
      if (runtime.info.delegate !== "GPU" || runtime.info.preference !== "AUTO") throw error;
      // Retry this frame once on CPU; include recovery cost in the measured latency.
      try { closePoseRuntime(runtime); } catch { /* Context may already be lost. */ }
      runtime = null;
      runtime = await createPoseRuntime({ createLandmarker, preference: "CPU" });
      runtime.info = { delegate: "CPU", preference: "AUTO", fallbackReason: `GPU frame failed: ${error.message || String(error)}` };
      self.postMessage({ type: "backend", runtime: runtime.info });
      result = runtime.landmarker.detectForVideo(bitmap, timestamp);
    }
    self.postMessage({
      type: "result",
      landmarks: serializePoses(result.landmarks),
      worldLandmarks: serializePoses(result.worldLandmarks),
      inferenceMs: performance.now() - startedAt,
      runtime: runtime.info,
      timestamp,
      mediaTime,
      cameraSessionId,
    });
  } catch (error) {
    postError(error);
  } finally {
    bitmap?.close?.();
  }
}

function serializePoses(poses) {
  return (poses ?? []).map((pose) => pose.map((landmark) => ({
    x: Number(landmark.x),
    y: Number(landmark.y),
    z: Number(landmark.z),
    visibility: Number(landmark.visibility ?? 0),
    ...(Number.isFinite(landmark.presence) ? { presence: Number(landmark.presence) } : {}),
  })));
}

function postError(error) {
  self.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}
