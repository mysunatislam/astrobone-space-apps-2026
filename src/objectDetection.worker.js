import {
  FilesetResolver,
  ObjectDetector,
} from "@mediapipe/tasks-vision";

let detector = null;

self.addEventListener("message", (event) => {
  void handleMessage(event.data);
});

async function handleMessage(message) {
  if (message?.type === "initialize") {
    await initializeDetector(message);
    return;
  }
  if (message?.type === "frame") {
    detectFrame(message);
    return;
  }
  if (message?.type === "close") {
    detector?.close();
    detector = null;
    self.close();
  }
}

async function initializeDetector({ modelUrl, wasmUrl }) {
  try {
    const vision = await FilesetResolver.forVisionTasks(wasmUrl, true);
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Object model request failed with HTTP ${response.status}.`);
    }
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetBuffer,
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      maxResults: 5,
      scoreThreshold: 0.55,
      categoryDenylist: ["person"],
    });
    self.postMessage({ type: "ready" });
  } catch (error) {
    postError(error);
  }
}

function detectFrame({
  bitmap,
  timestamp,
  frameWidth,
  frameHeight,
  cameraSessionId,
}) {
  if (!detector) {
    bitmap?.close?.();
    postError(new Error("Object detector is not ready."));
    return;
  }
  const startedAt = performance.now();
  try {
    const result = detector.detectForVideo(bitmap, timestamp);
    self.postMessage({
      type: "result",
      detections: serializeDetections(result.detections),
      inferenceMs: performance.now() - startedAt,
      timestamp,
      frameWidth,
      frameHeight,
      cameraSessionId,
    });
  } catch (error) {
    postError(error);
  } finally {
    bitmap?.close?.();
  }
}

function serializeDetections(detections) {
  return (detections ?? []).map((detection) => ({
    categories: (detection.categories ?? []).map((category) => ({
      score: Number(category.score),
      index: Number(category.index),
      categoryName: String(category.categoryName ?? ""),
      displayName: String(category.displayName ?? ""),
    })),
    boundingBox: detection.boundingBox
      ? {
        originX: Number(detection.boundingBox.originX),
        originY: Number(detection.boundingBox.originY),
        width: Number(detection.boundingBox.width),
        height: Number(detection.boundingBox.height),
        angle: Number(detection.boundingBox.angle ?? 0),
      }
      : null,
  }));
}

function postError(error) {
  self.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}
