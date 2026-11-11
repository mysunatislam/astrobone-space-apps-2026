import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// X-ray bone overlay: the rigged Z-Anatomy skeleton (the same atlas the twin shows) drawn over the
// camera image. Every bone of the rig is attached rigidly to one joint, so each joint's bones are
// placed on the image by one rigid transform built from the MediaPipe pose, hand and face landmarks.
// It is a visual reference that follows the tracked landmarks, not a scan of the person's bones.

export const XRAY_LIMITS = "Atlas skeleton placed on the tracked landmarks. Not imaging, and not this person's own bones.";

const VISIBLE = 0.5;
const POSE = { nose: 0, eyeL: 2, eyeR: 5, earL: 7, earR: 8, mouthL: 9, mouthR: 10, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
  pinkyL: 17, pinkyR: 18, indexL: 19, indexR: 20, hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32 };
// Face mesh points that move with the skull, not the jaw: outer eye corners, nose bridge, base of the nose. Lips drive the jaw.
const FACE = { eyeOuterR: 33, eyeOuterL: 263, sellion: 168, subnasale: 2, upperLip: 13, lowerLip: 14 };
const SCALE_SEGMENTS = [[11, 12], [23, 24], [11, 23], [12, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);

// Where the face landmarks sit on this rig's skull (model units, +x = the subject's left, +z = front).
// Read off the Z-Anatomy skull and nasal cartilage in musculoskeletal-rigged.glb, with soft tissue depth added.
export const SKULL = {
  eyeCorner: v3(0.052, 0.873, 0.066), // outer eye corner, just inside the lateral orbital rim
  sellion: v3(0, 0.882, 0.09), // nose bridge over nasion
  subnasale: v3(0, 0.815, 0.105), // base of the nose, in front of the anterior nasal spine
  eyeCentre: v3(0.034, 0.872, 0.075),
  ear: v3(0.08, 0.855, -0.005),
  mouthCorner: v3(0.027, 0.798, 0.082),
  jawHinge: v3(0, 0.845, -0.006), // the mandible's condyle, in front of the ear
};

/** Orthonormal frame with Y along `axis` and X toward `side`; null when the two are (nearly) parallel. */
export function frameFromAxes(axis, side) {
  const y = axis.clone();
  if (y.lengthSq() < 1e-12) return null;
  y.normalize();
  const x = side.clone().addScaledVector(y, -side.dot(y));
  if (x.lengthSq() < 1e-6 * Math.max(1e-12, side.lengthSq())) return null;
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}

function rotationBetweenFrames(restAxis, restSide, targetAxis, targetSide) {
  const rest = frameFromAxes(restAxis, restSide), target = frameFromAxes(targetAxis, targetSide);
  if (!rest || !target) return null;
  return new THREE.Quaternion().setFromRotationMatrix(target.multiply(rest.transpose()));
}

/** Rotation that keeps the parent's twist and swings the rest axis onto the target axis. */
function swingFrom(parent, restAxis, targetAxis) {
  const from = restAxis.clone().applyQuaternion(parent).normalize(), to = targetAxis.clone().normalize();
  return new THREE.Quaternion().setFromUnitVectors(from, to).multiply(parent);
}

/** Model-space point `restAnchor` lands on `targetAnchor`; the bone is rotated and scaled about it. */
export function rigidPlacement(restAnchor, targetAnchor, rotation, scale) {
  const m = new THREE.Matrix4().compose(targetAnchor, rotation, v3(scale, scale, scale));
  return m.multiply(new THREE.Matrix4().makeTranslation(-restAnchor.x, -restAnchor.y, -restAnchor.z));
}

const visible = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= VISIBLE
  && p.x > -0.1 && p.x < 1.1 && p.y > -0.1 && p.y < 1.1;

/**
 * Pose image landmarks to overlay space: pixels, y up, z toward the camera. Depth comes from the metric
 * world landmarks scaled by the image's pixels per metre (image z is noisier); image z is the fallback.
 */
export function poseToOverlay(image, world, width, height) {
  if (!image?.length) return null;
  let pixels = 0, metres = 0;
  if (world?.length === image.length) {
    for (const [a, b] of SCALE_SEGMENTS) {
      if (!visible(image[a]) || !visible(image[b]) || !world[a] || !world[b]) continue;
      pixels += Math.hypot((image[a].x - image[b].x) * width, (image[a].y - image[b].y) * height);
      metres += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
    }
  }
  const pxPerMetre = metres > 0.05 ? pixels / metres : null;
  return image.map((p, i) => {
    const z = pxPerMetre && Number.isFinite(world[i]?.z) ? -world[i].z * pxPerMetre : -(p.z ?? 0) * width;
    return { point: v3(p.x * width, -p.y * height, z), visible: visible(p) };
  });
}

/** Pose points the head and the hands ride on between the (slower) face and hand detections. */
export function poseAnchors(P) {
  const pt = (i) => (P?.[i]?.visible ? P[i].point : null);
  const eyeL = pt(POSE.eyeL), eyeR = pt(POSE.eyeR);
  return { head: eyeL && eyeR ? mid(eyeL, eyeR) : null, L: pt(POSE.wrL), R: pt(POSE.wrR) };
}

/** Rest-pose measurements the placement needs; `joints` maps joint name (e.g. "upperarm01L") to its rest head. */
export function buildRestRig(joints) {
  const J = (name) => joints[name].clone();
  const hipMid = mid(J("upperleg01L"), J("upperleg01R")), shoulderMid = mid(J("upperarm01L"), J("upperarm01R"));
  return { joints, hipMid, shoulderMid, torsoUp: shoulderMid.clone().sub(hipMid) };
}

const SIDES = ["L", "R"];
const FINGERS = [1, 2, 3, 4, 5];
const flat = (shift) => (shift ? v3(shift.x, shift.y, 0) : null);

/**
 * Per-joint placement matrices (model space to overlay pixels) for one frame.
 * Joints whose landmarks are not visible are left out, so their bones are hidden.
 * `shift` ({ head, L, R } in overlay pixels) moves the face and hand landmarks by how far the pose
 * has travelled since they were detected.
 */
export function computeXrayPlacements(rest, { pose = null, world = null, hands = [], face = null, width, height, shift = null }) {
  const out = new Map();
  const J = (name) => rest.joints[name];
  const P = poseToOverlay(pose, world, width, height);
  const pt = (i) => (P?.[i]?.visible ? P[i].point : null);
  const put = (name, matrix) => { if (matrix) out.set(name, matrix); };

  // Torso: pelvis frame on the hips, rib frame on the shoulders; both share the hip-to-shoulder axis.
  const shL = pt(POSE.shL), shR = pt(POSE.shR), hipL = pt(POSE.hipL), hipR = pt(POSE.hipR);
  let rib = null, pelvis = null;
  if (shL && shR) {
    const shoulderMid = mid(shL, shR), shoulderSide = shL.clone().sub(shR);
    const restShoulderSide = J("upperarm01L").clone().sub(J("upperarm01R"));
    let up, scale;
    if (hipL && hipR) {
      up = shoulderMid.clone().sub(mid(hipL, hipR));
      scale = up.length() / rest.torsoUp.length();
    } else {
      // Upper body only (a webcam close-up): the torso is taken as upright in the shoulder plane.
      up = v3(-shoulderSide.y, shoulderSide.x, 0);
      if (up.y < 0) up.negate();
      scale = shoulderSide.length() / restShoulderSide.length();
    }
    const q = rotationBetweenFrames(rest.torsoUp, restShoulderSide, up, shoulderSide);
    if (q && scale > 0) {
      rib = { q, scale, m: rigidPlacement(rest.shoulderMid, shoulderMid, q, scale) };
      ["spine01", "clavicleL", "clavicleR"].forEach((name) => put(name, rib.m));
      if (hipL && hipR) {
        const restHipSide = J("upperleg01L").clone().sub(J("upperleg01R"));
        const pq = rotationBetweenFrames(rest.torsoUp, restHipSide, up, hipL.clone().sub(hipR));
        if (pq) {
          pelvis = { q: pq, scale, m: rigidPlacement(rest.hipMid, mid(hipL, hipR), pq, scale) };
          ["root", "spine05", "spine03"].forEach((name) => put(name, pelvis.m));
        }
      }
    }
  }

  const handsBySide = assignOverlayHands(hands, P, width, height);

  for (const S of SIDES) {
    const hand = handsBySide[S] ? handToOverlay(handsBySide[S].landmarks, width, height, flat(shift?.[S])) : null;
    const elbow = pt(POSE[`el${S}`]), poseWrist = pt(POSE[`wr${S}`]);
    // The hand model's wrist is the sharper of the two; it keeps the pose wrist's depth.
    const wrist = hand && elbow ? v3(hand[0].x, hand[0].y, (poseWrist ?? elbow).z) : poseWrist;
    let forearm = null;
    if (rib && elbow) {
      const restShoulder = J(`upperarm01${S}`), shoulder = restShoulder.clone().applyMatrix4(rib.m);
      const restAxis = J(`lowerarm01${S}`).clone().sub(restShoulder), axis = elbow.clone().sub(shoulder);
      const q = swingFrom(rib.q, restAxis, axis);
      put(`upperarm01${S}`, rigidPlacement(restShoulder, shoulder, q, axis.length() / restAxis.length()));
      if (wrist) {
        const restElbow = J(`lowerarm01${S}`), restForearm = J(`wrist${S}`).clone().sub(restElbow), forearmAxis = wrist.clone().sub(elbow);
        const fq = swingFrom(q, restForearm, forearmAxis), fscale = forearmAxis.length() / restForearm.length();
        put(`lowerarm01${S}`, rigidPlacement(restElbow, elbow, fq, fscale));
        forearm = { q: fq, scale: fscale };
      }
    }
    placeHand(out, rest, S, hand, { wrist: poseWrist, pinky: pt(POSE[`pinky${S}`]), index: pt(POSE[`index${S}`]), forearm });

    const knee = pt(POSE[`kn${S}`]), ankle = pt(POSE[`an${S}`]);
    if (pelvis && knee) {
      const restHip = J(`upperleg01${S}`), hip = restHip.clone().applyMatrix4(pelvis.m);
      const restAxis = J(`lowerleg01${S}`).clone().sub(restHip), axis = knee.clone().sub(hip);
      const q = swingFrom(pelvis.q, restAxis, axis);
      put(`upperleg01${S}`, rigidPlacement(restHip, hip, q, axis.length() / restAxis.length()));
      if (ankle) {
        const restKnee = J(`lowerleg01${S}`), restShin = J(`foot${S}`).clone().sub(restKnee), shin = ankle.clone().sub(knee);
        const sq = swingFrom(q, restShin, shin), sscale = shin.length() / restShin.length();
        put(`lowerleg01${S}`, rigidPlacement(restKnee, knee, sq, sscale));
        const toe = pt(POSE[`toe${S}`]);
        const restFoot = J(`toe3-1${S}`).clone().sub(J(`foot${S}`));
        const footQ = toe ? rotationBetweenFrames(restShin.clone().negate(), restFoot, shin.clone().negate(), toe.clone().sub(ankle)) : null;
        put(`foot${S}`, rigidPlacement(J(`foot${S}`), ankle, footQ ?? sq, sscale));
      }
    }
  }

  const head = placeHead(face, P, width, height, rib?.scale ?? null, flat(shift?.head));
  if (head) {
    put("head", head.m);
    put("jaw", head.jaw);
    if (rib) {
      // The neck bridges the rib frame and the skull, so the two always join on the image.
      const restNeck = J("neck01"), neck = restNeck.clone().applyMatrix4(rib.m);
      const restAxis = J("head").clone().sub(restNeck), axis = J("head").clone().applyMatrix4(head.m).sub(neck);
      // Face depth and pose depth have different origins: keep the rib frame's own lean in depth.
      axis.z = restAxis.clone().applyQuaternion(rib.q).z * rib.scale;
      const scale = THREE.MathUtils.clamp(axis.length() / restAxis.length(), rib.scale * 0.5, rib.scale * 1.8);
      put("neck01", rigidPlacement(restNeck, neck, swingFrom(rib.q, restAxis, axis), scale));
    }
  }
  return out;
}

function handToOverlay(landmarks, width, height, shift) {
  return landmarks.map((p) => {
    const point = v3(p.x * width, -p.y * height, -(p.z ?? 0) * width);
    return shift ? point.add(shift) : point;
  });
}

/** Each detected hand goes to a body side: the controller's label, else the nearest pose wrist. */
function assignOverlayHands(hands, P, width, height) {
  const bySide = { L: null, R: null };
  const wrists = SIDES.map((S) => ({ S, point: P?.[POSE[`wr${S}`]]?.visible ? P[POSE[`wr${S}`]].point : null })).filter((w) => w.point);
  const shL = P?.[POSE.shL]?.point, shR = P?.[POSE.shR]?.point, nose = P?.[POSE.nose]?.point;
  for (const hand of hands ?? []) {
    if (!hand?.landmarks || hand.landmarks.length < 21) continue;
    let S = hand.side === "left" ? "L" : hand.side === "right" ? "R" : null;
    const x = hand.landmarks[0].x * width, y = -hand.landmarks[0].y * height;
    if (!S && wrists.length) {
      const nearest = wrists.map((w) => ({ S: w.S, d: Math.hypot(w.point.x - x, w.point.y - y) })).sort((a, b) => a.d - b.d)[0];
      if (nearest.d < 0.2 * Math.max(width, height)) S = nearest.S;
    }
    if (!S) {
      // No wrist to go by: facing the camera, the person's left hand is on the image right; from behind it flips.
      const facing = shL && shR ? Math.sign(shL.x - shR.x) || 1 : 1;
      S = (x - (nose ? nose.x : width / 2)) * facing > 0 ? "L" : "R";
    }
    if (!bySide[S]) bySide[S] = hand;
  }
  return bySide;
}

function placeHand(out, rest, S, hand, poseHand) {
  const J = (name) => rest.joints[name];
  const restWrist = J(`wrist${S}`), restAxis = J(`finger3-1${S}`).clone().sub(restWrist);
  const restSide = J(`finger2-1${S}`).clone().sub(J(`finger5-1${S}`));
  if (hand) {
    const axis = hand[9].clone().sub(hand[0]), q = rotationBetweenFrames(restAxis, restSide, axis, hand[5].clone().sub(hand[17]));
    if (!q) return;
    const scale = axis.length() / restAxis.length();
    out.set(`wrist${S}`, rigidPlacement(restWrist, hand[0], q, scale));
    for (const f of FINGERS) {
      const base = 4 * f - 3;
      for (let k = 1; k <= 3; k++) {
        const restStart = J(`finger${f}-${k}${S}`), restBone = J(`finger${f}-${k + 1}${S}`).clone().sub(restStart);
        const start = hand[base + k - 1], bone = hand[base + k].clone().sub(start);
        const s = THREE.MathUtils.clamp(bone.length() / restBone.length(), scale * 0.6, scale * 1.6);
        out.set(`finger${f}-${k}${S}`, rigidPlacement(restStart, start, swingFrom(q, restBone, bone), s));
      }
    }
    return;
  }
  // Pose only: the hand follows the wrist, pinky and index points; the fingers keep their rest curl.
  if (!poseHand.wrist || !poseHand.forearm) return;
  let q = poseHand.forearm.q;
  if (poseHand.pinky && poseHand.index) {
    const axis = mid(poseHand.pinky, poseHand.index).sub(poseHand.wrist);
    // The pose model's index and pinky points are the knuckles.
    const restKnuckles = mid(J(`finger2-1${S}`), J(`finger5-1${S}`)).sub(restWrist);
    q = rotationBetweenFrames(restKnuckles, restSide, axis, poseHand.index.clone().sub(poseHand.pinky)) ?? q;
  }
  const m = rigidPlacement(restWrist, poseHand.wrist, q, poseHand.forearm.scale);
  out.set(`wrist${S}`, m);
  for (const f of FINGERS) for (let k = 1; k <= 3; k++) out.set(`finger${f}-${k}${S}`, m);
}

function placeHead(face, P, width, height, bodyScale, shift) {
  let anchor, restAnchor, side, up, restUp, scale, jawAngle = 0;
  if (face?.length >= 300) {
    const F = (i) => { const p = v3(face[i].x * width, -face[i].y * height, -(face[i].z ?? 0) * width); return shift ? p.add(shift) : p; };
    const eyeR = F(FACE.eyeOuterR), eyeL = F(FACE.eyeOuterL);
    anchor = mid(eyeL, eyeR); restAnchor = v3(0, SKULL.eyeCorner.y, SKULL.eyeCorner.z);
    side = eyeL.clone().sub(eyeR);
    up = F(FACE.sellion).sub(F(FACE.subnasale)); restUp = SKULL.sellion.clone().sub(SKULL.subnasale);
    const byWidth = side.length() / (2 * SKULL.eyeCorner.x), byHeight = up.length() / restUp.length();
    scale = THREE.MathUtils.clamp(Math.sqrt(byWidth * byHeight), byWidth * 0.88, byWidth * 1.12);
    const opening = F(FACE.upperLip).distanceTo(F(FACE.lowerLip)) / side.length();
    jawAngle = THREE.MathUtils.clamp((opening - 0.04) * 0.9, 0, 0.45);
  } else {
    const p = (i) => (P?.[i]?.visible ? P[i].point : null);
    const eyeL = p(POSE.eyeL), eyeR = p(POSE.eyeR), earL = p(POSE.earL), earR = p(POSE.earR), mL = p(POSE.mouthL), mR = p(POSE.mouthR);
    if (!eyeL || !eyeR || !mL || !mR) return null;
    anchor = mid(eyeL, eyeR); restAnchor = v3(0, SKULL.eyeCentre.y, SKULL.eyeCentre.z);
    const ears = Boolean(earL && earR);
    side = ears ? earL.clone().sub(earR) : eyeL.clone().sub(eyeR);
    scale = side.length() / (2 * (ears ? SKULL.ear.x : SKULL.eyeCentre.x));
    // Pose ear and eye points are coarse (and guessed from behind), so the skull stays in proportion to the torso.
    if (bodyScale) scale = THREE.MathUtils.clamp(scale, bodyScale * 0.95, bodyScale * 1.15);
    up = anchor.clone().sub(mid(mL, mR));
    restUp = v3(0, SKULL.eyeCentre.y - SKULL.mouthCorner.y, SKULL.eyeCentre.z - SKULL.mouthCorner.z);
  }
  const q = rotationBetweenFrames(restUp, v3(1, 0, 0), up, side);
  if (!q || !Number.isFinite(scale) || scale <= 0) return null;
  const m = rigidPlacement(restAnchor, anchor, q, scale), pivot = SKULL.jawHinge;
  const hinge = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationX(jawAngle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  return { m, jaw: m.clone().multiply(hinge), jawAngle };
}

// Same palette as the twin's bone layer (twinScene.js PALETTE.bone / boneRim). Output is premultiplied.
const VERTEX = /* glsl */`
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform vec3 uRim; uniform float uOpacity; uniform float uBody;
varying vec3 vN;
void main() {
  float facing = abs(normalize(vN).z);
  float rim = pow(1.0 - facing, 1.6);
  vec3 col = uColor * uBody * (0.14 + 0.42 * facing * facing * facing) + uRim * rim * 0.95;
  float alpha = clamp(uBody * 0.5 + 0.5 * rim, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha) * uOpacity;
}`;
const SHADE_FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor * uOpacity, uOpacity); }`;

const blend = (equation, dst) => ({ blending: THREE.CustomBlending, blendEquation: equation, blendSrc: THREE.OneFactor, blendDst: dst, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: dst });

/**
 * The bones are drawn three times: an even dark tint (which also records the surface nearest the camera),
 * then everything behind that surface as faint outlines (the see-through part), then the nearest surface
 * itself as translucent glowing bone, so a skull or a hand still reads as a shape.
 * Max blending keeps overlapping layers from stacking into a white blob.
 */
export function createXrayMaterials() {
  const glow = (opacity, body, depthFunc, blending) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xbfeeff) }, uRim: { value: new THREE.Color(0x7ad8ff) }, uOpacity: { value: opacity }, uBody: { value: body } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthTest: true, depthWrite: false, depthFunc, side: THREE.DoubleSide, ...blending,
  });
  return {
    shade: new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x061a2b) }, uOpacity: { value: 0.5 } },
      vertexShader: VERTEX, fragmentShader: SHADE_FRAGMENT,
      transparent: true, depthTest: true, depthWrite: true, side: THREE.DoubleSide, ...blend(THREE.MaxEquation, THREE.OneFactor),
    }),
    behind: glow(0.55, 0, THREE.GreaterDepth, blend(THREE.MaxEquation, THREE.OneFactor)),
    front: glow(1, 1, THREE.LessEqualDepth, blend(THREE.AddEquation, THREE.OneMinusSrcAlphaFactor)),
  };
}

const jointKey = (name) => name.replace(/[.\s]/g, "");

/** Splits the rigid-skinned bone mesh into one plain geometry per joint, in model (bind) space. */
export function splitBonesByJoint(skinnedMesh) {
  const geometry = skinnedMesh.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal;
  const skinIndex = geometry.attributes.skinIndex, bones = skinnedMesh.skeleton.bones;
  const index = geometry.index, count = index ? index.count : position.count;
  const triangles = new Map();
  for (let t = 0; t < count; t += 3) {
    const a = index ? index.getX(t) : t, j = skinIndex.getX(a);
    let list = triangles.get(j);
    if (!list) triangles.set(j, list = []);
    list.push(a, index ? index.getX(t + 1) : t + 1, index ? index.getX(t + 2) : t + 2);
  }
  const parts = new Map();
  for (const [j, list] of triangles) {
    const remap = new Map(), pos = [], nor = [], idx = new Uint32Array(list.length);
    list.forEach((v, i) => {
      let n = remap.get(v);
      if (n === undefined) {
        n = remap.size; remap.set(v, n);
        pos.push(position.getX(v), position.getY(v), position.getZ(v));
        nor.push(normal.getX(v), normal.getY(v), normal.getZ(v));
      }
      idx[i] = n;
    });
    const part = new THREE.BufferGeometry();
    part.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    part.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    part.setIndex(new THREE.BufferAttribute(idx, 1));
    parts.set(jointKey(bones[j].name), part);
  }
  return parts;
}

/** Rest joint heads in model space, keyed by joint name without dots ("upperarm01L"). */
export function restJointHeads(skinnedMesh) {
  const joints = {}, unbind = skinnedMesh.bindMatrix.clone().invert();
  skinnedMesh.skeleton.bones.forEach((bone, i) => {
    const head = skinnedMesh.skeleton.boneInverses[i].clone().invert().premultiply(unbind);
    joints[jointKey(bone.name)] = new THREE.Vector3().setFromMatrixPosition(head);
  });
  return joints;
}

const SMOOTH_MS = 70;
const anchorOf = (name) => (name === "head" || name === "jaw" ? "head" : /^(wrist|finger)/.test(name) ? name.at(-1) : null);

/**
 * Face and hand detections arrive a few times a second; the pose arrives every frame. The head and
 * the hands are therefore carried by their pose point (eyes, wrist) and only their shape and turn
 * are eased toward each new detection.
 */
export class DetailTracker {
  constructor() { this.history = []; this.state = new Map(); this.lastTime = null; }

  reset() { this.history.length = 0; this.state.clear(); this.lastTime = null; }

  /** Records the pose anchors of this frame and returns how far each has moved since `detailTime`. */
  shiftSince(anchors, time, detailTime) {
    if (!Number.isFinite(time)) return null;
    const last = this.history.at(-1);
    if (!last || time > last.time) this.history.push({ time, anchors });
    while (this.history.length && time - this.history[0].time > 1500) this.history.shift();
    if (!Number.isFinite(detailTime)) return null;
    let then = null;
    for (const entry of this.history) if (!then || Math.abs(entry.time - detailTime) < Math.abs(then.time - detailTime)) then = entry;
    if (!then || Math.abs(then.time - detailTime) > 400) return null;
    const shift = {};
    for (const key of ["head", "L", "R"]) {
      const a = anchors[key], b = then.anchors[key];
      shift[key] = a && b ? { x: a.x - b.x, y: a.y - b.y } : null;
    }
    return shift;
  }

  /** Eases head and hand placements relative to their pose anchor; other joints pass through. */
  smooth(placements, anchors, now) {
    const dt = this.lastTime === null ? Infinity : now - this.lastTime;
    this.lastTime = now;
    const blend = dt > 400 ? 1 : 1 - Math.exp(-Math.max(dt, 0) / SMOOTH_MS);
    const seen = new Set();
    for (const [name, matrix] of placements) {
      const key = anchorOf(name);
      if (!key) continue;
      seen.add(name);
      const anchor = anchors?.[key] ?? null;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      matrix.decompose(p, q, s);
      if (anchor) { p.x -= anchor.x; p.y -= anchor.y; }
      const prev = this.state.get(name);
      if (prev && prev.anchored === Boolean(anchor) && blend < 1) {
        prev.p.lerp(p, blend); prev.q.slerp(q, blend); prev.s.lerp(s, blend);
      } else this.state.set(name, { p, q, s, anchored: Boolean(anchor) });
      const cur = this.state.get(name), out = cur.p.clone();
      if (anchor) { out.x += anchor.x; out.y += anchor.y; }
      matrix.compose(out, cur.q, cur.s);
    }
    for (const name of [...this.state.keys()]) if (!seen.has(name)) this.state.delete(name);
    return placements;
  }
}

export class XrayBoneOverlay {
  /** `getBoneMesh` resolves to the rig's skinned bone mesh (three.js), loaded however the host page prefers. */
  constructor({ canvas, getBoneMesh, onState = () => {} }) {
    this.canvas = canvas;
    this.getBoneMesh = getBoneMesh;
    this.onState = onState;
    this.enabled = false;
    this.ready = false;
    this.failed = null;
    this.loading = null;
    this.meshes = new Map();
    this.rest = null;
    this.renderer = null;
    this.tracker = new DetailTracker();
    this.lastDrawn = 0;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.canvas) this.canvas.hidden = !this.enabled;
    if (!this.enabled) this.clear();
    this.onState(this.state());
  }

  state() { return !this.enabled ? "off" : this.failed ? "unavailable" : this.ready ? "on" : this.loading ? "loading" : "waiting"; }

  load() {
    if (this.loading) return this.loading;
    this.failed = null;
    this.loading = (async () => {
      const skinned = await this.getBoneMesh();
      if (!skinned?.isSkinnedMesh) throw new Error("The rigged skeleton has no bone mesh.");
      this.rest = buildRestRig(restJointHeads(skinned));
      const parts = splitBonesByJoint(skinned);
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x000000, 0);
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1e5, 1e5);
      const materials = createXrayMaterials();
      for (const [name, geometry] of parts) {
        const group = new THREE.Group();
        [materials.shade, materials.behind, materials.front].forEach((material, order) => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = order; mesh.frustumCulled = false;
          group.add(mesh);
        });
        group.matrixAutoUpdate = false;
        group.visible = false;
        this.meshes.set(name, group);
        this.scene.add(group);
      }
      this.ready = true;
    })();
    this.loading.then(() => this.onState(this.state()), (error) => {
      this.failed = error; this.onState(this.state());
      console.warn("X-ray bones could not load", error);
    });
    this.onState(this.state());
    return this.loading;
  }

  /**
   * Draws one frame; returns true when bones were drawn (the caller then skips its stick figure).
   * `timestamp` is the pose frame's time and `detailTimestamp` the face and hand frame's, on one clock.
   */
  render({ pose, world, hands, face, width, height, timestamp = null, detailTimestamp = null }) {
    if (!this.enabled || this.failed || !width || !height) return false;
    if (!this.ready) { if (!this.loading) this.load().catch(() => {}); return false; }
    // Small camera frames are drawn at up to three times their size, so fine bones stay sharp on screen.
    const shown = (this.canvas.clientWidth || width) * (globalThis.devicePixelRatio || 1);
    const sharp = THREE.MathUtils.clamp(Math.ceil(shown / width), 1, Math.max(1, Math.min(3, Math.floor(2200 / Math.max(width, height)))));
    if (this.canvas.width !== width * sharp || this.canvas.height !== height * sharp) this.renderer.setSize(width * sharp, height * sharp, false);
    this.camera.left = 0; this.camera.right = width; this.camera.top = 0; this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    const anchors = poseAnchors(poseToOverlay(pose, world, width, height));
    const shift = this.tracker.shiftSince(anchors, timestamp, detailTimestamp);
    const placements = computeXrayPlacements(this.rest, { pose, world, hands, face, width, height, shift });
    this.tracker.smooth(placements, anchors, performance.now());
    for (const [name, mesh] of this.meshes) {
      const matrix = placements.get(name);
      mesh.visible = Boolean(matrix);
      if (matrix) { mesh.matrix.copy(matrix); mesh.matrixWorldNeedsUpdate = true; }
    }
    this.renderer.render(this.scene, this.camera);
    this.lastDrawn = placements.size;
    return placements.size > 0;
  }

  clear() {
    this.tracker.reset();
    if (!this.renderer) return;
    for (const mesh of this.meshes.values()) mesh.visible = false;
    this.renderer.clear();
    this.lastDrawn = 0;
  }
}

/** Loads the rigged atlas and resolves to its bone mesh, for pages that do not already hold the model. */
export async function loadBoneMesh(url) {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return findBoneMesh(gltf.scene);
}

export function findBoneMesh(root) {
  let found = null;
  root.traverse((object) => { if (!found && object.isSkinnedMesh && /bone/i.test(object.name || "")) found = object; });
  return found;
}
