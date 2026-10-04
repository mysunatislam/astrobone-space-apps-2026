import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { bindHumanRig } from "./humanRig.js";
import { SkeletalRetargeter, cameraDirection } from "./skeletalRetargeter.js";
import { analyzePoseLandmarks } from "./functionalAssessment.js";
import { anatomicalCoverage } from "./anatomicalCoverage.js";
import { bodyPose } from "../scripts/fixtures/bodyPose.mjs";

async function load() {
  const bytes = await readFile(new URL("../public/models/anatomy/musculoskeletal-rigged.glb", import.meta.url));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const { bones, fingers } = bindHumanRig(scene), meshes = [];
  scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  scene.updateMatrixWorld(true);
  const neutral = bone => ({ quaternion: bone.quaternion.clone(), position: bone.position.clone(), scale: bone.scale.clone() });
  return { group: scene, bones, fingers, meshes, neutralPose: Object.fromEntries(Object.entries(bones).map(([key, bone]) => [key, neutral(bone)])), fingerNeutral: new Map(Object.values(fingers).flat(2).map(bone => [bone, neutral(bone)])) };
}
function vertex(mesh, index) { return mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld); }

test("anatomical GLB retains every reference structure and normalized 64-joint skinning", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/models/anatomy/rig-manifest.json", import.meta.url)));
  assert.equal(manifest.structures.length, 960);
  assert.equal(manifest.skeletalStructures, 277); assert.equal(manifest.muscularStructures, 683);
  assert.ok(manifest.structures.every(record => record.joints.length > 0));
  assert.equal(manifest.sourceRevision, "6c7f9016bd5899ac8edafd31b9900c151df42ed6");
  assert.deepEqual(manifest.structures.find(record => record.name === "Humerus.l").joints, ["upperarm01.L"]);
  assert.deepEqual(manifest.structures.find(record => record.name === "Femur.r").joints, ["upperleg01.R"]);
  assert.deepEqual(manifest.structures.find(record => record.name === "Mandible").joints, ["jaw"]);
  const rig = await load();
  assert.equal(rig.meshes.length, 2); assert.equal(rig.meshes[0].skeleton.bones.length, 64);
  assert.equal(Object.values(rig.fingers).flat(2).filter(Boolean).length, 30);
  const bounds = new THREE.Box3().setFromObject(rig.group), size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.y > 165 && size.y < 175 && size.x > 60 && size.x < 75, "preserve full atlas dimensions after dequantization");
  const source = await readFile(new URL("../public/models/anatomy/musculoskeletal.glb", import.meta.url));
  const original = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), "");
  const referenceBounds = new THREE.Box3().setFromObject(original.scene);
  assert.ok(bounds.min.distanceTo(referenceBounds.min) < .05 && bounds.max.distanceTo(referenceBounds.max) < .05, "rest-pose envelope must match the unrigged atlas within compression tolerance");
  for (const mesh of rig.meshes) {
    const { skinWeight, skinIndex, position } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i += 29) {
      const weights = new THREE.Vector4().fromBufferAttribute(skinWeight, i).toArray();
      assert.ok(weights.every(weight => Number.isFinite(weight) && weight >= 0));
      assert.ok(Math.abs(weights.reduce((a,b) => a+b, 0) - 1) < 1e-4);
      assert.ok(new THREE.Vector4().fromBufferAttribute(skinIndex, i).toArray().every(index => index >= 0 && index < 64));
      if (mesh.userData.anatomicalSystem === "bones") assert.equal(weights[0], 1);
      // Meshopt folds position dequantization into inverse bind matrices.
      assert.ok(vertex(mesh, i).toArray().every(Number.isFinite));
    }
  }
});

