import { test } from "node:test";
import assert from "node:assert/strict";
import { eyeAspect, mouthAsymmetry, painExpression, sadLike, frameCues, summarizeFaceCues, compareFaceCues, breathingFromHead, FACE_CUES } from "./faceCues.js";

// A synthetic face mesh: only the points the cues read, placed like a frontal face.
function mesh({ eyeGap = 0.03, cornerDrop = 0 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const eye = (ids, cx) => { const [p1, p2, p3, p4, p5, p6] = ids; lm[p1] = { x: cx - 0.04, y: 0.4 }; lm[p4] = { x: cx + 0.04, y: 0.4 }; lm[p2] = { x: cx - 0.015, y: 0.4 - eyeGap / 2 }; lm[p3] = { x: cx + 0.015, y: 0.4 - eyeGap / 2 }; lm[p6] = { x: cx - 0.015, y: 0.4 + eyeGap / 2 }; lm[p5] = { x: cx + 0.015, y: 0.4 + eyeGap / 2 }; };
  eye([33, 160, 158, 133, 153, 144], 0.4); eye([362, 385, 387, 263, 373, 380], 0.6);
  lm[33] = { x: 0.36, y: 0.4 }; lm[263] = { x: 0.64, y: 0.4 };
  lm[234] = { x: 0.3, y: 0.5 }; lm[454] = { x: 0.7, y: 0.5 }; lm[1] = { x: 0.5, y: 0.5 };
  lm[61] = { x: 0.44, y: 0.65 }; lm[291] = { x: 0.56, y: 0.65 + cornerDrop };
  return lm;
}

test("eye aspect falls as the lids close", () => {
  assert.ok(eyeAspect(mesh({ eyeGap: 0.03 }), "left") > eyeAspect(mesh({ eyeGap: 0.005 }), "left"));
});
test("mouth asymmetry is a share of face width and is zero for a level mouth", () => {
  assert.equal(mouthAsymmetry(mesh()), 0);
  assert.ok(Math.abs(mouthAsymmetry(mesh({ cornerDrop: 0.02 })) - 0.05) < 1e-9);
});
test("pain expression adds brow lowering, the larger squint and the larger nose/lip raise (PSPI stand-in)", () => {
  const s = { browDownLeft: 0.6, browDownRight: 0.4, cheekSquintLeft: 0.2, cheekSquintRight: 0.2, eyeSquintLeft: 0.5, eyeSquintRight: 0.5, noseSneerLeft: 0.3, noseSneerRight: 0.3, mouthUpperUpLeft: 0.1, mouthUpperUpRight: 0.1 };
  assert.ok(Math.abs(painExpression(s) - (0.5 + 0.5 + 0.3)) < 1e-9);
  assert.ok(Math.abs(painExpression(s, true) - 2.3) < 1e-9);
  assert.equal(painExpression({}), 0);
  assert.ok(sadLike({ browInnerUp: 1, mouthFrownLeft: 1, mouthFrownRight: 1 }) > sadLike({ mouthSmileLeft: 1, mouthSmileRight: 1 }));
});

function run({ seconds = 60, fps = 30, closedEvery = 0, closedFor = 4, cornerDrop = 0, shapes = {} } = {}) {
  const frames = [];
  for (let i = 0; i < seconds * fps; i++) {
    const closed = closedEvery && i % closedEvery < closedFor;
    frames.push(frameCues({ t: i * 1000 / fps, landmarks: mesh({ eyeGap: closed ? 0.002 : 0.03, cornerDrop }), blendshapes: shapes, patches: { underEyeL: [120, 100, 90], underEyeR: [120, 100, 90], cheekL: [160, 120, 110], cheekR: [160, 120, 110] } }));
  }
  return frames;
}
test("a minute of open eyes with a blink every 3 s: 20 blinks a minute, PERCLOS near the blink share", () => {
  const s = summarizeFaceCues(run({ closedEvery: 90, closedFor: 4 }));
  assert.equal(s.status, "measured"); assert.ok(Math.abs(s.blinksPerMin - 20) <= 1, String(s.blinksPerMin));
  assert.ok(s.perclos > 0.03 && s.perclos < 0.06, String(s.perclos));
  assert.ok(s.underEyeDarkness > 0.1);
});
test("long closures are not blinks but raise PERCLOS", () => {
  const s = summarizeFaceCues(run({ closedEvery: 300, closedFor: 150 }));
  assert.equal(s.blinksPerMin, 0); assert.ok(s.perclos > 0.4);
});
test("too little face is refused, never guessed", () => {
  assert.equal(summarizeFaceCues(run({ seconds: 2 })).status, "insufficient");
  assert.equal(summarizeFaceCues([{ face: false }]).status, "insufficient");
});
test("asymmetry must be held for most of the minute", () => {
  assert.equal(summarizeFaceCues(run({ cornerDrop: 0.02 })).asymmetryHeld, true);
  assert.equal(summarizeFaceCues(run({ cornerDrop: 0.005 })).asymmetryHeld, false);
  assert.ok(FACE_CUES.asymmetry === 0.04);
});
test("comparison needs 2 earlier checks, then reports changes from the person's own usual", () => {
  const usual = summarizeFaceCues(run({ closedEvery: 90 })), drowsy = summarizeFaceCues(run({ closedEvery: 300, closedFor: 150, shapes: { browDownLeft: 0.9, browDownRight: 0.9, eyeSquintLeft: 0.6, eyeSquintRight: 0.6 } }));
  assert.ok(compareFaceCues(drowsy, [usual]).every(c => c.status === "baseline" || c.key === "mouthAsymmetry"));
  const rows = compareFaceCues(drowsy, [usual, usual]);
  assert.equal(rows.find(r => r.key === "perclos").status, "changed");
  assert.equal(rows.find(r => r.key === "painExpression").status, "changed");
  assert.equal(compareFaceCues(usual, [usual, usual]).filter(r => r.status === "changed").length, 0);
  for (const r of rows) assert.doesNotMatch(r.text, /diagnos|stroke|depress/i);
});
test("head-motion breathing finds a clean 15/min rhythm and refuses noise-free stillness", () => {
  const samples = Array.from({ length: 60 * 30 }, (_, i) => ({ t: i * 1000 / 30, headY: 0.5 + 0.002 * Math.sin(2 * Math.PI * 0.25 * i / 30) }));
  const r = breathingFromHead(samples); assert.equal(r.status, "estimated"); assert.ok(Math.abs(r.rate - 15) < 0.5, String(r.rate));
  assert.equal(breathingFromHead(samples.slice(0, 20 * 30)).status, "insufficient");
});
