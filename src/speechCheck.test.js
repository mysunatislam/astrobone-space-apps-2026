import { test } from "node:test";
import assert from "node:assert/strict";
import { vadSegments, speechMetrics, repetitions, passageCoverage, compareSpeech, energyProbabilities, resampleTo16k, READING_PASSAGE, SPEECH } from "./speechCheck.js";

const probs = pattern => pattern.flatMap(([on, frames]) => Array(frames).fill(on ? 0.9 : 0.05)); // 32 ms frames
test("speech segments use hysteresis, join gaps under 250 ms and drop blips", () => {
  const segs = vadSegments(probs([[1, 60], [0, 5], [1, 60], [0, 20], [1, 2], [0, 20], [1, 60]]));
  assert.equal(segs.length, 2); // the 160 ms gap is joined, the 64 ms blip dropped
  assert.equal(segs[0].start, 0); assert.equal(segs[1].start, (60 + 5 + 60 + 20 + 2 + 20) * 32);
});
test("pause metrics: count, longest, share of the reading", () => {
  const m = speechMetrics(vadSegments(probs([[0, 10], [1, 100], [0, 20], [1, 100], [0, 40], [1, 100]])));
  assert.equal(m.status, "measured"); assert.equal(m.pauses, 2);
  assert.equal(m.longestPauseMs, 40 * 32); assert.ok(Math.abs(m.pauseShare - 60 / 360) < 0.01);
  assert.equal(m.transcribed, false);
});
test("too little speech is refused", () => assert.equal(speechMetrics(vadSegments(probs([[1, 50]]))).status, "insufficient"));
test("repetitions count doubled words, doubled two-word phrases and fillers", () => {
  const r = repetitions("the the rainbow is um a division a division of light");
  assert.equal(r.repeatedWords, 1); assert.equal(r.repeatedPhrases, 1); assert.equal(r.fillers, 1);
  assert.equal(repetitions(READING_PASSAGE).repeatedWords, 0);
});
test("passage coverage is 1 for the passage and lower when lines are skipped", () => {
  assert.equal(passageCoverage(READING_PASSAGE), 1);
  assert.ok(passageCoverage("When the sunlight strikes raindrops in the air") < 0.25);
});
test("comparison with the person's own readings flags more pausing", () => {
  const usual = { status: "measured", pauseShare: 0.12, longestPauseMs: 600, pausesPerMin: 10, seconds: 18, repeatedWords: 0 };
  const today = { ...usual, pauseShare: 0.3, longestPauseMs: 1600 };
  assert.ok(compareSpeech(today, [usual]).every(r => r.status === "baseline"));
  const rows = compareSpeech(today, [usual, usual, usual]);
  assert.equal(rows.find(r => r.key === "pauseShare").status, "changed");
  assert.equal(rows.find(r => r.key === "longestPauseMs").status, "changed");
  assert.equal(rows.find(r => r.key === "seconds").status, "stable");
});
test("energy fallback separates a tone from silence; resampling keeps duration", () => {
  const s = new Float32Array(16000 * 2); for (let i = 8000; i < 24000; i++) s[i] = 0.2 * Math.sin(i / 5);
  for (let i = 0; i < s.length; i++) s[i] += (Math.random() - 0.5) * 1e-3;
  const segs = vadSegments(energyProbabilities(s)); assert.equal(segs.length, 1);
  assert.ok(Math.abs(segs[0].start - 500) < 70 && Math.abs(segs[0].end - 1500) < 70, JSON.stringify(segs));
  assert.equal(resampleTo16k(new Float32Array(48000), 48000).length, SPEECH.sampleRate);
});
