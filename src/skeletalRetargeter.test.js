import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bindHumanRig } from "./humanRig.js";
import { SkeletalRetargeter, LIVE_BONE_CHAIN, hasLiveSegments, cameraDirection, fitTrackedRigInView } from "./skeletalRetargeter.js";
import { analyzePoseLandmarks } from "./functionalAssessment.js";
import { bodyPose } from "../scripts/fixtures/bodyPose.mjs";

async function loadRig() {
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1 });
  const bytes = await readFile(new URL("../public/models/human_body_clothed.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const group = new THREE.Group();
  group.add(gltf.scene);
  const keys = new Set(LIVE_BONE_CHAIN.flatMap(([a, b]) => [a, b]).concat("root"));
  const { bones, fingers } = bindHumanRig(gltf.scene);
  for (const key of keys) {
    if (key === "headTop") continue;
    assert.ok(bones[key], `GLB bone binding: ${key}`);
  }
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const idle = gltf.animations.find((clip) => clip.name === "Idle_Breathing") ?? gltf.animations[0];
  mixer.clipAction(idle).play();
  mixer.setTime(idle.duration * 0.25);
  const neutralPose = Object.fromEntries(Object.entries(bones).map(([key, bone]) => [key, {
    quaternion: bone.quaternion.clone(), position: bone.position.clone(), scale: bone.scale.clone(),
  }]));
  const fingerNeutral = new Map();
  for (const chains of Object.values(fingers)) {
    for (const chain of chains) {
      for (const bone of chain) {
        fingerNeutral.set(bone, {
          quaternion: bone.quaternion.clone(), position: bone.position.clone(), scale: bone.scale.clone(),
        });
      }
    }
  }
  return { group, bones, fingers, neutralPose, fingerNeutral };
}

function runPose(solver, kind, start = 0) {
  let result;
  for (let i = 1; i <= 90; i++) {
    const now = start + i * 16;
    const frame = analyzePoseLandmarks(bodyPose(kind), bodyPose(kind), { timestamp: now, detected: true });
    result = solver.update(frame, now);
  }
  return result;
}

function direction(rig, a, b) {
  return rig.bones[b].getWorldPosition(new THREE.Vector3())
    .sub(rig.bones[a].getWorldPosition(new THREE.Vector3())).normalize();
}

test("rigged human: each arm follows its own camera landmarks without a left/right swap", async () => {
  const rig = await loadRig();
  const solver = new SkeletalRetargeter(rig);
  const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.55, 0));
  solver.begin(view);
  runPose(solver, "neutral");
  const rightBefore = rig.bones.rightForeArm.quaternion.clone();
  runPose(solver, "left-up", 1500);
  const frame = analyzePoseLandmarks(bodyPose("left-up"));
  for (const [a, b, key] of LIVE_BONE_CHAIN) {
    if (!rig.bones[a] || !rig.bones[b]) continue;
    if (/Foot$/.test(key)) continue; // Foot surface uses heel-to-toe, not ankle-to-toe.
    const actual = direction(rig, a, b);
    const expected = cameraDirection(frame.segments[key].direction, view);
    assert.ok(actual.dot(expected) > 0.98, `${a} must follow ${key}, dot=${actual.dot(expected)}`);
  }
  assert.ok(rig.bones.rightForeArm.quaternion.angleTo(rightBefore) < 0.05);
  for (const mirrored of [false, true]) {
    const sign = mirrored ? -1 : 1;
    const left = direction(rig, "leftForeArm", "leftHand").applyQuaternion(view.clone().invert());
    const right = direction(rig, "rightForeArm", "rightHand").applyQuaternion(view.clone().invert());
    assert.equal(Math.sign(left.x * sign), Math.sign(frame.segments.leftForeArm.direction.x * sign));
    assert.ok(left.y > 0 && right.y < 0, "raising left must not raise right or invert vertical motion");
  }
  runPose(solver, "right-up", 3000);
  assert.ok(direction(rig, "rightForeArm", "rightHand").applyQuaternion(view.clone().invert()).y > 0);
  assert.ok(direction(rig, "leftForeArm", "leftHand").applyQuaternion(view.clone().invert()).y < 0);
});

test("hand and jaw detail drives only the matching human rig bones", async () => {
  const rig = await loadRig();
  const solver = new SkeletalRetargeter(rig);
  solver.begin(new THREE.Quaternion());
  const leftFinger = rig.fingers.left[1][0];
  const rightFinger = rig.fingers.right[1][0];
  const leftBefore = leftFinger.quaternion.clone();
  const rightBefore = rightFinger.quaternion.clone();
  const jawBefore = rig.bones.jaw.quaternion.clone();
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [index, x, y] of [[5, 0, 0], [6, 0.03, -0.03], [7, 0.06, -0.06], [8, 0.09, -0.09]]) {
    points[index] = { x, y, z: 0 };
  }
  for (let i = 1; i <= 90; i++) {
    const now = i * 16;
    const frame = analyzePoseLandmarks(bodyPose("neutral"), bodyPose("neutral"), { timestamp: now, detected: true });
    frame.detailHands = [{ side: "left", worldLandmarks: points }];
    frame.detailFace = { blendshapes: { jawOpen: 1 } };
    frame.detailTimestamp = now;
    solver.update(frame, now);
  }
  assert.ok(leftFinger.quaternion.angleTo(leftBefore) > 0.1);
  assert.ok(rightFinger.quaternion.angleTo(rightBefore) < 0.01);
  assert.ok(rig.bones.jaw.quaternion.angleTo(jawBefore) > 0.1);
});

