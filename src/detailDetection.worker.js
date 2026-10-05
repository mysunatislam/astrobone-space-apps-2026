import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

let handLandmarker = null;
let faceLandmarker = null;

self.addEventListener("message", (event) => {
  void handleMessage(event.data);
});

async function handleMessage(message) {
  if (message?.type === "initialize") {
    await initialize(message);
  } else if (message?.type === "frame") {
    detectFrame(message);
  } else if (message?.type === "close") {
    handLandmarker?.close();
    faceLandmarker?.close();
    self.close();
  }
}

async function initialize({ handModelUrl, faceModelUrl, wasmUrl }) {
  try {
    self.postMessage({ type: "progress", label: "Loading hand and face runtime" });
    const vision = await FilesetResolver.forVisionTasks(wasmUrl, true);
    const [handModel, faceModel] = await Promise.all([
      fetchModel(handModelUrl),
      fetchModel(faceModelUrl),
    ]);
    self.postMessage({ type: "progress", label: "Initializing hand landmarks" });
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: handModel, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
    self.postMessage({ type: "progress", label: "Initializing face mesh" });
    // Each task consumes ModuleFactory. A distinct ESM URL reruns its initializer.
    const faceLoader = new URL(vision.wasmLoaderPath, self.location.href);
    faceLoader.searchParams.set("task", "face");
    faceLandmarker = await FaceLandmarker.createFromOptions({
      ...vision, wasmLoaderPath: faceLoader.href,
    }, {
      baseOptions: { modelAssetBuffer: faceModel, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    self.postMessage({ type: "ready" });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

async function fetchModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Detailed landmark model request failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

// hands: false skips the hand model (recorded-video analysis runs it on every third frame only).
function detectFrame({ bitmap, timestamp, cameraSessionId, mediaTime, analysis = false, hands: withHands = true }) {
  if (!handLandmarker || !faceLandmarker) {
    bitmap?.close?.();
    self.postMessage({ type: "error", error: "Detailed landmark models are not ready." });
    return;
  }
  const startedAt = performance.now();
  try {
    const hands = withHands ? handLandmarker.detectForVideo(bitmap, timestamp) : null;
    const faces = faceLandmarker.detectForVideo(bitmap, timestamp);
    self.postMessage({
      type: "result",
      timestamp,
      mediaTime,
      analysis,
      cameraSessionId,
      inferenceMs: performance.now() - startedAt,
      hands: withHands ? (hands.landmarks ?? []).map((landmarks, index) => ({
        landmarks: serializeLandmarks(landmarks),
        worldLandmarks: serializeLandmarks(hands.worldLandmarks?.[index]),
        handedness: hands.handednesses?.[index]?.[0]?.categoryName ?? null,
        confidence: hands.handednesses?.[index]?.[0]?.score ?? null,
      })) : null,
      face: faces.faceLandmarks?.[0] ? {
        landmarks: serializeLandmarks(faces.faceLandmarks[0]),
        blendshapes: Object.fromEntries(
          (faces.faceBlendshapes?.[0]?.categories ?? [])
            .filter((category) => ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthPucker"].includes(category.categoryName))
            .map((category) => [category.categoryName, category.score]),
        ),
      } : null,
    });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap?.close?.();
  }
}

function serializeLandmarks(landmarks) {
  return (landmarks ?? []).map((point) => ({
    x: Number(point.x), y: Number(point.y), z: Number(point.z),
  }));
}