test("anatomical bones move rigidly while the muscle layer deforms with the same rig", async () => {
  const rig = await load();
  const bones = rig.meshes.find(mesh => mesh.userData.anatomicalSystem === "bones");
  const muscles = rig.meshes.find(mesh => mesh.userData.anatomicalSystem === "muscles");
  const index = bones.skeleton.bones.indexOf(rig.bones.leftArm);
  const points = [];
  for (let i = 0; i < bones.geometry.attributes.position.count; i++) if (bones.geometry.attributes.skinIndex.getX(i) === index) points.push(i);
  assert.ok(points.length > 100);
  const a = points[0], b = points[Math.floor(points.length / 2)], before = vertex(bones, a), length = before.distanceTo(vertex(bones, b));
  const muscleBefore = [];
  for (let i = 0; i < muscles.geometry.attributes.position.count; i += 233) muscleBefore.push([i, vertex(muscles, i)]);
  let trunkSamples = 0;
  for (const [i, point] of muscleBefore) {
    if (Math.abs(point.x) > 12 || point.y < 110 || point.y > 123) continue;
    trunkSamples++;
    const indices = new THREE.Vector4().fromBufferAttribute(muscles.geometry.attributes.skinIndex, i).toArray();
    const weights = new THREE.Vector4().fromBufferAttribute(muscles.geometry.attributes.skinWeight, i).toArray();
    for (let j = 0; j < 4; j++) if (weights[j] > .01) {
      assert.doesNotMatch(muscles.skeleton.bones[indices[j]].name, /upperarm|lowerarm|wrist|finger/, "lower thoracic muscle origins must not follow an adjacent arm");
    }
  }
  assert.ok(trunkSamples > 10);
  rig.bones.leftArm.rotation.z = 1.1; rig.group.updateMatrixWorld(true);
  assert.ok(before.distanceTo(vertex(bones, a)) > 1);
  assert.ok(Math.abs(length - vertex(bones, a).distanceTo(vertex(bones, b))) < .002, "rigid bone geometry must not stretch");
  let changed = 0;
  for (const [i, original] of muscleBefore) {
    const current = vertex(muscles, i);
    assert.ok(current.toArray().every(Number.isFinite) && current.length() < 250);
    if (current.distanceTo(original) > .2) changed++;
  }
  assert.ok(changed > 20, "muscle skinning must respond to the skeletal motion");
});

test("anatomical retargeting preserves side identity, finger detail, and tracking-loss hold", async () => {
  const rig = await load(), solver = new SkeletalRetargeter(rig); solver.begin(new THREE.Quaternion());
  let frame;
  for (let i=1;i<=90;i++) { frame = analyzePoseLandmarks(bodyPose("left-up"), bodyPose("left-up"), { timestamp: i*16, detected: true }); solver.update(frame, i*16); }
  for (const [start, end, channel] of [["leftArm", "leftForeArm", "leftArm"], ["rightArm", "rightForeArm", "rightArm"], ["leftLeg", "leftFoot", "leftLeg"]]) {
    const direction = rig.bones[end].getWorldPosition(new THREE.Vector3()).sub(rig.bones[start].getWorldPosition(new THREE.Vector3())).normalize();
    assert.ok(direction.dot(cameraDirection(frame.segments[channel].direction, new THREE.Quaternion())) > .98);
  }
  const finger = rig.fingers.left[1][0], fingerBefore = finger.quaternion.clone(), oppositeBefore = rig.fingers.right[1][0].quaternion.clone();
  const hand = Array.from({ length: 21 }, (_, i) => ({ x: .01 * i, y: -.01 * i, z: .003 * i }));
  frame.timestamp = 1500; frame.detailTimestamp = 1500; frame.detailHands = [{ side: "left", worldLandmarks: hand }]; frame.detailFace = { blendshapes: { jawOpen: .8 } };
  solver.update(frame, 1500);
  assert.ok(fingerBefore.angleTo(finger.quaternion) > .01);
  assert.ok(oppositeBefore.angleTo(rig.fingers.right[1][0].quaternion) < 1e-5);
  assert.ok(rig.bones.jaw.quaternion.angleTo(rig.neutralPose.jaw.quaternion) > .01);
  const pose = rig.meshes[0].skeleton.bones.map(bone => bone.quaternion.toArray());
  assert.equal(solver.update(frame, 2500).state, "lost");
  assert.deepEqual(rig.meshes[0].skeleton.bones.map(bone => bone.quaternion.toArray()), pose);
  const fingerHeld = finger.quaternion.clone(), jawHeld = rig.bones.jaw.quaternion.clone();
  frame.timestamp = 2600; frame.detailTimestamp = 4000;
  frame.detailHands[0].worldLandmarks = hand.map(point => ({x:-point.x,y:point.y,z:point.z}));
  frame.detailFace.blendshapes.jawOpen = 0;
  solver.update(frame, 2600);
  assert.ok(fingerHeld.angleTo(finger.quaternion) < 1e-5, "future finger packets must not animate the rig");
  assert.ok(jawHeld.angleTo(rig.bones.jaw.quaternion) < 1e-5, "future face packets must not animate the jaw");
});

