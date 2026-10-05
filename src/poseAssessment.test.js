import test from "node:test";
import assert from "node:assert/strict";
import { PoseAssessmentController } from "./poseAssessment.js";
import { PoseTrack } from "./videoPoseTrack.js";
import { bodyPose } from "../scripts/fixtures/bodyPose.mjs";

function cameraFixture(t, { media, play } = {}) {
  class Context { clearRect() {} }
  const replacements = [
    [globalThis, "CanvasRenderingContext2D", Context],
    [globalThis, "OffscreenCanvasRenderingContext2D", Context],
  ];
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  replacements.push([navigator, "mediaDevices", { getUserMedia: media || (async () => stream) }]);
  for (const [owner, key, value] of replacements) {
    const original = Object.getOwnPropertyDescriptor(owner, key);
    Object.defineProperty(owner, key, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(owner, key, original) : delete owner[key]);
  }
  const video = { srcObject: null, play: play || (async () => {}), pause() {} };
  const statuses = [];
  const controller = new PoseAssessmentController({
    video, canvas: { getContext: () => new Context() },
    modelUrl: "pose.task", wasmUrl: "mediapipe", onStatus: (status) => statuses.push(status),
  });
  controller.setObjectDetectionEnabled(false);
  controller.scheduleNextFrame = () => {};
  t.after(() => controller.dispose());
  return { controller, video, stream, track, statuses };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("look-ahead pose results fill the video track without posing the live avatar", t => {
  const { controller, stream } = cameraFixture(t); controller.stream = stream;
  controller.videoTrack = new PoseTrack(); controller.poseWorkerBusy = true;
  let emitted = false;
  controller.onPose = () => emitted = true;
  const pose = [bodyPose()];
  controller.handlePoseWorkerMessage({ type: "result", analysis: true, cameraSessionId: controller.cameraSessionId, mediaTime: 2, landmarks: pose, worldLandmarks: pose, inferenceMs: 18 });
  assert.equal(controller.videoTrack.size, 1); assert.equal(controller.videoTrack.samples[0].mediaTime, 2);
  assert.equal(emitted, false); assert.equal(controller.poseWorkerBusy, false);
  assert.equal(controller.analysisInferenceMs, 18);
  controller.detailTrack = new PoseTrack();
  controller.handleDetailWorkerMessage({ type: "result", analysis: true, cameraSessionId: controller.cameraSessionId, mediaTime: 2, face: { landmarks: [] }, hands: [] });
  assert.equal(controller.detailTrack.size, 1, "face results from the look-ahead go to the detail track");
});

test("video assessment duration follows media time even during a slow or occluded frame", t => {
  const { controller } = cameraFixture(t); controller.sourceKind = "video";
  controller.assessment = { startedAt: 0, mediaStartedAt: 1000, durationMs: 8000, telemetry: [], samples: [] };
  controller.collectAssessmentSample(null, 90000, { mediaTime: 2 });
  assert.ok(controller.assessment, "one second of source video is not ninety seconds of movement");
});

test("seeking after video end restarts pose updates without restarting an assessment", t => {
  const {controller} = cameraFixture(t);
  controller.sourceKind = "video"; controller.videoObjectUrl = "blob:fixture";
  controller.lastVideoTime = 13;
  controller.assessment = null;
  let scheduled = false, cleared = false;
  controller.scheduleNextFrame = () => {scheduled = true;};
  controller.onPose = value => {cleared = value === null;};
  controller.handleVideoSeeked();
  assert.equal(scheduled, true); assert.equal(cleared, true);
  assert.equal(controller.lastVideoTime, -1);
  assert.equal(controller.assessment, null);
  const replayAssessment = {samples:[]}; controller.assessment = replayAssessment;
  controller.handleVideoSeeked();
  assert.equal(controller.assessment, replayAssessment, "programmatic replay seek preserves the new assessment");
  scheduled = false; controller.starting = true;
  controller.handleVideoSeeked();
  assert.equal(scheduled, false, "preparation seeks must not start playback inference");
});

test("a pose read from the synchronized track is published as synced, with its frame's media time", (t) => {
  const { controller } = cameraFixture(t);
  let frame;
  controller.drawLandmarks = () => {};
  controller.onPose = (result) => { frame = result; };
  controller.handlePoseResult({ landmarks: [bodyPose()], worldLandmarks: [bodyPose()], timestamp: 1000, mediaTime: 4.2, cached: true, synced: true, inferenceMs: 20 });
  assert.equal(frame.synced, true); assert.equal(frame.mediaTime, 4.2); assert.equal(frame.cached, true);
  controller.handlePoseResult({ landmarks: [bodyPose()], worldLandmarks: [bodyPose()], timestamp: 1100, inferenceMs: 20 });
  assert.equal(frame.synced, false, "live inference is not synchronized");
});

test("image visibility prevents inferred offscreen legs from driving the human rig", (t) => {
  const { controller } = cameraFixture(t);
  const image = bodyPose();
  const world = bodyPose();
  image[25].y = 1.3;
  image[26].visibility = 0.1;
  let frame;
  controller.drawLandmarks = () => {};
  controller.onPose = (result) => { frame = result; };
  controller.handlePoseResult({ landmarks: [image], worldLandmarks: [world], timestamp: 1000, inferenceMs: 10 });
  assert.equal(frame.segments.leftUpLeg.usable, false);
  assert.equal(frame.segments.rightUpLeg.usable, false);
  assert.equal(frame.segments.leftArm.usable, true);
  assert.equal(frame.usable, false);
});

test("seeking to the terminal video frame renders once without restarting an assessment", t => {
  const {controller,video,statuses} = cameraFixture(t);
  const original=Object.getOwnPropertyDescriptor(globalThis,"HTMLMediaElement");
  Object.defineProperty(globalThis,"HTMLMediaElement",{configurable:true,value:{HAVE_CURRENT_DATA:2}});
  t.after(() => original ? Object.defineProperty(globalThis,"HTMLMediaElement",original) : delete globalThis.HTMLMediaElement);
  controller.sourceKind="video"; controller.videoObjectUrl="blob:fixture";
  controller.videoWindow={endSeconds:7.32,autoTrimmed:false};
  controller.videoWindowComplete=true;
  Object.assign(video,{currentTime:7.32,ended:true,paused:true,readyState:2});
  const pose=[bodyPose()];
  controller.videoTrack=new PoseTrack(); controller.detailTrack=new PoseTrack();
  controller.videoTrack.add({mediaTime:7.25,landmarks:pose,worldLandmarks:pose});
  controller.lastVideoTime=7.32;
  let scheduled=0,emitted=null;
  controller.scheduleNextFrame=() => scheduled++;
  controller.resizeCanvas=() => {};
  controller.handlePoseResult=message => emitted=message;
  controller.handleVideoSeeked();
  assert.equal(scheduled,1,"seek schedules the final still even when media is ended");
  controller.processFrame(1000);
  assert.equal(emitted,null,"synchronized video is posed by its presented frames, not by polling");
  controller.presentVideoFrame(7.32);
  assert.equal(emitted.mediaTime,7.32,"the pose is reported at the presented frame's time");
  assert.equal(emitted.cached,true); assert.equal(emitted.synced,true);
  assert.equal(scheduled,1,"terminal still does not restart a polling loop");
  assert.equal(controller.assessment,null);
  assert.equal(controller.videoWindowComplete,true);
  assert.equal(statuses.some(status => status.key === "recording"),false);
});

test("delayed face results cannot create a current eye observation", (t) => {
  const { controller, stream } = cameraFixture(t);
  controller.stream = stream;
  let observation = "unchanged";
  let status;
  controller.onDetails = (value) => { observation = value; };
  controller.onDetailStatus = (value) => { status = value; };
  controller.handleDetailWorkerMessage({ type: "result", cameraSessionId: controller.cameraSessionId,
    timestamp: performance.now() - 1500, face: { blendshapes: { eyeBlinkLeft: 1, eyeBlinkRight: 1 } } });
  assert.equal(observation, null);
  assert.equal(status.key, "waiting");
});

test("camera preview appears before pose initialization finishes", async (t) => {
  const model = deferred();
  const preview = deferred();
  const fixture = cameraFixture(t, { play: async () => preview.resolve() });
  fixture.controller.ensurePoseWorker = () => model.promise;
  const startup = fixture.controller.startCamera();
  await preview.promise;
  assert.equal(fixture.video.srcObject, fixture.stream);
  assert.equal(fixture.controller.starting, true);
  assert.throws(() => fixture.controller.beginAssessment(), /Wait for live pose/);
  model.resolve();
  assert.equal(await startup, true);
  assert.equal(fixture.controller.starting, false);
});

test("cancelling a pending permission request closes any late stream", async (t) => {
  const permission = deferred();
  const fixture = cameraFixture(t, { media: () => permission.promise });
  fixture.controller.ensurePoseWorker = async () => {};
  const startup = fixture.controller.startCamera();
  fixture.controller.stopCamera();
  permission.resolve(fixture.stream);
  assert.equal(await startup, false);
  assert.equal(fixture.track.stopped, true);
  assert.equal(fixture.video.srcObject, null);
  assert.equal(fixture.controller.active, false);
});

test("playback failure releases camera resources", async (t) => {
  const fixture = cameraFixture(t, { play: async () => { throw new Error("play failed"); } });
  await assert.rejects(fixture.controller.startCamera(), /play failed/);
  assert.equal(fixture.track.stopped, true);
  assert.equal(fixture.controller.starting, false);
  assert.equal(fixture.video.srcObject, null);
});

test("model failure releases preview and leaves startup retryable", async (t) => {
  const fixture = cameraFixture(t);
  fixture.controller.ensurePoseWorker = async () => { throw new Error("model failed"); };
  await assert.rejects(fixture.controller.startCamera(), /model failed/);
  assert.equal(fixture.track.stopped, true);
  assert.equal(fixture.controller.active, false);
  assert.equal(fixture.controller.starting, false);
});

test("a cancelled model initialization cannot restart the frame loop", async (t) => {
  const fixture = cameraFixture(t);
  const model = deferred();
  const initializing = deferred();
  let frames = 0;
  fixture.controller.ensurePoseWorker = () => { initializing.resolve(); return model.promise; };
  fixture.controller.scheduleNextFrame = () => { frames++; };
  const startup = fixture.controller.startCamera();
  await initializing.promise;
  fixture.controller.stopCamera();
  model.resolve();
  assert.equal(await startup, false);
  assert.equal(frames, 0);
  assert.equal(fixture.controller.active, false);
});

test("pose controller starts and switches with an exact PC webcam device", async () => {
  const requests = [];
  const tracks = [];
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const originalCanvasContext = globalThis.CanvasRenderingContext2D;
  const originalOffscreenContext = globalThis.OffscreenCanvasRenderingContext2D;
  class TestCanvasContext {
    clearRect() {}
  }
  globalThis.CanvasRenderingContext2D = TestCanvasContext;
  globalThis.OffscreenCanvasRenderingContext2D = TestCanvasContext;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        requests.push(constraints);
        const deviceId = constraints.video.deviceId?.exact || "system-default";
        const track = {
          stopped: false,
          stop() { this.stopped = true; },
          getSettings() { return { deviceId }; },
        };
        tracks.push(track);
        return {
          getTracks: () => [track],
          getVideoTracks: () => [track],
        };
      },
    },
  });

  const context = new TestCanvasContext();
  const canvas = { width: 0, height: 0, getContext: () => context };
  const video = {
    srcObject: null,
    videoWidth: 640,
    videoHeight: 480,
    async play() {},
    pause() {},
  };
  const controller = new PoseAssessmentController({
    video,
    canvas,
    modelUrl: "pose.task",
    wasmUrl: "mediapipe",
  });
  controller.ensurePoseWorker = async () => {};
  controller.scheduleNextFrame = () => {};
  controller.setObjectDetectionEnabled(false);

  try {
    await controller.startCamera({ deviceId: "integrated-camera" });
    assert.equal(requests[0].video.deviceId.exact, "integrated-camera");
    assert.equal(controller.getActiveCameraDeviceId(), "integrated-camera");

    await controller.switchVideoInput({ deviceId: "usb-webcam" });
    assert.equal(tracks[0].stopped, true);
    assert.equal(requests[1].video.deviceId.exact, "usb-webcam");
    assert.equal(controller.getActiveCameraDeviceId(), "usb-webcam");
  } finally {
    controller.dispose();
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      delete navigator.mediaDevices;
    }
    if (originalCanvasContext) globalThis.CanvasRenderingContext2D = originalCanvasContext;
    else delete globalThis.CanvasRenderingContext2D;
    if (originalOffscreenContext) {
      globalThis.OffscreenCanvasRenderingContext2D = originalOffscreenContext;
    } else {
      delete globalThis.OffscreenCanvasRenderingContext2D;
    }
  }
});

