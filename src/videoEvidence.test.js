import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_VIDEO_BYTES, validateExerciseVideo, validateVideoMetadata,
} from "./videoEvidence.js";

test("accepts bounded MP4 and WebM files", () => {
  assert.doesNotThrow(() => validateExerciseVideo({ type: "video/mp4", size: 1000 }));
  assert.doesNotThrow(() => validateExerciseVideo({ type: "video/webm", size: MAX_VIDEO_BYTES }));
  assert.throws(() => validateExerciseVideo({ type: "video/quicktime", size: 1000 }), /MP4 or WebM/);
  assert.throws(() => validateExerciseVideo({ type: "video/mp4", size: MAX_VIDEO_BYTES + 1 }), /100 MB/);
  assert.throws(() => validateExerciseVideo({ type: "video/mp4", size: 0 }), /100 MB/);
});

test("automatically clips long videos and adapts seven-second observations", () => {
  const metadata = duration => validateVideoMetadata({duration,videoWidth:640,videoHeight:480});
  assert.deepEqual(metadata(7), {startSeconds:0,endSeconds:7,sourceDurationSeconds:7,autoTrimmed:false,assessmentEligible:true,assessmentDurationMs:6500});
  assert.equal(metadata(9).assessmentDurationMs, 8000);
  assert.equal(metadata(6).assessmentEligible, false);
  assert.equal(metadata(120).autoTrimmed, false);
  assert.equal(metadata(121).endSeconds, 120);
  assert.equal(metadata(121).autoTrimmed, true);
  assert.equal(metadata(3600).sourceDurationSeconds, 3600);
  assert.equal(metadata(3600).endSeconds, 120);
  for (const duration of [0,-1,NaN,Infinity]) assert.throws(()=>metadata(duration), /duration/);
  assert.throws(() => validateVideoMetadata({ duration: 12, videoWidth: 0, videoHeight: 0 }), /picture track/);
});

test("accepts untyped MP4/WebM files but not conflicting or unknown file types", () => {
  assert.doesNotThrow(() => validateExerciseVideo({name:"exercise.MP4", type:"", size:1000}));
  assert.doesNotThrow(() => validateExerciseVideo({name:"exercise.webm", type:"application/octet-stream", size:1000}));
  assert.throws(() => validateExerciseVideo({name:"exercise.mov", type:"", size:1000}), /MP4 or WebM/);
  assert.throws(() => validateExerciseVideo({name:"exercise.mp4", type:"text/plain", size:1000}), /MP4 or WebM/);
  assert.throws(() => validateExerciseVideo({name:"exercise", type:"", size:1000}), /MP4 or WebM/);
});