test("anatomical coverage never turns coupled structures into measured muscle activity", () => {
  const frame = analyzePoseLandmarks(bodyPose("neutral"), bodyPose("neutral"), { timestamp: 1000, detected: true });
  const full = anatomicalCoverage(frame, 1050, true);
  assert.equal(full.body, 16); assert.equal(full.fingers, 0); assert.equal(full.jaw, false); assert.equal(full.muscleActivation, "not measured");
  assert.equal(anatomicalCoverage(frame, 2000, true).body, 0);
  assert.equal(anatomicalCoverage(frame, 1050, false).state, "reference");
  frame.detailTimestamp = 1000; frame.detailHands = [{ side: "left", worldLandmarks: Array.from({length:21}, (_, i) => ({x:i*.01,y:0,z:0})) }];
  assert.equal(anatomicalCoverage(frame, 1050, true).fingers, 15);
  frame.detailHands.push(frame.detailHands[0]);
  assert.equal(anatomicalCoverage(frame, 1050, true).fingers, 15, "duplicate handedness must not inflate coverage");
  frame.detailTimestamp = 2000;
  assert.equal(anatomicalCoverage(frame, 1050, true).fingers, 0, "future detail packets must be rejected");
  frame.detailTimestamp = 1000;
  frame.detailHands = [{ side: "left", worldLandmarks: Array.from({length:21}, () => ({x:0,y:0,z:0})) }];
  assert.equal(anatomicalCoverage(frame, 1050, true).fingers, 0, "collapsed landmarks do not measure finger directions");
  frame.detailTimestamp = -100;
  assert.equal(anatomicalCoverage(frame, 1050, true).fingers, 0);
});

test("visible knee bends even when the opposite foot invalidates the full-body assessment", async () => {
  const rig = await load(), solver = new SkeletalRetargeter(rig); solver.begin(new THREE.Quaternion());
  const points = bodyPose("knee-bend");
  points[31].visibility = .1;
  let frame;
  for (let i=1;i<=90;i++) {
    frame = analyzePoseLandmarks(points, points, {timestamp:i*16, detected:true});
    assert.equal(frame.usable, false);
    solver.update(frame, i*16);
  }
  const thigh = rig.bones.rightLeg.getWorldPosition(new THREE.Vector3()).sub(rig.bones.rightUpLeg.getWorldPosition(new THREE.Vector3())).normalize();
  const shin = rig.bones.rightFoot.getWorldPosition(new THREE.Vector3()).sub(rig.bones.rightLeg.getWorldPosition(new THREE.Vector3())).normalize();
  const bend = THREE.MathUtils.radToDeg(thigh.angleTo(shin));
  assert.ok(bend > 60, `a visible knee must bend, got ${bend.toFixed(1)} deg`);
  assert.ok(Math.abs(bend - (180-frame.angles.right.knee)) < 1);
  assert.ok(anatomicalCoverage(frame, 1440, true).observed.includes("rightLeg"));
  const held = rig.bones.rightLeg.quaternion.clone();
  points[28].visibility = .1;
  const hidden = analyzePoseLandmarks(points, points, {timestamp:1500, detected:true});
  solver.update(hidden, 1500);
  assert.ok(held.angleTo(rig.bones.rightLeg.quaternion) < 1e-5, "hidden ankle must hold its knee chain");
});

