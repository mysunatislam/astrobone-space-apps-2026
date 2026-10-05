import test from "node:test";
import assert from "node:assert/strict";
import { PoseTrack, blendPoints } from "./videoPoseTrack.js";
import { LEAD, planLookahead, planPlayback } from "./videoLookahead.js";
import { estimatePulse, estimateStress, skinRegions } from "./rppg.js";

const point = (x, visibility = 0.9) => ({ x, y: 2 * x, z: 0, visibility });
const pose = x => [Array.from({ length: 33 }, () => point(x))];
const sample = (t, x = t) => ({ mediaTime: t, landmarks: pose(x), worldLandmarks: pose(x) });

test("pose track keeps media-time order, replaces repeats and reports unbroken coverage", () => {
  const track = new PoseTrack();
  for (const t of [0.2, 0, 0.1, 0.3]) track.add(sample(t));
  track.add(sample(0.1, 5));
  assert.deepEqual(track.samples.map(s => s.mediaTime), [0, 0.1, 0.2, 0.3]);
  assert.equal(track.samples[1].landmarks[0][0].x, 5);
  assert.equal(track.coveredUntil(0.05), 0.3);
  track.add(sample(0.9));
  assert.equal(track.coveredUntil(0), 0.3, "a 0.6 s gap ends coverage");
  assert.equal(track.coveredUntil(0.7), -Infinity);
  assert.equal(track.coveredUntil(0.9), 0.9);
});

test("synchronized pose has no lag: the centred blend of steady motion lands on the frame's own time", () => {
  const track = new PoseTrack();
  for (let i = 0; i <= 60; i++) track.add(sample(i / 30));
  for (const t of [0.5, 1.0123, 1.5]) {
    const at = track.poseAt(t);
    assert.ok(Math.abs(at.landmarks[0][11].x - t) < 1e-9, `pose at ${t}`);
    assert.ok(Math.abs(at.worldLandmarks[0][11].y - 2 * t) < 1e-9);
  }
  // Noise is averaged away rather than followed.
  const noisy = new PoseTrack();
  for (let i = 0; i <= 60; i++) noisy.add(sample(i / 30, 1 + (i % 2 ? 0.02 : -0.02)));
  assert.ok(Math.abs(noisy.poseAt(1).landmarks[0][0].x - 1) < 0.01);
});

test("sparse analysis interpolates, an undetected body stays undetected, and unanalysed time is null", () => {
  const sparse = new PoseTrack();
  sparse.add(sample(0)); sparse.add(sample(0.2));
  assert.ok(Math.abs(sparse.poseAt(0.15).landmarks[0][0].x - 0.15) < 1e-9);
  const lost = new PoseTrack();
  for (let i = 0; i < 10; i++) lost.add(i === 5 ? sample(i / 30) : { mediaTime: i / 30, landmarks: [], worldLandmarks: [] });
  assert.deepEqual(lost.poseAt(5 / 30), { landmarks: [], worldLandmarks: [] });
  assert.equal(lost.poseAt(4), null);
});

test("face mesh is blended for the pulse regions while hands come from the nearest frame", () => {
  const track = new PoseTrack();
  track.add({ mediaTime: 1, face: { landmarks: [point(0)] }, hands: [{ side: "left" }] });
  track.add({ mediaTime: 1.1, face: { landmarks: [point(1)] }, hands: [] });
  const details = track.detailsAt(1.05);
  assert.ok(Math.abs(details.face.landmarks[0].x - 0.5) < 1e-9);
  assert.equal(details.hands.length, track.nearest(1.05).hands.length);
  assert.equal(track.detailsAt(3), null);
  assert.equal(blendPoints([], []), null);
});

