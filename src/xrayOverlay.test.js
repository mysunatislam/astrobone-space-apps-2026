import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  SKULL, DetailTracker, buildRestRig, computeXrayPlacements, findBoneMesh, frameFromAxes, poseAnchors, poseToOverlay,
  restJointHeads, rigidPlacement, splitBonesByJoint,
} from "./xrayOverlay.js";

const WIDTH = 1000, HEIGHT = 1500, PX = 600; // image size and pixels per model unit of the synthetic camera
const CENTRE = { x: 500, y: -700 };

let cached = null;
async function rig() {
  if (cached) return cached;
  const bytes = await readFile(new URL("../public/models/anatomy/musculoskeletal-rigged.glb", import.meta.url));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const mesh = findBoneMesh(scene), joints = restJointHeads(mesh);
  return cached = { mesh, joints, rest: buildRestRig(joints) };
}

// A camera looking at the rig in its own rest pose: model x,y to pixels, model z to depth. `turn` spins the person about the vertical.
function project(point, turn = 0) {
  const p = point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
  return { x: (CENTRE.x + p.x * PX) / WIDTH, y: -(CENTRE.y + p.y * PX) / HEIGHT, z: -p.z * PX / WIDTH, visibility: 0.99 };
}
const mirror = (p) => new THREE.Vector3(-p.x, p.y, p.z);

function restPose(joints, turn = 0) {
  const image = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const set = (index, point) => {
    image[index] = project(point, turn);
    const p = point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    world[index] = { x: p.x, y: -p.y, z: -p.z, visibility: 0.99 }; // metres here = model units
  };
  const J = (name) => joints[name];
  set(0, new THREE.Vector3(0, 0.826, 0.128));
  set(2, SKULL.eyeCentre); set(5, mirror(SKULL.eyeCentre));
  set(7, SKULL.ear); set(8, mirror(SKULL.ear));
  set(9, SKULL.mouthCorner); set(10, mirror(SKULL.mouthCorner));
  set(11, J("upperarm01L")); set(12, J("upperarm01R"));
  set(13, J("lowerarm01L")); set(14, J("lowerarm01R"));
  set(15, J("wristL")); set(16, J("wristR"));
  set(17, J("finger5-1L")); set(18, J("finger5-1R"));
  set(19, J("finger2-1L")); set(20, J("finger2-1R"));
  set(23, J("upperleg01L")); set(24, J("upperleg01R"));
  set(25, J("lowerleg01L")); set(26, J("lowerleg01R"));
  set(27, J("footL")); set(28, J("footR"));
  set(31, J("toe3-1L")); set(32, J("toe3-1R"));
  return { image, world };
}

// MediaPipe hand order: wrist, then thumb, index, middle, ring and little finger, four points each.
function restHand(joints, S) {
  const points = [joints[`wrist${S}`]];
  for (let f = 1; f <= 5; f++) for (let k = 1; k <= 4; k++) points.push(joints[`finger${f}-${k}${S}`]);
  return points.map((p) => { const q = project(p); return { x: q.x, y: q.y, z: q.z }; });
}

const onImage = (matrix, point) => point.clone().applyMatrix4(matrix);
const expected = (point) => new THREE.Vector3(CENTRE.x + point.x * PX, CENTRE.y + point.y * PX, point.z * PX);
const close = (a, b, tolerance, label) => assert.ok(a.distanceTo(b) <= tolerance, `${label}: ${a.toArray().map((v) => v.toFixed(1))} vs ${b.toArray().map((v) => v.toFixed(1))}`);

test("frames and rigid placements are orthonormal and keep their anchor", () => {
  const frame = frameFromAxes(new THREE.Vector3(0.2, 2, 0.1), new THREE.Vector3(3, 0.4, -1));
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  frame.extractBasis(x, y, z);
  assert.ok(Math.abs(x.dot(y)) < 1e-9 && Math.abs(y.dot(z)) < 1e-9 && Math.abs(x.length() - 1) < 1e-9);
  assert.ok(Math.abs(frame.determinant() - 1) < 1e-9, "a rotation, not a mirror");
  assert.equal(frameFromAxes(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 0)), null);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const placed = rigidPlacement(new THREE.Vector3(1, 2, 3), new THREE.Vector3(100, 50, 0), q, 10);
  close(onImage(placed, new THREE.Vector3(1, 2, 3)), new THREE.Vector3(100, 50, 0), 1e-9, "anchor");
  close(onImage(placed, new THREE.Vector3(2, 2, 3)), new THREE.Vector3(100, 60, 0), 1e-9, "one unit along x turns to y and scales by ten");
});