test("squat cycles keep leg twist stable, feet level and the stance grounded", async () => {
  const rig = await load(), solver = new SkeletalRetargeter(rig); solver.begin(new THREE.Quaternion());
  const restFoot = rig.bones.rightFoot.getWorldQuaternion(new THREE.Quaternion());
  const times = []; let frame, previous, maxStep = 0;
  for (let i=0;i<480;i++) {
    const flex = (1-Math.cos(i/60*Math.PI))/2;
    const points = bodyPose();
    for (const [hip,knee,ankle,heel,toe] of [[23,25,27,29,31],[24,26,28,30,32]]) {
      points[hip].y = .52 + flex*.15;
      points[knee].z = -flex*.18; points[knee].y = .72;
      points[ankle].y = .91;
      points[heel].y = points[toe].y = .94;
    }
    frame = analyzePoseLandmarks(points, points, {timestamp:16*(i+1),detected:true});
    solver.update(frame, frame.timestamp);
    const shin = rig.bones.rightLeg.getWorldQuaternion(new THREE.Quaternion());
    if (previous) maxStep = Math.max(maxStep,previous.angleTo(shin));
    previous = shin;
    if (i%120===0) times.push(shin.clone());
    assert.ok(Math.abs(solver.lowestFootHeight()-solver.floorHeight)<1e-4);
    const delta = rig.bones.rightFoot.getWorldQuaternion(new THREE.Quaternion()).multiply(restFoot.clone().invert());
    assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(delta).angleTo(new THREE.Vector3(0,1,0))<.04,
      "level heel/toe landmarks should retain a level reference sole");
  }
  assert.ok(maxStep < .2, `no leg-roll jump: ${maxStep}`);
  assert.ok(times[2].angleTo(times[3]) < .03, "repeated squats do not accumulate twist");
  const held = rig.bones.rightFoot.getWorldQuaternion(new THREE.Quaternion());
  const points = bodyPose("knee-bend"); points[30].visibility=.1; points[32].visibility=.1;
  for (let i=1;i<60;i++) solver.update(analyzePoseLandmarks(points,points,{timestamp:8000+i*16,detected:true}),8000+i*16);
  assert.ok(held.angleTo(rig.bones.rightFoot.getWorldQuaternion(new THREE.Quaternion()))<1e-5,
    "untracked foot is fixed in world orientation while the knee bends");
  assert.equal(solver.footStates.right,"fixed");
  assert.ok(!anatomicalCoverage(analyzePoseLandmarks(points),9000,true).observed.includes("rightFoot"));
  points[30].visibility=.99; points[32].visibility=.99; points[32].y=points[30].y-.2;
  for (let i=1;i<40;i++) solver.update(analyzePoseLandmarks(points,points,{timestamp:10000+i*16,detected:true}),10000+i*16);
  assert.equal(solver.footStates.right,"fixed","uncertain near-vertical foot must not produce a false tiptoe");
});

test("rear-view depth jitter cannot flip the waist or cross the anatomical leg chains", async () => {
  const rig=await load(), solver=new SkeletalRetargeter(rig); solver.begin(new THREE.Quaternion());
  let previous, maximumStep=0;
  for(let i=0;i<240;i++) {
    const points=bodyPose().map(point => ({...point,x:1-point.x,z:-point.z}));
    points[23].z += i%2 ? .003 : -.003;
    points[24].z -= i%2 ? .003 : -.003;
    const now=(i+1)*16, frame=analyzePoseLandmarks(points,points,{timestamp:now,detected:true});
    solver.update(frame,now);
    const root=rig.bones.root.getWorldQuaternion(new THREE.Quaternion());
    if(previous) maximumStep=Math.max(maximumStep,previous.angleTo(root));
    previous=root;
    assert.ok(Math.cos(solver.headingYaw)<-.98,"rear-facing pelvis must not clamp to a side view");
    if(i>30) {
      const leftHip=rig.bones.leftUpLeg.getWorldPosition(new THREE.Vector3());
      const rightHip=rig.bones.rightUpLeg.getWorldPosition(new THREE.Vector3());
      const leftFoot=rig.bones.leftFoot.getWorldPosition(new THREE.Vector3());
      const rightFoot=rig.bones.rightFoot.getWorldPosition(new THREE.Vector3());
      assert.ok(leftHip.x<rightHip.x && leftFoot.x<rightFoot.x,"hips and feet must preserve rear-view side ordering");
      assert.ok(solver.legPlanes.left.x<-.9 && solver.legPlanes.right.x<-.9,"leg roll shares the rear-facing body basis");
    }
  }
  assert.ok(maximumStep<.04,`rear-facing waist must not oscillate across +/-pi: ${maximumStep}`);
});
