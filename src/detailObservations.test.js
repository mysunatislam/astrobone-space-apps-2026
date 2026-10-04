import test from "node:test";
import assert from "node:assert/strict";
import { assignHandSides, FaceActivityObserver } from "./detailObservations.js";

test("hands follow the nearest anatomical pose wrist, not a selfie handedness label", () => {
  const pose = Array.from({ length: 33 }, () => null);
  pose[15] = { x: 0.7, y: 0.5, visibility: 0.9 };
  pose[16] = { x: 0.3, y: 0.5, visibility: 0.9 };
  const hands = [
    { landmarks: [{ x: 0.31, y: 0.51 }], handedness: "Left" },
    { landmarks: [{ x: 0.69, y: 0.5 }], handedness: "Right" },
  ];
  assert.deepEqual(assignHandSides(hands, pose).map((hand) => hand.side), ["right", "left"]);
  assert.equal(assignHandSides([{ landmarks: [{ x: 0.05, y: 0.05 }] }], pose)[0].side, null);
});

test("eye closure produces one observation cue, never a sleep diagnosis", () => {
  const observer = new FaceActivityObserver();
  const face = { blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8, jawOpen: 0.7 } };
  assert.equal(observer.update(face, 1000).newCue, false);
  for (let timestamp = 2000; timestamp < 9000; timestamp += 1000) observer.update(face, timestamp);
  const held = observer.update(face, 9000);
  assert.equal(held.newCue, true);
  assert.equal(held.mouthState, "Mouth opening");
  assert.equal("sleeping" in held, false);
  assert.equal(observer.update(face, 10000).newCue, false);
  assert.equal(observer.update(null, 11000).visible, false);
  assert.equal(observer.update(face, 12000).newCue, false);
});

test("missing frames and reversed time cannot count as continuous eye closure", () => {
  const observer = new FaceActivityObserver();
  const face = { blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 } };
  observer.update(face, 1000);
  assert.equal(observer.update(face, 12000).closureSeconds, 0);
  assert.equal(observer.update(face, 13000).closureSeconds, 1);
  assert.equal(observer.update(face, 9000).closureSeconds, 0);
});
