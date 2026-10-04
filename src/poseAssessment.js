import {
  DrawingUtils,
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import {
  analyzePoseLandmarks,
  summarizeFunctionalAssessment,
} from "./functionalAssessment.js";
import { PoseLandmarkFilter, buildPoseRetargetFrame } from "./poseRetargeting.js";
import { buildCameraMediaConstraints } from "./cameraDevices.js";
import { validateExerciseVideo, validateVideoMetadata } from "./videoEvidence.js";
import { assignHandSides } from "./detailObservations.js";
import { VIDEO_POSE_HZ, videoPoseAt, seekVideoFrame } from "./videoPoseTrack.js";

const DEFAULT_ASSESSMENT_MS = 8_000;

export class PoseAssessmentController {
  constructor({
    video,
    canvas,
    modelUrl,
    objectModelUrl = null,
    handModelUrl = null,
    faceModelUrl = null,
    wasmUrl,
    objectIntervalMs = 700,
    detailIntervalMs = 250,
    poseIdleMs = 16,
    poseInitializationTimeoutMs = 45_000,
    onStatus = () => {},
    onObjectStatus = () => {},
    onDetailStatus = () => {},
    onPose = () => {},
    onDetails = () => {},
    onObjects = () => {},
    onAssessment = () => {},
  }) {
    this.video = video;
    this.canvas = canvas;
    this.modelUrl = modelUrl;
    this.objectModelUrl = objectModelUrl;
    this.handModelUrl = handModelUrl;
    this.faceModelUrl = faceModelUrl;
    this.wasmUrl = wasmUrl;
    this.objectIntervalMs = objectIntervalMs;
    this.detailIntervalMs = detailIntervalMs;
    this.poseIdleMs = poseIdleMs;
    this.poseInitializationTimeoutMs = poseInitializationTimeoutMs;
    this.onStatus = onStatus;
    this.onObjectStatus = onObjectStatus;
    this.onDetailStatus = onDetailStatus;
    this.onPose = onPose;
    this.onDetails = onDetails;
    this.onObjects = onObjects;
    this.onAssessment = onAssessment;
    this.context = canvas.getContext("2d");
    this.drawing = new DrawingUtils(this.context);
    this.poseWorker = null;
    this.poseWorkerReady = false;
    this.poseRuntime = null;
    this.poseWorkerBusy = false;
    this.poseWorkerPromise = null;
    this.poseInitializationTimer = null;
    this.resolvePoseWorker = null;
    this.rejectPoseWorker = null;
    this.objectWorker = null;
    this.objectWorkerReady = false;
    this.objectWorkerBusy = false;
    this.objectDetectionEnabled = true;
    this.objectDetectorFailed = false;
    this.detailWorker = null;
    this.detailWorkerReady = false;
    this.detailWorkerBusy = false;
    this.detailDetectionEnabled = true;
    this.detailDetectorFailed = false;
    this.detailStartupTimer = null;
    this.detailInitializationTimer = null;
    this.lastDetailTimestamp = -Infinity;
    this.lastDetails = null;
    this.lastPoseLandmarks = null;
    this.stream = null;
    this.sourceKind = "none";
    this.videoObjectUrl = null;
    this.videoWindow = null;
    this.videoWindowComplete = false;
    this.videoTrack = null;
    this.videoPreparation = null;
    this.pendingVideoFrame = null;
    this.lastTrackTime = -1;
    this.mediaLoadAbort = null;
    this.frameRequest = null;
    this.lastVideoTime = -1;
    this.assessment = null;
    this.baseline = null;
    this.worldFilter = new PoseLandmarkFilter({ minimumAlpha: 0.55, maximumAlpha: 0.9 });
    this.imageFilter = new PoseLandmarkFilter({
      minimumAlpha: 0.55,
      maximumAlpha: 0.9,
    });
    this.lastInferenceTimestamp = null;
    this.smoothedFps = null;
    this.lastObjectTimestamp = -Infinity;
    this.lastObjectDetections = [];
    this.facingMode = "user";
    this.deviceId = "";
    this.cameraSessionId = 0;
    this.starting = false;
    this.onVideoEnded = () => this.handleVideoEnded();
    this.video.addEventListener?.("ended", this.onVideoEnded);
    this.onVideoTimeUpdate = () => this.enforceVideoWindow();
    this.video.addEventListener?.("timeupdate", this.onVideoTimeUpdate);
    this.video.addEventListener?.("play", this.onVideoTimeUpdate);
    this.onVideoSeeked = () => this.handleVideoSeeked();
    this.video.addEventListener?.("seeked", this.onVideoSeeked);
  }

  get active() {
    return Boolean(this.stream || this.videoObjectUrl);
  }

  prepare() {
    return this.ensurePoseWorker();
  }

  async startCamera({ facingMode = this.facingMode, deviceId = this.deviceId } = {}) {
    if (this.active || this.starting) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not available in this browser.");
    }

    const sessionId = ++this.cameraSessionId;
    this.starting = true;
    this.facingMode = facingMode === "environment" ? "environment" : "user";
    this.deviceId = typeof deviceId === "string" ? deviceId.trim() : "";
    this.onStatus({ key: "requesting", label: "Allow camera access" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia(buildCameraMediaConstraints({
        deviceId: this.deviceId,
        facingMode: this.facingMode,
      }));
      // Permission prompts and worker initialization can outlive a user's cancellation.
      if (sessionId !== this.cameraSessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = stream;
      this.sourceKind = "camera";
      this.video.autoplay = true;
      this.video.srcObject = stream;
      await this.video.play();
      if (sessionId !== this.cameraSessionId) return false;
      this.resizeCanvas();
      this.onStatus({ key: "loading", label: "Camera live - starting pose tracking" });
      await this.ensurePoseWorker();
      if (sessionId !== this.cameraSessionId) return false;
      this.starting = false;
      this.onStatus({ key: "ready", label: "Live, processed locally" });
      if (this.objectDetectionEnabled) this.loadObjectDetector();
      this.scheduleDetailStartup();
      this.scheduleNextFrame(0);
      return true;
    } catch (error) {
      if (sessionId !== this.cameraSessionId) return false;
      this.stopCamera();
      throw error;
    } finally {
      if (sessionId === this.cameraSessionId) this.starting = false;
    }
  }

  async startVideo(file, { precompute = false } = {}) {
    validateExerciseVideo(file);
    if (this.active || this.starting) this.stopCamera();
    const sessionId = ++this.cameraSessionId;
    this.starting = true;
    this.sourceKind = "video";
    this.lastObjectDetections = [];
    this.onObjects(null);
    this.onObjectStatus({ key: "off", label: "Object awareness off for video playback" });
    this.onStatus({ key: "loading", label: "Opening local exercise video" });
    try {
      this.videoObjectUrl = URL.createObjectURL(file);
      const metadata = this.waitForVideoMetadata();
      metadata.catch(() => {});
      this.video.srcObject = null;
      this.video.autoplay = false;
      this.video.src = this.videoObjectUrl;
      this.video.load?.();
      await metadata;
      if (sessionId !== this.cameraSessionId) return false;
      this.videoWindow = validateVideoMetadata(this.video);
      this.videoWindowComplete = false;
      this.resizeCanvas();
      await this.ensurePoseWorker();
      if (sessionId !== this.cameraSessionId) return false;
      if (precompute) await this.prepareVideoTrack(sessionId);
      if (sessionId !== this.cameraSessionId) return false;
      this.video.currentTime = 0;
      await this.video.play();
      if (sessionId !== this.cameraSessionId) return false;
      this.starting = false;
      this.onStatus({ key: "ready", label: "Local video ready" });
      this.scheduleDetailStartup();
      this.beginVideoAssessment();
      this.scheduleNextFrame(0);
      return true;
    } catch (error) {
      if (sessionId !== this.cameraSessionId) return false;
      this.stopCamera();
      throw error;
    } finally {
      if (sessionId === this.cameraSessionId) this.starting = false;
    }
  }

  async waitForVideoMetadata() {
    const abort = new AbortController();
    this.mediaLoadAbort = abort;
    let timer;
    try {
      await new Promise((resolve, reject) => {
        this.video.addEventListener("loadedmetadata", resolve, { once: true, signal: abort.signal });
        this.video.addEventListener("error", () => reject(new Error("This browser cannot decode the selected video.")), { once: true, signal: abort.signal });
        abort.signal.addEventListener("abort", () => reject(new Error("Video loading cancelled.")), { once: true });
        timer = setTimeout(() => reject(new Error("Video metadata did not load. Try a browser-compatible MP4 or WebM file.")), 15_000);
      });
    } finally {
      clearTimeout(timer);
      abort.abort();
      if (this.mediaLoadAbort === abort) this.mediaLoadAbort = null;
    }
  }

  async prepareVideoTrack(sessionId) {
    const abort = new AbortController(); this.videoPreparation = abort;
    const track = []; this.video.pause();
    try {
      const endSeconds = this.videoWindow.endSeconds;
      for (let time = this.videoWindow.startSeconds; time < endSeconds - .02; time += 1 / VIDEO_POSE_HZ) {
        await seekVideoFrame(this.video, time, abort.signal);
        if (sessionId !== this.cameraSessionId) throw new Error("Video preparation cancelled");
        this.onStatus({ key: "preparing-video", label: `Preparing synchronized motion / ${Math.round(time / endSeconds * 100)}%`, progress: time / endSeconds });
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { this.pendingVideoFrame = null; reject(new Error("Video pose analysis timed out")); }, 15000);
          this.pendingVideoFrame = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
          this.detectPose(performance.now());
        });
        track.push({ ...result, mediaTime: time });
      }
      this.videoTrack = track; this.lastTrackTime = -1;
    } finally { if (this.videoPreparation === abort) this.videoPreparation = null; }
  }

  handleVideoEnded() {
    if (this.sourceKind !== "video" || this.videoWindowComplete) return;
    this.videoWindowComplete = true;
    this.video.pause();
    if (this.frameRequest) clearTimeout(this.frameRequest);
    this.frameRequest = null;
    this.lastDetails = null;
    this.onDetails(null);
    this.onDetailStatus({ key: "off", label: "Video ended" });
    if (this.assessment) {
      const seconds = this.assessment.durationMs / 1000;
      this.assessment = null;
      this.onAssessment({ status: "insufficient", reason: `The clip ended before the ${seconds}-second observation completed. Replay or choose a longer clip.`, sourceKind: "video" });
    }
    this.onStatus({ key: "ended", label: this.videoWindow?.autoTrimmed
      ? "2-minute clip complete - replay to reassess" : "Video complete - replay to reassess" });
  }

  enforceVideoWindow() {
    if (this.sourceKind !== "video" || !this.active || this.starting || this.videoPreparation || !this.videoWindow) return false;
    if (this.video.currentTime < this.videoWindow.endSeconds) return false;
    this.video.pause();
    if (this.video.currentTime > this.videoWindow.endSeconds) this.video.currentTime = this.videoWindow.endSeconds;
    this.handleVideoEnded();
    return true;
  }

  beginVideoAssessment() {
    if (this.videoWindow?.assessmentEligible === false) {
      this.assessment = null;
      this.onAssessment({status:"insufficient", sourceKind:"video",
        reason:"Short clip: motion preview only. At least 7 seconds is needed for an assessment."});
      this.onStatus({key:"preview", label:"Short clip - motion preview only"});
      return;
    }
    this.beginAssessment({durationMs: this.videoWindow?.assessmentDurationMs ?? DEFAULT_ASSESSMENT_MS});
  }

  handleVideoSeeked() {
    if (this.sourceKind !== "video" || !this.active || this.starting || this.videoPreparation) return;
    const atEnd = this.enforceVideoWindow() || this.video.ended;
    if (atEnd) this.handleVideoEnded();
    else this.videoWindowComplete = false;
    // The scrub control invalidates an assessment; a programmatic replay seek
    // must preserve the fresh assessment explicitly started by replayVideo().
    this.worldFilter.reset(); this.imageFilter.reset();
    this.lastVideoTime = -1; this.lastTrackTime = -1;
    this.onPose(null);
    if (this.frameRequest) clearTimeout(this.frameRequest);
    this.frameRequest = null;
    this.scheduleNextFrame(0);
  }

  async replayVideo() {
    if (this.sourceKind !== "video" || !this.videoObjectUrl) throw new Error("Choose an exercise video first.");
    this.assessment = null;
    this.worldFilter.reset();
    this.imageFilter.reset();
    this.lastInferenceTimestamp = null;
    this.smoothedFps = null;
    this.lastVideoTime = -1;
    this.lastTrackTime = -1;
    this.lastDetailTimestamp = -Infinity;
    this.lastDetails = null;
    this.onDetails(null);
    this.videoWindowComplete = false;
    this.video.currentTime = 0;
    await this.video.play();
    this.scheduleDetailStartup();
    this.beginVideoAssessment();
    this.scheduleNextFrame(0);
  }

  stopCamera() {
    this.videoPreparation?.abort(); this.videoPreparation = null;
    this.pendingVideoFrame?.reject(new Error("Video preparation cancelled")); this.pendingVideoFrame = null;
    this.videoTrack = null; this.lastTrackTime = -1;
    this.videoWindow = null; this.videoWindowComplete = false;
    this.cameraSessionId += 1;
    this.starting = false;
    if (this.poseWorkerPromise && !this.poseWorkerReady) {
      this.failPoseWorker(new Error("Camera startup cancelled."), { notify: false });
    }
    if (this.frameRequest) clearTimeout(this.frameRequest);
    this.frameRequest = null;
    clearTimeout(this.detailStartupTimer);
    this.detailStartupTimer = null;
    this.mediaLoadAbort?.abort();
    this.mediaLoadAbort = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute?.("src");
    this.video.load?.();
    if (this.videoObjectUrl) URL.revokeObjectURL(this.videoObjectUrl);
    this.videoObjectUrl = null;
    this.sourceKind = "none";
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.assessment = null;
    this.worldFilter.reset();
    this.imageFilter.reset();
    this.lastInferenceTimestamp = null;
    this.smoothedFps = null;
    this.lastVideoTime = -1;
    this.lastObjectTimestamp = -Infinity;
    this.lastObjectDetections = [];
    this.lastDetailTimestamp = -Infinity;
    this.lastDetails = null;
    this.lastPoseLandmarks = null;
    this.onPose(null);
    this.onDetails(null);
    this.onObjects(null);
    this.onObjectStatus({ key: "off", label: "Object awareness off" });
    this.onDetailStatus({ key: "off", label: "Face and hands off" });
    this.onStatus({ key: "off", label: "Camera off" });
  }

  async switchCamera(facingMode) {
    return this.switchVideoInput({ facingMode, deviceId: "" });
  }

  async switchVideoInput({ facingMode = this.facingMode, deviceId = "" } = {}) {
    const nextFacing = facingMode === "environment" ? "environment" : "user";
    const nextDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";
    if (this.active && nextFacing === this.facingMode && nextDeviceId === this.deviceId) return;
    const wasActive = this.active || this.starting;
    if (wasActive) this.stopCamera();
    this.facingMode = nextFacing;
    this.deviceId = nextDeviceId;
    if (wasActive) {
      await this.startCamera({
        facingMode: nextFacing,
        deviceId: nextDeviceId,
      });
    }
  }

  getActiveCameraDeviceId() {
    return this.stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId || this.deviceId || "";
  }

  setObjectDetectionEnabled(enabled) {
    this.objectDetectionEnabled = Boolean(enabled);
    if (!this.objectDetectionEnabled) {
      this.lastObjectDetections = [];
      this.onObjects(null);
      this.onObjectStatus({ key: "off", label: "Object awareness off" });
      return;
    }
    this.objectDetectorFailed = false;
    if (this.active && this.sourceKind === "camera" && this.poseWorkerReady) {
      if (this.objectWorkerReady) {
        this.onObjectStatus({ key: "ready", label: "Object awareness ready" });
      } else {
        this.loadObjectDetector();
      }
    }
  }

  setDetailDetectionEnabled(enabled) {
    this.detailDetectionEnabled = Boolean(enabled);
    if (!this.detailDetectionEnabled) {
      clearTimeout(this.detailStartupTimer);
      this.detailStartupTimer = null;
      this.lastDetails = null;
      this.onDetails(null);
      this.onDetailStatus({ key: "off", label: "Face and hands off" });
      this.drawLandmarks(this.lastPoseLandmarks, this.lastObjectDetections);
      return;
    }
    this.detailDetectorFailed = false;
    if (this.active) this.scheduleDetailStartup();
  }

  scheduleDetailStartup() {
    if (!this.active || !this.detailDetectionEnabled || this.detailStartupTimer) return;
    this.detailStartupTimer = setTimeout(() => {
      this.detailStartupTimer = null;
      if (this.active && this.detailDetectionEnabled) this.loadDetailDetector();
    }, 1_200);
  }

  loadDetailDetector() {
    if (!this.active || !this.detailDetectionEnabled || this.detailDetectorFailed) return;
    if (this.detailWorker) {
      this.onDetailStatus({
        key: this.detailWorkerReady ? "ready" : "loading",
        label: this.detailWorkerReady ? "Face and hands ready" : "Loading face and hands",
      });
      return;
    }
    if (!this.handModelUrl || !this.faceModelUrl || !globalThis.Worker || !globalThis.createImageBitmap) {
      this.failDetailWorker(new Error("Detailed landmark tracking is unavailable in this browser."));
      return;
    }
    this.onDetailStatus({ key: "loading", label: "Loading face and hands" });
    const worker = new Worker(new URL("./detailDetection.worker.js", import.meta.url), { type: "module" });
    this.detailWorker = worker;
    this.detailInitializationTimer = setTimeout(() => {
      if (this.detailWorker === worker && !this.detailWorkerReady) {
        this.failDetailWorker(new Error("Hand and face tracking timed out. Toggle tracking to retry."));
      }
    }, 60_000);
    worker.addEventListener("message", (event) => {
      if (this.detailWorker === worker) this.handleDetailWorkerMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      if (this.detailWorker === worker) this.failDetailWorker(new Error(event.message || "Detailed landmark worker failed."));
    });
    worker.postMessage({
      type: "initialize",
      handModelUrl: new URL(this.handModelUrl, globalThis.location.href).href,
      faceModelUrl: new URL(this.faceModelUrl, globalThis.location.href).href,
      wasmUrl: new URL(this.wasmUrl, globalThis.location.href).href,
    });
  }

  handleDetailWorkerMessage(message) {
    if (message?.type === "progress") {
      if (this.active && this.detailDetectionEnabled) this.onDetailStatus({ key: "loading", label: message.label });
    } else if (message?.type === "ready") {
      clearTimeout(this.detailInitializationTimer);
      this.detailInitializationTimer = null;
      this.detailWorkerReady = true;
      this.onDetailStatus({
        key: this.active && this.detailDetectionEnabled ? "ready" : "off",
        label: this.active && this.detailDetectionEnabled ? "Face and hands ready" : "Face and hands off",
      });
    } else if (message?.type === "result") {
      this.detailWorkerBusy = false;
      if (!this.active || this.video.ended || !this.detailDetectionEnabled || message.cameraSessionId !== this.cameraSessionId) return;
      const age = performance.now() - message.timestamp;
      if (!Number.isFinite(age) || age < -50 || age >= 900) {
        this.lastDetails = null;
        this.onDetails(null);
        this.onDetailStatus({ key: "waiting", label: "Detailed tracking delayed" });
        return;
      }
      this.onDetailStatus({ key: "ready", label: "Face and hands ready" });
      this.lastDetails = {
        hands: assignHandSides(message.hands ?? [], this.lastPoseLandmarks),
        face: message.face ?? null,
        timestamp: message.timestamp,
        inferenceMs: message.inferenceMs,
      };
      this.onDetails(this.lastDetails);
      this.drawLandmarks(this.lastPoseLandmarks, this.lastObjectDetections);
    } else if (message?.type === "error") {
      this.failDetailWorker(new Error(message.error || "Detailed landmark inference failed."));
    }
  }

  failDetailWorker(error) {
    clearTimeout(this.detailInitializationTimer);
    this.detailInitializationTimer = null;
    this.detailDetectorFailed = true;
    this.detailWorker?.terminate();
    this.detailWorker = null;
    this.detailWorkerReady = false;
    this.detailWorkerBusy = false;
    this.lastDetails = null;
    this.onDetails(null);
    this.onDetailStatus({ key: "error", label: "Face and hands unavailable", error });
  }

  beginAssessment({ asBaseline = false, durationMs = DEFAULT_ASSESSMENT_MS } = {}) {
    if (!this.active || !this.poseWorkerReady) {
      throw new Error("Wait for live pose tracking before recording movement.");
    }
    if (this.sourceKind === "video" && (this.video.ended || (this.videoWindow?.endSeconds ?? this.video.duration) - this.video.currentTime < durationMs / 1_000 + 0.2)) {
      throw new Error("Replay the clip to allow the complete observation window.");
    }
    this.assessment = {
      asBaseline,
      durationMs,
      startedAt: performance.now(),
      mediaStartedAt: this.video.currentTime * 1000,
      startedAtIso: new Date().toISOString(),
      samples: [],
      telemetry: [],
    };
    this.onStatus({
      key: "recording",
      label: asBaseline ? "Recording baseline" : this.sourceKind === "video" ? `Recording assessment / ${durationMs / 1000} s` : "Recording assessment",
      progress: 0,
    });
  }

  ensurePoseWorker() {
    if (this.poseWorkerReady) return Promise.resolve();
    if (this.poseWorkerPromise) return this.poseWorkerPromise;
    if (!globalThis.Worker || !globalThis.createImageBitmap) {
      return Promise.reject(
        new Error("This browser cannot run background pose inference."),
      );
    }

    const worker = new Worker(
      new URL("./poseDetection.worker.js", import.meta.url),
      { type: "module" },
    );
    this.poseWorkerPromise = new Promise((resolve, reject) => {
      this.resolvePoseWorker = resolve;
      this.rejectPoseWorker = reject;
    });
    const initialization = this.poseWorkerPromise;
    this.poseWorker = worker;
    this.poseInitializationTimer = setTimeout(() => {
      if (this.poseWorker === worker && !this.poseWorkerReady) {
        this.failPoseWorker(new Error(
          "Pose model initialization timed out. Close unused tabs and retry camera tracking.",
        ));
      }
    }, this.poseInitializationTimeoutMs);
    worker.addEventListener("message", (event) => {
      if (this.poseWorker === worker) this.handlePoseWorkerMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      if (this.poseWorker === worker) {
        this.failPoseWorker(new Error(event.message || "Pose worker failed."));
      }
    });
    try {
      worker.postMessage({
        type: "initialize",
        modelUrl: new URL(this.modelUrl, globalThis.location.href).href,
        wasmUrl: new URL(this.wasmUrl, globalThis.location.href).href,
      });
    } catch (error) {
      this.failPoseWorker(error);
    }
    return initialization;
  }

  handlePoseWorkerMessage(message) {
    if (message?.type === "progress" && this.starting) {
      this.onStatus({ key: "loading", label: `${this.sourceKind === "video" ? "Video" : "Camera live"} - ${message.label}` });
      return;
    }
    if (message?.type === "ready") {
      clearTimeout(this.poseInitializationTimer);
      this.poseInitializationTimer = null;
      this.poseWorkerReady = true;
      this.poseRuntime = message.runtime ?? null;
      this.resolvePoseWorker?.();
      this.resolvePoseWorker = null;
      this.rejectPoseWorker = null;
      return;
    }
    if (message?.type === "backend") {
      this.poseRuntime = message.runtime ?? null;
      return;
    }
    if (message?.type === "result") {
      this.poseWorkerBusy = false;
      if (!this.active || message.cameraSessionId !== this.cameraSessionId) {
        return;
      }
      if (this.pendingVideoFrame) {
        const pending = this.pendingVideoFrame; this.pendingVideoFrame = null; pending.resolve(message); return;
      }
      this.handlePoseResult(message);
      return;
    }
    if (message?.type === "error") {
      this.pendingVideoFrame?.reject(new Error(message.error || "Video analysis failed")); this.pendingVideoFrame = null;
      this.failPoseWorker(new Error(message.error || "Pose worker failed."));
    }
  }

  handlePoseResult(message) {
    const landmarks = message.landmarks?.[0] ?? null;
    this.lastPoseLandmarks = landmarks;
    const worldLandmarks = message.worldLandmarks?.[0] ?? landmarks;
    const filteredWorld = message.cached ? structuredClone(worldLandmarks) : this.worldFilter.update(worldLandmarks);
    const filteredImage = message.cached ? structuredClone(landmarks) : this.imageFilter.update(landmarks);
    // Offscreen joints are model extrapolations, even if world confidence is high.
    for (let index = 0; index < (landmarks?.length ?? 0); index++) {
      const point = landmarks[index];
      const quality = !point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
        ? 0 : Math.min(point.visibility ?? 1, point.presence ?? 1);
      if (filteredWorld?.[index]) filteredWorld[index].visibility = Math.min(filteredWorld[index].visibility, quality);
      if (filteredImage?.[index]) filteredImage[index].visibility = Math.min(filteredImage[index].visibility, quality);
    }
    const frameRate = this.updateFrameRate(message.timestamp);
    const metadata = {
      frameRate,
      inferenceMs: message.inferenceMs,
      poseDelegate: message.runtime?.delegate ?? this.poseRuntime?.delegate ?? "unknown",
      timestamp: message.timestamp,
      pipelineLatencyMs: Math.max(0, performance.now() - message.timestamp),
      mediaTime: message.mediaTime,
      cached: Boolean(message.cached),
      detected: Boolean(worldLandmarks),
    };
    let frame = filteredWorld
      ? analyzePoseLandmarks(filteredWorld, filteredImage ?? filteredWorld, metadata)
      : null;
    // Visible arms can animate the rig without qualifying as a full-body assessment.
    if (!frame && filteredWorld) {
      const visual = buildPoseRetargetFrame(filteredWorld, filteredImage ?? filteredWorld);
      if (visual) frame = { ...visual, ...metadata, usable: false, visibility: 0 };
    }
    if (frame && !worldLandmarks) frame.usable = false;
    const telemetry = {
      detected: Boolean(worldLandmarks),
      usable: Boolean(frame?.usable),
      rigCoverage: frame?.rigCoverage ?? 0,
      frameRate,
      inferenceMs: message.inferenceMs,
    };
    this.drawLandmarks(landmarks, this.lastObjectDetections);
    telemetry.mediaTime = message.mediaTime;
    this.onPose(frame);
    this.collectAssessmentSample(frame, message.timestamp, telemetry);
  }

  failPoseWorker(error, { notify = true } = {}) {
    const reject = this.rejectPoseWorker;
    clearTimeout(this.poseInitializationTimer);
    this.poseInitializationTimer = null;
    this.poseWorker?.terminate();
    this.poseWorker = null;
    this.poseWorkerReady = false;
    this.poseWorkerBusy = false;
    this.poseWorkerPromise = null;
    this.resolvePoseWorker = null;
    this.rejectPoseWorker = null;
    this.onPose(null);
    if (notify) this.onStatus({ key: "error", label: "Pose model unavailable", error });
    reject?.(error);
  }

  loadObjectDetector() {
    if (!this.objectDetectionEnabled || this.sourceKind !== "camera") {
      return;
    }
    if (this.objectWorker) {
      this.onObjectStatus({
        key: this.objectWorkerReady ? "ready" : "loading",
        label: this.objectWorkerReady
          ? "Object awareness ready"
          : "Loading object model",
      });
      return;
    }
    if (this.objectDetectorFailed) {
      return;
    }
    if (!this.objectModelUrl) {
      this.failObjectWorker(new Error("Object detector model is not configured."));
      return;
    }
    if (!globalThis.Worker || !globalThis.createImageBitmap) {
      this.failObjectWorker(
        new Error("This browser cannot run background camera inference."),
      );
      return;
    }

    this.onObjectStatus({ key: "loading", label: "Loading object model" });
    const worker = new Worker(
      new URL("./objectDetection.worker.js", import.meta.url),
      { type: "module" },
    );
    this.objectWorker = worker;
    worker.addEventListener("message", (event) => {
      this.handleObjectWorkerMessage(event.data);
    });
    worker.addEventListener("error", (event) => {
      this.failObjectWorker(new Error(event.message || "Object worker failed."));
    });
    worker.postMessage({
      type: "initialize",
      modelUrl: new URL(this.objectModelUrl, globalThis.location.href).href,
      wasmUrl: new URL(this.wasmUrl, globalThis.location.href).href,
    });
  }

  handleObjectWorkerMessage(message) {
    if (message?.type === "ready") {
      this.objectWorkerReady = true;
      this.objectDetectorFailed = false;
      this.onObjectStatus({
        key: this.objectDetectionEnabled ? "ready" : "off",
        label: this.objectDetectionEnabled
          ? "Object awareness ready"
          : "Object awareness off",
      });
      return;
    }
    if (message?.type === "result") {
      this.objectWorkerBusy = false;
      if (
        !this.active
        || !this.objectDetectionEnabled
        || message.cameraSessionId !== this.cameraSessionId
      ) {
        return;
      }
      this.lastObjectDetections = message.detections ?? [];
      this.onObjects({
        detections: this.lastObjectDetections,
        frameWidth: message.frameWidth,
        frameHeight: message.frameHeight,
        inferenceMs: message.inferenceMs,
        timestamp: message.timestamp,
      });
      return;
    }
    if (message?.type === "error") {
      this.failObjectWorker(new Error(message.error || "Object worker failed."));
    }
  }

  failObjectWorker(error) {
    this.objectDetectorFailed = true;
    this.objectWorkerReady = false;
    this.objectWorkerBusy = false;
    this.lastObjectDetections = [];
    this.objectWorker?.terminate();
    this.objectWorker = null;
    this.onObjects(null);
    this.onObjectStatus({
      key: "error",
      label: "Object model unavailable",
      error,
    });
  }

  processFrame(timestamp) {
    if (!this.active) return;
    const atEnd = this.sourceKind === "video"
      && (this.enforceVideoWindow() || this.video.ended || this.videoWindowComplete);
    this.resizeCanvas();

    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      if (this.videoTrack) {
        const sample = videoPoseAt(this.videoTrack, this.video.currentTime);
        if (sample && sample.mediaTime !== this.lastTrackTime) {
          if (sample.mediaTime < this.lastTrackTime) { this.worldFilter.reset(); this.imageFilter.reset(); this.assessment = null; this.onPose(null); }
          this.lastTrackTime = sample.mediaTime;
          this.handlePoseResult({ ...sample, timestamp, cached: true, inferenceMs: 0 });
        }
        if (!atEnd) this.scheduleNextFrame(this.poseIdleMs);
        return;
      }
      this.detectPose(timestamp);
      if (!atEnd) {
        this.detectObjects(timestamp);
        this.detectDetails(timestamp);
      }
    }

    if (!atEnd) this.scheduleNextFrame(this.poseIdleMs);
  }

  scheduleNextFrame(delayMs) {
    if (!this.active) return;
    this.frameRequest = setTimeout(() => {
      this.frameRequest = null;
      this.processFrame(performance.now());
    }, delayMs);
  }

  detectPose(timestamp) {
    if (!this.poseWorkerReady || !this.poseWorker || this.poseWorkerBusy) return;
    this.poseWorkerBusy = true;
    const cameraSessionId = this.cameraSessionId;
    const mediaTime = this.video.currentTime;
    const scale = Math.min(1, 640 / Math.max(this.video.videoWidth || 640, this.video.videoHeight || 480));
    const width = Math.max(1, Math.round((this.video.videoWidth || 640) * scale));
    const height = Math.max(1, Math.round((this.video.videoHeight || 480) * scale));
    // Paused/seeked video surfaces are not ImageBitmap-compatible on every browser.
    // Snapshot them through a canvas while retaining the exact source timestamp.
    let bitmapPromise;
    try {
      if (this.sourceKind === "video") {
        this.videoFrameCanvas ??= document.createElement("canvas");
        this.videoFrameCanvas.width = width; this.videoFrameCanvas.height = height;
        this.videoFrameCanvas.getContext("2d").drawImage(this.video, 0, 0, width, height);
        bitmapPromise = createImageBitmap(this.videoFrameCanvas);
      } else bitmapPromise = createImageBitmap(this.video, { resizeWidth: width, resizeHeight: height });
    } catch (error) { bitmapPromise = Promise.reject(error); }
    void bitmapPromise
      .then((bitmap) => {
        if (
          !this.active
          || !this.poseWorker
          || cameraSessionId !== this.cameraSessionId
        ) {
          bitmap.close();
          this.poseWorkerBusy = false;
          return;
        }
        this.poseWorker.postMessage(
          {
            type: "frame",
            bitmap,
            timestamp,
            mediaTime,
            cameraSessionId,
          },
          [bitmap],
        );
      })
      .catch((error) => {
        this.poseWorkerBusy = false;
        this.pendingVideoFrame?.reject(error); this.pendingVideoFrame = null;
        if (this.active && cameraSessionId === this.cameraSessionId) {
          this.failPoseWorker(error);
        }
      });
  }

  detectDetails(timestamp) {
    if (!this.detailDetectionEnabled || !this.detailWorkerReady || !this.detailWorker
      || this.detailWorkerBusy || timestamp - this.lastDetailTimestamp < this.detailIntervalMs) return;
    this.lastDetailTimestamp = timestamp;
    this.detailWorkerBusy = true;
    const cameraSessionId = this.cameraSessionId;
    void createImageBitmap(this.video)
      .then((bitmap) => {
        if (!this.active || !this.detailDetectionEnabled || !this.detailWorker
          || cameraSessionId !== this.cameraSessionId) {
          bitmap.close();
          this.detailWorkerBusy = false;
          return;
        }
        this.detailWorker.postMessage({ type: "frame", bitmap, timestamp, cameraSessionId }, [bitmap]);
      })
      .catch((error) => {
        this.detailWorkerBusy = false;
        if (this.active && cameraSessionId === this.cameraSessionId) this.failDetailWorker(error);
      });
  }

  detectObjects(timestamp) {
    if (
      this.sourceKind !== "camera"
      ||
      !this.objectDetectionEnabled
      || !this.objectWorkerReady
      || !this.objectWorker
      || this.objectWorkerBusy
      || timestamp - this.lastObjectTimestamp < this.objectIntervalMs
    ) {
      return;
    }
    this.lastObjectTimestamp = timestamp;
    this.objectWorkerBusy = true;
    const cameraSessionId = this.cameraSessionId;
    const frameWidth = this.video.videoWidth || this.canvas.width;
    const frameHeight = this.video.videoHeight || this.canvas.height;
    void createImageBitmap(this.video)
      .then((bitmap) => {
        if (
          !this.active
          || !this.objectDetectionEnabled
          || !this.objectWorker
          || cameraSessionId !== this.cameraSessionId
        ) {
          bitmap.close();
          this.objectWorkerBusy = false;
          return;
        }
        this.objectWorker.postMessage(
          {
            type: "frame",
            bitmap,
            timestamp,
            frameWidth,
            frameHeight,
            cameraSessionId,
          },
          [bitmap],
        );
      })
      .catch((error) => {
        this.failObjectWorker(error);
      });
  }

  updateFrameRate(timestamp) {
    if (this.lastInferenceTimestamp !== null) {
      const elapsed = Math.max(timestamp - this.lastInferenceTimestamp, 1);
      const instantaneousFps = 1_000 / elapsed;
      this.smoothedFps = this.smoothedFps === null
        ? instantaneousFps
        : this.smoothedFps * 0.82 + instantaneousFps * 0.18;
    }
    this.lastInferenceTimestamp = timestamp;
    return this.smoothedFps;
  }

  collectAssessmentSample(frame, timestamp, telemetry) {
    if (!this.assessment) return;
    const mediaTime = telemetry?.mediaTime ?? frame?.mediaTime;
    const elapsed = this.sourceKind === "video" && Number.isFinite(mediaTime)
      ? mediaTime * 1000 - this.assessment.mediaStartedAt : timestamp - this.assessment.startedAt;
    this.assessment.telemetry.push(telemetry);
    if (frame?.usable) this.assessment.samples.push(frame);
    const progress = Math.min(1, elapsed / this.assessment.durationMs);
    this.onStatus({
      key: "recording",
      label: this.assessment.asBaseline ? "Recording baseline" : this.sourceKind === "video" ? `Recording assessment / ${this.assessment.durationMs / 1000} s` : "Recording assessment",
      progress,
    });
    if (progress < 1) return;

    const result = summarizeFunctionalAssessment(
      this.assessment.samples,
      this.assessment.asBaseline || this.sourceKind === "video" ? null : this.baseline,
      {
        durationMs: this.assessment.durationMs,
        telemetry: this.assessment.telemetry,
      },
    );
    if (this.assessment.asBaseline && result.status === "complete") {
      this.baseline = result;
    }
    const completed = {
      ...result,
      sourceKind: this.sourceKind,
      ...(this.sourceKind === "video" ? {videoSegment: {
        ...this.videoWindow,
        observationStartSeconds: this.assessment.mediaStartedAt / 1000,
        observationDurationSeconds: this.assessment.durationMs / 1000,
      }} : {}),
      asBaseline: this.assessment.asBaseline,
      startedAt: this.assessment.startedAtIso,
      completedAt: new Date().toISOString(),
    };
    this.assessment = null;
    this.onAssessment(completed);
    this.onStatus({
      key: result.status === "complete" ? "complete" : "insufficient",
      label: result.status === "complete" ? "Assessment complete" : "Repeat movement",
    });
  }

  resizeCanvas() {
    const width = this.video.videoWidth || 960;
    const height = this.video.videoHeight || 720;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  drawLandmarks(landmarks, detections = []) {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawObjectBoxes(detections);
    if (landmarks) {
      this.drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: "#56e0c3", lineWidth: 3,
      });
      this.drawing.drawLandmarks(landmarks, {
        color: "#ffffff", fillColor: "#0b6f64", lineWidth: 1, radius: 3,
      });
    }
    const details = this.detailDetectionEnabled && this.lastDetails
      && performance.now() - this.lastDetails.timestamp < 900 ? this.lastDetails : null;
    for (const hand of details?.hands ?? []) {
      this.drawing.drawConnectors(hand.landmarks, HandLandmarker.HAND_CONNECTIONS, {
        color: hand.side === "left" ? "#ffca65" : "#86a5ff", lineWidth: 2,
      });
      this.drawing.drawLandmarks([4, 8, 12, 16, 20].map((index) => hand.landmarks[index]).filter(Boolean), {
        color: "#ffffff", fillColor: "#dc8355", radius: 3,
      });
    }
    if (details?.face?.landmarks) {
      const face = details.face.landmarks;
      this.drawing.drawConnectors(face, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
        color: "rgba(116, 212, 204, 0.22)", lineWidth: 0.5,
      });
      for (const contour of [
        FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
        FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
        FaceLandmarker.FACE_LANDMARKS_LIPS,
      ]) {
        this.drawing.drawConnectors(face, contour, { color: "#efae9d", lineWidth: 1.5 });
      }
    }
  }

  drawObjectBoxes(detections) {
    this.context.save();
    this.context.strokeStyle = "#f2b84b";
    this.context.lineWidth = Math.max(2, this.canvas.width / 420);
    (detections ?? []).forEach((detection) => {
      const box = detection?.boundingBox;
      if (!box) return;
      this.context.strokeRect(box.originX, box.originY, box.width, box.height);
    });
    this.context.restore();
  }

  dispose() {
    this.video.removeEventListener?.("ended", this.onVideoEnded);
    this.video.removeEventListener?.("timeupdate", this.onVideoTimeUpdate);
    this.video.removeEventListener?.("play", this.onVideoTimeUpdate);
    this.video.removeEventListener?.("seeked", this.onVideoSeeked);
    this.stopCamera();
    clearTimeout(this.detailInitializationTimer);
    this.detailInitializationTimer = null;
    clearTimeout(this.poseInitializationTimer);
    this.poseInitializationTimer = null;
    this.poseWorker?.terminate();
    this.objectWorker?.terminate();
    this.detailWorker?.terminate();
    this.poseWorker = null;
    this.poseWorkerReady = false;
    this.poseWorkerBusy = false;
    this.poseWorkerPromise = null;
    this.objectWorker = null;
    this.objectWorkerReady = false;
    this.objectWorkerBusy = false;
    this.detailWorker = null;
    this.detailWorkerReady = false;
    this.detailWorkerBusy = false;
  }
}