function videoFixture(t, { loadMetadata = true } = {}) {
  class Context { clearRect() {} }
  const restore = [];
  for (const [owner, key, value] of [
    [globalThis, "CanvasRenderingContext2D", Context],
    [globalThis, "OffscreenCanvasRenderingContext2D", Context],
    [URL, "createObjectURL", () => "blob:exercise-test"],
    [URL, "revokeObjectURL", (url) => revoked.push(url)],
  ]) {
    const original = Object.getOwnPropertyDescriptor(owner, key);
    Object.defineProperty(owner, key, { configurable: true, value });
    restore.push(() => original ? Object.defineProperty(owner, key, original) : delete owner[key]);
  }
  const revoked = [];
  const video = new EventTarget();
  Object.assign(video, {
    src: "", srcObject: null, readyState: 0, duration: 12,
    videoWidth: 640, videoHeight: 480, currentTime: 0, ended: false, paused:true,
    async play() { this.ended = false; this.readyState = 2; this.paused = false; },
    pause() { this.paused = true; },
    load() {
      if (loadMetadata && this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    },
    removeAttribute(name) { if (name === "src") this.src = ""; },
  });
  const statuses = [], assessments = [];
  const controller = new PoseAssessmentController({
    video, canvas: { width: 0, height: 0, getContext: () => new Context() },
    modelUrl: "pose.task", wasmUrl: "mediapipe",
    onStatus: (status) => statuses.push(status),
    onAssessment: (value) => assessments.push(value),
  });
  controller.ensurePoseWorker = async () => { controller.poseWorkerReady = true; };
  controller.scheduleNextFrame = () => {};
  t.after(() => {
    controller.dispose();
    restore.reverse().forEach((item) => item());
  });
  return { controller, video, revoked, statuses, assessments };
}

test("local video creates an automatic assessment and releases its object URL", async (t) => {
  const { controller, video, revoked, statuses, assessments } = videoFixture(t);
  assert.equal(await controller.startVideo({ type: "video/mp4", size: 1000 }), true);
  assert.equal(controller.sourceKind, "video");
  assert.equal(controller.active, true);
  assert.equal(controller.assessment?.asBaseline, false);
  assert.ok(statuses.some((status) => status.key === "recording"));
  video.ended = true;
  video.dispatchEvent(new Event("ended"));
  assert.equal(assessments[0].status, "insufficient");
  assert.equal(assessments[0].sourceKind, "video");
  await controller.replayVideo();
  assert.equal(video.currentTime, 0);
  assert.ok(controller.assessment);
  controller.stopCamera();
  assert.equal(controller.active, false);
  assert.deepEqual(revoked, ["blob:exercise-test"]);
});

test("cancelling metadata loading releases the selected video", async (t) => {
  const { controller, revoked } = videoFixture(t, { loadMetadata: false });
  const pending = controller.startVideo({ type: "video/webm", size: 1000 });
  controller.stopCamera();
  assert.equal(await pending, false);
  assert.deepEqual(revoked, ["blob:exercise-test"]);
});

test("seven-second video observes 6.5 seconds and reports the actual duration", async t => {
  const {controller,video,assessments} = videoFixture(t);
  video.duration = 7;
  assert.equal(await controller.startVideo({type:"video/mp4",size:1000}), true);
  assert.equal(controller.assessment.durationMs, 6500);
  controller.collectAssessmentSample(null, 10000, {mediaTime:6.5});
  assert.equal(controller.assessment, null);
  assert.equal(assessments[0].captureQuality.durationSeconds, 6.5);
  assert.equal(assessments[0].videoSegment.observationDurationSeconds, 6.5);
  assert.equal(assessments[0].videoSegment.endSeconds, 7);
  assert.equal(assessments[0].status, "insufficient", "no pose samples must not qualify just because the clip duration is accepted");
  video.ended = true; controller.handleVideoEnded();
  await controller.replayVideo();
  assert.equal(controller.assessment.durationMs, 6500);
  assert.equal(controller.videoWindowComplete, false);
});

test("short videos play and replay without inventing a complete assessment", async t => {
  const {controller,video,assessments,statuses} = videoFixture(t);
  video.duration = 4;
  assert.equal(await controller.startVideo({type:"video/webm",size:1000}), true);
  assert.equal(video.paused, false);
  assert.equal(controller.assessment, null);
  assert.equal(statuses.at(-1).key, "preview");
  assert.equal(assessments.at(-1).status, "insufficient");
  video.ended = true; controller.handleVideoEnded();
  assert.equal(video.paused, true);
  await controller.replayVideo();
  assert.equal(controller.assessment, null);
  assert.equal(video.paused, false);
});

test("long video stops at the automatic boundary and can seek back or replay", async t => {
  const {controller,video,statuses} = videoFixture(t);
  video.duration = 181;
  await controller.startVideo({type:"video/mp4",size:1000});
  assert.equal(controller.videoWindow.endSeconds, 120);
  video.currentTime = 121;
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(video.currentTime, 120);
  assert.equal(video.paused, true);
  assert.equal(controller.videoWindowComplete, true);
  assert.equal(statuses.at(-1).key, "ended");
  const count = statuses.length;
  video.dispatchEvent(new Event("timeupdate"));
  assert.equal(statuses.length, count, "one completion event per clip");
  video.currentTime = 10; video.dispatchEvent(new Event("seeked"));
  assert.equal(controller.videoWindowComplete, false);
  await controller.replayVideo();
  assert.equal(video.currentTime, 0);
  assert.equal(controller.assessment.durationMs, 8000);
});

test("a paused frame shown before its pose was analysed is posed once the look-ahead reaches it", async t => {
  const {controller,video} = videoFixture(t);
  controller.sourceKind = "video"; controller.videoObjectUrl = "blob:exercise-test";
  controller.videoWindow = {startSeconds:0,endSeconds:10};
  controller.videoTrack = new PoseTrack(); controller.detailTrack = new PoseTrack();
  controller.resizeCanvas = () => {};
  const emitted = [], frames = [];
  controller.handlePoseResult = message => emitted.push(message);
  controller.onVideoFrame = frame => frames.push(frame.mediaTime);
  video.paused = true; video.currentTime = 4;
  controller.presentVideoFrame(4);
  assert.equal(emitted.length, 0); assert.equal(controller.pendingPresent, 4);
  assert.deepEqual(frames, [4], "the pulse still receives the frame");
  const pose = [bodyPose()];
  for (const mediaTime of [3.95, 4, 4.05]) controller.addAnalysis({ mediaTime, landmarks: pose, worldLandmarks: pose, inferenceMs: 20 });
  assert.equal(emitted.length, 1); assert.equal(emitted[0].mediaTime, 4); assert.equal(controller.pendingPresent, null);
});

test("the synchronized video holds rather than show a frame whose pose is unknown", t => {
  const {controller,video} = videoFixture(t);
  controller.sourceKind = "video"; controller.videoObjectUrl = "blob:exercise-test";
  controller.videoWindow = {startSeconds:0,endSeconds:10};
  controller.videoTrack = new PoseTrack();
  const seeks = [], steers = [];
  controller.lookahead = { stopped:false, seekTarget:null, position:2.1, seek: at => { seeks.push(at); }, steer: lead => { steers.push(lead); }, stop() {} };
  const pose = [bodyPose()];
  for (let i = 0; i <= 3; i++) controller.videoTrack.add({ mediaTime: 2 + i / 30, landmarks: pose, worldLandmarks: pose });
  video.currentTime = 2.05; video.paused = false;
  controller.steerSync();
  assert.equal(video.paused, true); assert.equal(controller.syncHold, true);
  for (let i = 4; i <= 24; i++) controller.videoTrack.add({ mediaTime: 2 + i / 30, landmarks: pose, worldLandmarks: pose });
  controller.lookahead.position = 2.8;
  controller.steerSync();
  assert.equal(controller.syncHold, false); assert.equal(video.paused, false, "playback resumes with the analysis ahead");
  video.currentTime = 7;
  controller.steerSync();
  assert.ok(seeks.some(at => Math.abs(at - 7) < 1e-9), "a jump past the analysis moves the look-ahead to it");
});

test("selecting a video replaces a pending camera permission request", async t => {
  const {controller, video} = videoFixture(t);
  const permission = deferred();
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {configurable:true, value:{getUserMedia:()=>permission.promise}});
  t.after(() => original ? Object.defineProperty(navigator, "mediaDevices", original) : delete navigator.mediaDevices);
  let stopped = false;
  const camera = controller.startCamera();
  assert.equal(controller.starting, true);
  assert.equal(await controller.startVideo({type:"video/mp4",size:1000}), true);
  permission.resolve({getTracks:()=>[{stop(){stopped=true;}}]});
  assert.equal(await camera, false);
  assert.equal(stopped, true);
  assert.equal(controller.sourceKind, "video");
  assert.equal(controller.active, true);
  assert.equal(video.srcObject, null);
});

test("a new selection replaces pending video metadata without closing the new session", async t => {
  const {controller, video, revoked} = videoFixture(t, {loadMetadata:false});
  const first = controller.startVideo({type:"video/mp4",size:1000});
  video.load = function () { if (this.src) queueMicrotask(()=>this.dispatchEvent(new Event("loadedmetadata"))); };
  const second = controller.startVideo({type:"video/webm",size:1000});
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(controller.sourceKind, "video");
  assert.equal(controller.starting, false);
  assert.equal(revoked.length, 1);
  await assert.rejects(controller.startVideo({type:"text/plain",size:1000}), /MP4 or WebM/);
  assert.equal(controller.active, true, "an invalid file must not stop the running source");
});