test("the shipped rig splits into one rigid bone group per joint, and the skull landmarks sit on its skull", async () => {
  const { mesh, joints } = await rig();
  const parts = splitBonesByJoint(mesh);
  assert.equal(parts.size, 51);
  let triangles = 0;
  for (const part of parts.values()) triangles += part.index.count / 3;
  assert.equal(triangles, mesh.geometry.index.count / 3, "no bone triangle is lost or doubled");
  for (const name of ["head", "jaw", "neck01", "spine01", "root", "upperarm01L", "lowerarm01R", "wristL", "finger2-3R", "upperleg01L", "lowerleg01R", "footL"]) {
    assert.ok(parts.has(name), `bones for ${name}`);
    assert.ok(joints[name], `rest joint ${name}`);
  }
  const skull = new THREE.Box3().setFromBufferAttribute(parts.get("head").attributes.position)
    .union(new THREE.Box3().setFromBufferAttribute(parts.get("jaw").attributes.position)).expandByScalar(0.012);
  for (const [name, point] of Object.entries(SKULL)) assert.ok(skull.containsPoint(point), `${name} lies on the skull`);
  assert.ok(Math.abs(skull.getCenter(new THREE.Vector3()).x) < 0.005, "the skull is centred, so mirrored landmarks are valid");
});

test("a person standing in the rig's rest pose gets every bone placed on its own landmark", async () => {
  const { joints, rest } = await rig();
  const { image, world } = restPose(joints);
  const placements = computeXrayPlacements(rest, { pose: image, world, width: WIDTH, height: HEIGHT });
  assert.equal(placements.size, 51, "every bone group is drawn");
  for (const [name, matrix] of placements) {
    close(onImage(matrix, joints[name]), expected(joints[name]), 2.5, name);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    assert.ok(Math.abs(scale.x / PX - 1) < 0.06 && Math.abs(scale.x - scale.y) < 1e-6, `${name} keeps its size (${(scale.x / PX).toFixed(3)})`);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
    assert.ok(forward.z > 0.97, `${name} faces the camera (${forward.z.toFixed(3)})`);
  }
});

test("seen from behind, the skeleton turns its back to the camera", async () => {
  const { joints, rest } = await rig();
  const { image, world } = restPose(joints, Math.PI);
  const placements = computeXrayPlacements(rest, { pose: image, world, width: WIDTH, height: HEIGHT });
  for (const name of ["spine01", "root", "head", "upperleg01L", "lowerarm01R"]) {
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(placements.get(name));
    assert.ok(forward.z < -0.97, `${name} faces away (${forward.z.toFixed(3)})`);
  }
  // The person's left shoulder is now on the image left, and the left humerus is drawn there.
  assert.ok(onImage(placements.get("upperarm01L"), joints.upperarm01L).x < CENTRE.x);
});

test("bones whose landmarks are not visible are left out", async () => {
  const { joints, rest } = await rig();
  const { image, world } = restPose(joints);
  for (let i = 23; i < 33; i++) image[i].visibility = 0.05; // a webcam close-up: nothing below the chest
  image[16].visibility = 0.1; image[18].visibility = 0.1; image[20].visibility = 0.1; // right wrist out of view
  const placements = computeXrayPlacements(rest, { pose: image, world, width: WIDTH, height: HEIGHT });
  for (const name of ["root", "spine05", "upperleg01L", "lowerleg01R", "footL", "lowerarm01R", "wristR", "finger2-1R"]) assert.equal(placements.has(name), false, name);
  for (const name of ["spine01", "clavicleL", "head", "jaw", "neck01", "upperarm01L", "lowerarm01L", "wristL", "upperarm01R"]) assert.ok(placements.has(name), name);
  close(onImage(placements.get("spine01"), joints.upperarm01L), expected(joints.upperarm01L), 3, "ribs stay on the shoulders without hips");
  assert.equal(computeXrayPlacements(rest, { pose: null, width: WIDTH, height: HEIGHT }).size, 0);
});

test("a detected hand drives each finger bone, on the side of the nearest wrist", async () => {
  const { joints, rest } = await rig();
  const { image, world } = restPose(joints);
  const hand = restHand(joints, "L");
  const flat = computeXrayPlacements(rest, { pose: image, world, hands: [{ landmarks: hand, side: null }], width: WIDTH, height: HEIGHT });
  for (const name of ["wristL", "finger1-2L", "finger2-1L", "finger2-3L", "finger5-3L"]) close(onImage(flat.get(name), joints[name]), expected(joints[name]), 1.5, name);
  close(onImage(flat.get("finger2-3L"), joints["finger2-4L"]), expected(joints["finger2-4L"]), 1.5, "index fingertip");
  // Curl the index finger: its last two points move toward the camera.
  const curled = hand.map((p) => ({ ...p }));
  curled[7].z -= 0.02; curled[8].z -= 0.05; curled[8].y -= 0.01;
  const bent = computeXrayPlacements(rest, { pose: image, world, hands: [{ landmarks: curled, side: null }], width: WIDTH, height: HEIGHT });
  const turned = (name) => new THREE.Vector3(0, 0, 1).transformDirection(bent.get(name)).angleTo(new THREE.Vector3(0, 0, 1).transformDirection(flat.get(name)));
  assert.ok(turned("finger2-3L") > 0.3, "the index fingertip bone turns");
  assert.ok(turned("finger3-3L") < 1e-6 && turned("wristL") < 1e-6, "the other fingers and the palm stay");
  // The right hand keeps its pose-only placement: rigid with the wrist.
  assert.deepEqual(flat.get("finger2-2R").elements, flat.get("wristR").elements);
  // A hand the controller labelled "right" is not moved to the left arm, however close it is.
  const labelled = computeXrayPlacements(rest, { pose: image, world, hands: [{ landmarks: restHand(joints, "R"), side: "right" }], width: WIDTH, height: HEIGHT });
  close(onImage(labelled.get("finger2-3R"), joints["finger2-3R"]), expected(joints["finger2-3R"]), 1.5, "right index");
});