test("partial body drives visible arms without enabling the full-body assessment", async () => {
  const rig = await loadRig();
  const solver = new SkeletalRetargeter(rig);
  solver.begin(new THREE.Quaternion());
  const result = runPose(solver, "upper-only");
  assert.equal(result.state, "partial");
  assert.ok(result.trackedBones > 0);
  assert.ok(direction(rig, "leftForeArm", "leftHand").y > 0.8);
  assert.equal(analyzePoseLandmarks(bodyPose("upper-only")).usable, false);
});

test("a close-up cannot rotate the whole avatar using inferred pelvis orientation", async () => {
  const rig = await loadRig();
  const solver = new SkeletalRetargeter(rig);
  solver.begin(new THREE.Quaternion());
  const rootBefore = rig.bones.root.quaternion.clone();
  const spineBefore = rig.bones.spine.quaternion.clone();
  const thighBefore = rig.bones.leftUpLeg.quaternion.clone();
  const points = bodyPose("left-up");
  points[23].z = 0.4;
  points[24].z = -0.4;
  for (let index = 25; index < 33; index++) points[index].visibility = 0.1;
  for (let index = 1; index <= 30; index++) {
    const now = index * 16;
    const frame = analyzePoseLandmarks(points, points, { timestamp: now, detected: true });
    assert.equal(frame.usable, false);
    solver.update(frame, now);
  }
  assert.ok(rig.bones.root.quaternion.angleTo(rootBefore) < 0.0001);
  assert.ok(rig.bones.spine.quaternion.angleTo(spineBefore) < 0.0001);
  assert.ok(rig.bones.leftUpLeg.quaternion.angleTo(thighBefore) < 0.0001);
  assert.ok(direction(rig, "leftForeArm", "leftHand").y > 0.7);
});

test("lost, stale and invalid packets freeze the rig instead of replaying animation", async () => {
  const rig = await loadRig();
  const solver = new SkeletalRetargeter(rig);
  solver.begin(new THREE.Quaternion());
  runPose(solver, "left-up");
  const before = Object.values(rig.bones).map((b) => b.quaternion.toArray());
  const frame = analyzePoseLandmarks(bodyPose("right-up"), bodyPose("right-up"), { timestamp: 1500, detected: false });
  assert.equal(solver.update(frame, 1500).state, "lost");
  frame.detected = true;
  assert.equal(solver.update(frame, 2400).state, "lost");
  assert.equal(solver.update(null, 2500).state, "lost");
  assert.deepEqual(Object.values(rig.bones).map((b) => b.quaternion.toArray()), before);
  assert.equal(hasLiveSegments({ ...frame, timestamp: NaN }, 2500), false);
});

test("live framing keeps raised hands and feet inside desktop and phone viewports", async () => {
  const rig = await loadRig();
  const solver = new SkeletalRetargeter(rig);
  solver.begin(new THREE.Quaternion());
  runPose(solver, "left-up");
  const bones = [];
  rig.group.traverse((node) => { if (node.isBone) bones.push(node); });
  for (const aspect of [0.83, 0.58, 1.6]) {
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 2000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    fitTrackedRigInView(camera, new THREE.Vector3(), bones);
    for (const bone of bones) {
      const projected = bone.getWorldPosition(new THREE.Vector3()).project(camera);
      assert.ok(Math.abs(projected.x) <= 0.83 && Math.abs(projected.y) <= 0.71, `${bone.name} must stay framed`);
    }
  }
});

test("repeated motion cycles return to the same neutral pose without accumulated twist", async () => {
  const rig = await loadRig(), solver = new SkeletalRetargeter(rig); solver.begin(new THREE.Quaternion());
  runPose(solver, "neutral"); const before = rig.bones.leftArm.quaternion.clone();
  for (let i = 0; i < 8; i++) { runPose(solver, "left-up", 2000 + i * 4000); runPose(solver, "neutral", 4000 + i * 4000); }
  assert.ok(before.angleTo(rig.bones.leftArm.quaternion) < .001);
});

test("noisy pelvis depth cannot invert the upright display rig", async () => {
  const rig = await loadRig(), solver = new SkeletalRetargeter(rig); solver.begin(new THREE.Quaternion());
  const before = rig.bones.root.getWorldQuaternion(new THREE.Quaternion());
  const pose = bodyPose("neutral"); pose[23].y += .3; pose[23].z += 1; pose[24].z -= 1;
  for (let i = 1; i <= 90; i++) solver.update(analyzePoseLandmarks(pose, pose, { timestamp: i * 16, detected: true }), i * 16);
  const delta = rig.bones.root.getWorldQuaternion(new THREE.Quaternion()).multiply(before.invert());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(delta);
  assert.ok(up.y > .999, "upright display stabilization must reject root pitch and roll");
});