test("look-ahead runs fast until it is ahead, rests when far ahead, and holds playback only when needed", () => {
  assert.deepEqual(planLookahead({ lead: 0.2, resting: false }), { action: "play", rate: 2 });
  assert.deepEqual(planLookahead({ lead: 1.5, resting: false }), { action: "play", rate: 1.25 });
  assert.deepEqual(planLookahead({ lead: LEAD.max, resting: false }), { action: "rest" });
  assert.deepEqual(planLookahead({ lead: LEAD.max - 0.5, resting: true }), { action: "rest" }, "hysteresis");
  assert.equal(planPlayback({ visibleTime: 2, coveredUntil: 2.3, end: 10, held: false }), "play");
  assert.equal(planPlayback({ visibleTime: 2, coveredUntil: 2.05, end: 10, held: false }), "hold");
  assert.equal(planPlayback({ visibleTime: 2, coveredUntil: 2.3, end: 10, held: true }), "hold", "resumes with margin");
  assert.equal(planPlayback({ visibleTime: 9.9, coveredUntil: 9.99, end: 10, held: true }), "play", "the clip end needs no margin");
});

// Synthetic face colour with beats at known times (respiratory sinus arrhythmia around 72 bpm).
function beatingFace({ seconds = 40, fps = 30, swingMs = 60 } = {}) {
  const beats = [0];
  while (beats.at(-1) < seconds) beats.push(beats.at(-1) + (833 + swingMs * Math.sin(2 * Math.PI * 0.25 * beats.at(-1))) / 1000);
  const samples = [];
  for (let i = 0; i <= seconds * fps; i++) {
    const t = i / fps, k = beats.findIndex(b => b > t) - 1, phase = (t - beats[k]) / (beats[k + 1] - beats[k]);
    const p = Math.cos(2 * Math.PI * phase);
    samples.push({ t: t * 1000, rgb: [120 + 0.2 * p, 100 + 0.6 * p, 80 + 0.35 * p], motion: 0 });
  }
  const intervals = beats.slice(1).map((b, i) => (b - beats[i]) * 1000).filter((_, i) => beats[i + 1] <= seconds);
  const rmssd = Math.sqrt(intervals.slice(1).reduce((s, v, i) => s + (v - intervals[i]) ** 2, 0) / (intervals.length - 1));
  return { samples, rmssd };
}

test("stress estimate recovers beat-to-beat variability from the pulse waveform", () => {
  const { samples, rmssd } = beatingFace();
  const pulse = estimatePulse(samples.filter(s => s.t >= samples.at(-1).t - 30000));
  assert.equal(pulse.status, "estimated");
  assert.ok(Math.abs(pulse.bpm - 72) <= 3, `pulse ${pulse.bpm}`);
  const stress = estimateStress(samples, pulse.bpm);
  assert.equal(stress.status, "estimated");
  assert.ok(Math.abs(stress.rmssdMs - rmssd) <= 12, `RMSSD ${stress.rmssdMs} vs ${rmssd.toFixed(1)}`);
  assert.ok(stress.stressIndex > 0 && ["low", "elevated", "high"].includes(stress.level));
  // A steadier heart (less variability) reads as more stress.
  const steady = beatingFace({ swingMs: 10 });
  assert.ok(estimateStress(steady.samples, 72).stressIndex > stress.stressIndex);
});

test("stress is withheld for short windows, wrong rates and a moving face", () => {
  const { samples } = beatingFace();
  assert.equal(estimateStress(samples.slice(0, 20 * 30), 72).status, "insufficient");
  assert.equal(estimateStress(samples, 110).status, "insufficient", "beats must agree with the pulse rate");
  assert.equal(estimateStress(samples.map(s => ({ ...s, motion: 0.1 })), 72).status, "insufficient");
});

test("skin regions cover forehead and both cheeks inside their landmarks", () => {
  const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: (i % 20) / 20, y: Math.floor(i / 20) / 24 }));
  const regions = skinRegions(landmarks);
  assert.deepEqual(Object.keys(regions), ["forehead", "leftCheek", "rightCheek"]);
  for (const box of Object.values(regions)) assert.ok(box.w > 0 && box.h > 0);
  assert.equal(skinRegions(landmarks.slice(0, 100)), null);
});