test("the face mesh places the skull and opens the jaw with the lips", async () => {
  const { joints, rest } = await rig();
  const { image, world } = restPose(joints);
  const face = (gap) => {
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const set = (index, point) => { const p = project(point); points[index] = { x: p.x, y: p.y, z: p.z }; };
    set(263, SKULL.eyeCorner); set(33, mirror(SKULL.eyeCorner)); set(168, SKULL.sellion); set(2, SKULL.subnasale);
    set(13, new THREE.Vector3(0, 0.8, 0.1)); set(14, new THREE.Vector3(0, 0.8 - gap, 0.1));
    return points;
  };
  const closed = computeXrayPlacements(rest, { pose: image, world, face: face(0), width: WIDTH, height: HEIGHT });
  close(onImage(closed.get("head"), SKULL.eyeCorner), expected(SKULL.eyeCorner), 1.5, "outer eye corner");
  close(onImage(closed.get("head"), SKULL.subnasale), expected(SKULL.subnasale), 1.5, "base of the nose");
  assert.deepEqual(closed.get("jaw").elements, closed.get("head").elements, "closed lips: the jaw stays with the skull");
  const open = computeXrayPlacements(rest, { pose: image, world, face: face(0.04), width: WIDTH, height: HEIGHT });
  const chin = new THREE.Vector3(0, 0.76, 0.08);
  const drop = onImage(closed.get("jaw"), chin).y - onImage(open.get("jaw"), chin).y;
  assert.ok(drop > 5 && drop < 40, `the chin drops (${drop.toFixed(1)} px)`);
  close(onImage(open.get("jaw"), SKULL.jawHinge), onImage(open.get("head"), SKULL.jawHinge), 1e-6, "the hinge stays in its socket");
  assert.deepEqual(open.get("head").elements, closed.get("head").elements, "the skull does not nod when the mouth opens");
  // The neck still joins the ribs to the skull.
  close(onImage(open.get("neck01"), joints.neck01), onImage(open.get("spine01"), joints.neck01), 1e-6, "neck base");
});

test("between detections the head and hands ride on the pose, and ease to each new detection", async () => {
  const { joints, rest } = await rig();
  const tracker = new DetailTracker();
  const anchorsAt = (dx) => {
    const { image, world } = restPose(joints);
    for (const p of image) p.x += dx / WIDTH;
    return poseAnchors(poseToOverlay(image, world, WIDTH, HEIGHT));
  };
  assert.equal(tracker.shiftSince(anchorsAt(0), 1000, null), null);
  tracker.shiftSince(anchorsAt(10), 1033, 1000);
  const shift = tracker.shiftSince(anchorsAt(40), 1100, 1000);
  assert.ok(Math.abs(shift.head.x - 40) < 1e-6 && Math.abs(shift.L.x - 40) < 1e-6 && Math.abs(shift.R.y) < 1e-6, "the body moved 40 px since the face was seen");
  assert.equal(tracker.shiftSince(anchorsAt(40), 1133, 100), null, "a detection older than the history is not carried");

  // The shifted landmarks land the skull where the head is now.
  const { image, world } = restPose(joints);
  const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [index, point] of [[263, SKULL.eyeCorner], [33, mirror(SKULL.eyeCorner)], [168, SKULL.sellion], [2, SKULL.subnasale]]) { const p = project(point); face[index] = { x: p.x, y: p.y, z: p.z }; }
  const moved = computeXrayPlacements(rest, { pose: image, world, face, width: WIDTH, height: HEIGHT, shift: { head: { x: 40, y: -5 }, L: null, R: null } });
  close(onImage(moved.get("head"), SKULL.sellion), expected(SKULL.sellion).add(new THREE.Vector3(40, -5, 0)), 1.5, "carried skull");

  // Smoothing: a turn is eased, a move of the anchor is followed at once.
  const smoother = new DetailTracker();
  const placed = (angle, x) => new Map([["head", new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle), new THREE.Vector3(1, 1, 1))],
    ["spine01", new THREE.Matrix4().makeTranslation(x, 0, 0)]]);
  smoother.smooth(placed(0, 0), { head: new THREE.Vector3(0, 0, 0) }, 0);
  const eased = smoother.smooth(placed(1, 100), { head: new THREE.Vector3(100, 0, 0) }, 33);
  const position = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3();
  eased.get("head").decompose(position, turn, size);
  assert.ok(Math.abs(position.x - 100) < 1e-6, "the skull stays on the moving head");
  const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
  assert.ok(angle > 0.2 && angle < 0.6, `the turn is eased (${angle.toFixed(2)} of 1 rad after 33 ms)`);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(eased.get("spine01")).x, 100, "pose-driven bones pass through");
});
