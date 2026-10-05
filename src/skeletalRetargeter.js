import * as THREE from "three";
import { HAND_LANDMARK_CHAINS } from "./humanRig.js";

export const LIVE_BONE_CHAIN = Object.freeze([
  ["spine", "spine1", "spine"],
  ["spine1", "torso", "spine"],
  ["torso", "neck", "spine"],
  ["neck", "head", "neck"],
  ["head", "headTop", "neck"],
  ["leftShoulder", "leftArm", "leftShoulder"],
  ["rightShoulder", "rightArm", "rightShoulder"],
  ["leftArm", "leftForeArm", "leftArm"],
  ["rightArm", "rightForeArm", "rightArm"],
  ["leftForeArm", "leftHand", "leftForeArm"],
  ["rightForeArm", "rightHand", "rightForeArm"],
  ["leftHand", "leftHandIndex", "leftHand"],
  ["rightHand", "rightHandIndex", "rightHand"],
  ["leftUpLeg", "leftLeg", "leftUpLeg"],
  ["rightUpLeg", "rightLeg", "rightUpLeg"],
  ["leftLeg", "leftFoot", "leftLeg"],
  ["rightLeg", "rightFoot", "rightLeg"],
  ["leftFoot", "leftToeBase", "leftFoot"],
  ["rightFoot", "rightToeBase", "rightFoot"],
]);

export function canRetargetSegment(frame, key) {
  const segment = frame?.segments?.[key];
  if (!segment?.usable || !segment.direction) return false;
  if (key === "spine") return Boolean(frame.usable && segment.direction.y < -.2);
  if (key === "neck") return segment.direction.y < -.2;
  const leg = /^(left|right)(UpLeg|Leg|Foot)$/.exec(key);
  if (!leg) return true;
  // A complete same-side hip/knee/ankle chain can animate independently of the
  // bilateral clinical-assessment gate. Offscreen visibility is capped upstream.
  const side = leg[1];
  if (leg[2] === "Foot") {
    if (![`${side}Heel`, `${side}Foot`].every(name => frame.points?.[name]?.visibility >= .65)) return false;
    const heel = frame.points[`${side}Heel`], toe = frame.points[`${side}Foot`];
    const length = Math.hypot(toe.x-heel.x, toe.y-heel.y, toe.z-heel.z);
    // Monocular depth can produce near-vertical feet despite high confidence.
    // The upright display holds its last trusted sole rather than inventing a tiptoe.
    if (length < .04 || Math.abs(toe.y-heel.y) / length > Math.sin(35*Math.PI/180)) return false;
  }
  return [`${side}UpLeg`, `${side}Leg`].every(name => {
    const part = frame.segments[name];
    return part?.usable && part.direction;
  });
}

export function hasLiveSegments(frame, now = frame?.timestamp) {
  return Boolean(frame?.detected !== false && frame?.segments
    && Number.isFinite(frame.timestamp) && Number.isFinite(now)
    && now - frame.timestamp >= -50 && now - frame.timestamp < 750
    && Object.values(frame.segments).some((segment) => segment?.usable && segment.direction));
}

// Pose coordinates are unmirrored camera coordinates; mirroring belongs to display only.
export function cameraDirection(direction, viewRotation, target = new THREE.Vector3()) {
  return target.set(direction.x, -direction.y, -direction.z)
    .applyQuaternion(viewRotation).normalize();
}

export function fitTrackedRigInView(camera, target, bones) {
  const rotation = camera.getWorldQuaternion(new THREE.Quaternion());
  const inverse = rotation.clone().invert();
  const point = new THREE.Vector3();
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = camera.position.distanceTo(target);
  for (const bone of bones) {
    bone.getWorldPosition(point).sub(target).applyQuaternion(inverse);
    // Keep hands and feet clear of the viewport labels, including on narrow phones.
    distance = Math.max(distance, point.z + Math.max(
      Math.abs(point.x) / (tangent * camera.aspect * 0.82),
      Math.abs(point.y) / (tangent * 0.7),
    ));
  }
  camera.position.copy(target).add(new THREE.Vector3(0, 0, distance).applyQuaternion(rotation));
  camera.updateMatrixWorld();
}

export class SkeletalRetargeter {
  constructor(rig) {
    this.rig = rig;
    this.viewRotation = new THREE.Quaternion();
    this.active = false;
    this.lastTime = null;
    this.rootReference = null;
    this.bindings = new Map();
    this.legPlanes = {};
    this.footWorld = {};
    this.footStates = {};
    this.floorHeight = null;
    this.headingYaw = null;
    this.bodyOrientation = new THREE.Quaternion();
    this.scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      current: new THREE.Vector3(), desired: new THREE.Vector3(),
      delta: new THREE.Quaternion(), world: new THREE.Quaternion(),
      parent: new THREE.Quaternion(), target: new THREE.Quaternion(),
    };
  }

  kneeFlexion(frame) {
    const result = { left: null, right: null };
    for (const side of ["left", "right"]) {
      if (!canRetargetSegment(frame, `${side}Leg`)) continue;
      const hip = this.rig.bones[`${side}UpLeg`], knee = this.rig.bones[`${side}Leg`], ankle = this.rig.bones[`${side}Foot`];
      if (!hip || !knee || !ankle) continue;
      const a = knee.getWorldPosition(new THREE.Vector3()).sub(hip.getWorldPosition(new THREE.Vector3()));
      const b = ankle.getWorldPosition(new THREE.Vector3()).sub(knee.getWorldPosition(new THREE.Vector3()));
      if (a.lengthSq() > 1e-10 && b.lengthSq() > 1e-10) result[side] = THREE.MathUtils.radToDeg(a.angleTo(b));
    }
    return result;
  }

  // Seconds for bones to close ~63 % of the gap to the tracked pose. Live camera poses are noisy and
  // need more; synchronized video poses are already smoothed without lag and need less.
  timeConstant = 0.032;

  begin(viewRotation) {
    this.viewRotation.copy(viewRotation);
    this.active = true;
    this.lastTime = null;
    this.rootReference = null;
    this.legPlanes = {}; this.footWorld = {}; this.footStates = {};
    this.headingYaw = null; this.bodyOrientation.copy(viewRotation);
    for (const [key, pose] of Object.entries(this.rig.neutralPose)) {
      const bone = this.rig.bones[key];
      if (!bone) continue;
      bone.quaternion.copy(pose.quaternion);
      bone.position.copy(pose.position);
      bone.scale.copy(pose.scale);
    }
    for (const [bone, pose] of this.rig.fingerNeutral ?? []) {
      bone.quaternion.copy(pose.quaternion);
      bone.position.copy(pose.position);
      bone.scale.copy(pose.scale);
    }
    this.rig.group.updateMatrixWorld(true);
    this.bindings.clear();
    for (const [key, childKey] of LIVE_BONE_CHAIN) {
      const bone = this.rig.bones[key];
      this.bindAim(bone, this.rig.bones[childKey]);
      if (/^(left|right)Foot$/.test(key) && this.bindings.has(bone)) {
        const bind = this.bindings.get(bone);
        const forward = bind.axis.clone().applyQuaternion(bind.world); forward.y = 0; forward.normalize();
        bind.planeInverse = axisBasis(forward, new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)))?.invert();
      }
    }
    for (const chains of Object.values(this.rig.fingers ?? {})) for (const chain of chains) {
      chain.forEach((bone, i) => this.bindAim(bone, chain[i + 1] ?? bone?.children.find(child => child.isBone)));
    }
    const { root, leftUpLeg, rightUpLeg, torso } = this.rig.bones;
    if (root && leftUpLeg && rightUpLeg && torso) {
      const lateral = leftUpLeg.getWorldPosition(new THREE.Vector3())
        .sub(rightUpLeg.getWorldPosition(new THREE.Vector3()));
      const up = torso.getWorldPosition(new THREE.Vector3())
        .sub(root.getWorldPosition(new THREE.Vector3()));
      const basis = orientationBasis(lateral, up);
      if (basis) {
        this.rootReference = {
          basisInverse: basis.invert(),
          world: root.getWorldQuaternion(new THREE.Quaternion()),
        };
        this.orientRoot(this.viewRotation, 1);
      }
    }
    for (const side of ["left", "right"]) {
      const foot = this.rig.bones[`${side}Foot`];
      if (foot?.parent && this.bindings.has(foot)) {
        this.footWorld[side] = this.viewRotation.clone().multiply(this.bindings.get(foot).world);
        foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.footWorld[side]));
        foot.updateMatrixWorld(true);
      }
    }
    this.floorHeight = this.lowestFootHeight();
  }

  end() {
    if (this.active) {
      for (const [bone, pose] of this.rig.fingerNeutral ?? []) bone.quaternion.copy(pose.quaternion);
      if (this.rig.bones.jaw && this.rig.neutralPose.jaw) {
        this.rig.bones.jaw.quaternion.copy(this.rig.neutralPose.jaw.quaternion);
      }
    }
    this.active = false;
    this.lastTime = null;
  }

  update(frame, now) {
    if (!this.active) return { trackedBones: 0, state: "waiting" };
    const dt = this.lastTime === null ? 1 / 30
      : THREE.MathUtils.clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now;
    if (!hasLiveSegments(frame, now)) return { trackedBones: 0, state: "lost" };
    const alpha = 1 - Math.exp(-dt / this.timeConstant);
    const points = frame.points;
    if (frame.usable && points?.leftHip?.visibility >= 0.56 && points?.rightHip?.visibility >= 0.56
      && frame.segments.spine?.usable) {
      const lateral = cameraDirection({
        x: points.leftHip.x - points.rightHip.x,
        y: points.leftHip.y - points.rightHip.y,
        z: points.leftHip.z - points.rightHip.z,
      }, new THREE.Quaternion());
      // Unwrap the heading: a rear view near +/-pi is one orientation, not two
      // opposite clamped angles. Stabilization affects the display, not measurements.
      const yaw = Math.atan2(-lateral.z, lateral.x);
      const firstHeading = this.headingYaw === null;
      if (firstHeading) this.headingYaw = yaw;
      else {
        const difference = Math.atan2(Math.sin(yaw-this.headingYaw), Math.cos(yaw-this.headingYaw));
        const limit = THREE.MathUtils.degToRad(120) * dt;
        this.headingYaw += THREE.MathUtils.clamp(difference * (1-Math.exp(-dt/.12)), -limit, limit);
      }
      this.bodyOrientation.copy(this.viewRotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.headingYaw));
      this.orientRoot(this.bodyOrientation, 1);
      if (firstHeading) for (const side of ["left", "right"]) {
        const foot = this.rig.bones[`${side}Foot`], bind = this.bindings.get(foot);
        if (bind && this.footWorld[side]) this.footWorld[side].copy(this.bodyOrientation).multiply(bind.world);
      }
    }
    let trackedBones = 0;
    this.rig.group.updateMatrixWorld(true);
    const planes = this.getLegPlanes(frame, alpha);
    for (const [key, childKey, segmentKey] of LIVE_BONE_CHAIN) {
      if (/^(left|right)Foot$/.test(key)) continue;
      if (!canRetargetSegment(frame, segmentKey)) continue;
      const segment = frame.segments[segmentKey];
      const leg = /^(left|right)(UpLeg|Leg)$/.exec(key);
      const moved = leg ? this.aimPlane(this.rig.bones[key], cameraDirection(segment.direction, this.viewRotation), planes[leg[1]], alpha)
        : this.aim(this.rig.bones[key], this.rig.bones[childKey], segment, alpha);
      if (moved) {
        trackedBones++;
      }
    }
    for (const side of ["left", "right"]) if (this.updateFoot(frame, side, alpha)) trackedBones++;
    // A display ground reference lowers the pelvis during a squat instead of
    // lifting the whole stance. It is not an inferred floor/contact-force measurement.
    const root = this.rig.bones.root;
    if (root?.parent && ["leftLeg", "rightLeg"].some(key => canRetargetSegment(frame, key))) {
      const height = this.lowestFootHeight();
      if (Number.isFinite(height) && Number.isFinite(this.floorHeight)) {
        const position = root.getWorldPosition(new THREE.Vector3());
        position.y += this.floorHeight - height;
        root.position.copy(root.parent.worldToLocal(position));
        root.updateMatrixWorld(true);
      }
    }
    if (Number.isFinite(frame.detailTimestamp) && now - frame.detailTimestamp >= -50 && now - frame.detailTimestamp < 900) {
      trackedBones += this.updateHands(frame.detailHands ?? [], alpha);
      this.updateJaw(frame.detailFace, alpha);
    }
    return { trackedBones, state: frame.usable ? "live" : "partial", kneeFlexion: this.kneeFlexion(frame),
      bodyHeadingRadians: this.headingYaw, feet: {...this.footStates} };
  }

  lowestFootHeight() {
    const bones = ["leftFoot", "leftToeBase", "rightFoot", "rightToeBase"].map(key => this.rig.bones[key]).filter(Boolean);
    return bones.length ? Math.min(...bones.map(bone => bone.getWorldPosition(new THREE.Vector3()).y)) : null;
  }

  getLegPlanes(frame, alpha) {
    const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(this.bodyOrientation);
    for (const side of ["left", "right"]) {
      if (!canRetargetSegment(frame, `${side}Leg`)) continue;
      const thigh = cameraDirection(frame.segments[`${side}UpLeg`].direction, this.viewRotation);
      const shin = cameraDirection(frame.segments[`${side}Leg`].direction, this.viewRotation);
      const normal = new THREE.Vector3().crossVectors(thigh, shin);
      const previous = this.legPlanes[side] ?? lateral;
      // Near extension the bend plane is undefined: retain its last stable side.
      if (normal.length() < .15) normal.copy(previous);
      else { normal.normalize(); if (normal.dot(previous) < 0) normal.negate(); }
      this.legPlanes[side] = previous.clone().lerp(normal, alpha * .4).normalize();
    }
    return this.legPlanes;
  }

  aimPlane(bone, direction, normal, alpha) {
    const bind = this.bindings.get(bone);
    if (!bone?.parent || !bind?.planeInverse || !normal) return false;
    const basis = axisBasis(direction, normal);
    if (!basis) return false;
    const world = basis.multiply(bind.planeInverse).multiply(bind.world);
    const target = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world);
    bone.quaternion.slerp(target.normalize(), alpha);
    bone.updateMatrixWorld(true);
    return true;
  }

  updateFoot(frame, side, alpha) {
    const foot = this.rig.bones[`${side}Foot`];
    if (!foot?.parent || !this.footWorld[side]) return false;
    const tracked = canRetargetSegment(frame, `${side}Foot`);
    const heel = frame.points?.[`${side}Heel`], toe = frame.points?.[`${side}Foot`];
    if (tracked && heel && toe) {
      const direction = cameraDirection({x:toe.x-heel.x,y:toe.y-heel.y,z:toe.z-heel.z}, this.viewRotation);
      // Heel-to-toe, not ankle-to-toe: ankle height must not create false tiptoes.
      const up = new THREE.Vector3(0, 1, 0);
      const lateral = new THREE.Vector3().crossVectors(direction, up).normalize();
      const bind = this.bindings.get(foot), basis = axisBasis(direction, lateral);
      if (lateral.lengthSq() > .5 && basis && bind?.planeInverse) {
        const target = basis.multiply(bind.planeInverse).multiply(bind.world);
        // Smooth in world space so shin rotation cannot transiently pitch the sole.
        this.footWorld[side].slerp(target, alpha);
        foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.footWorld[side]));
        foot.updateMatrixWorld(true);
        this.footStates[side] = "tracked";
        return true;
      }
    }
    // Hold world orientation, not local rotation inherited from a bending shin.
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.footWorld[side]));
    foot.updateMatrixWorld(true);
    this.footStates[side] = "fixed";
    return false;
  }

  updateHands(hands, alpha) {
    let tracked = 0;
    const seen = new Set();
    for (const hand of hands) {
      if (!["left", "right"].includes(hand.side) || seen.has(hand.side)) continue;
      const chains = this.rig.fingers?.[hand.side];
      const points = hand.worldLandmarks;
      if (!chains || !Array.isArray(points) || points.length < 21) continue;
      seen.add(hand.side);
      for (let finger = 0; finger < HAND_LANDMARK_CHAINS.length; finger++) {
        const landmarkChain = HAND_LANDMARK_CHAINS[finger];
        const bones = chains[finger] ?? [];
        for (let segment = 0; segment < 3; segment++) {
          const from = points[landmarkChain[segment]];
          const to = points[landmarkChain[segment + 1]];
          if (!from || !to) continue;
          const direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
          if (!Object.values(direction).every(Number.isFinite)
            || Math.hypot(direction.x, direction.y, direction.z) < 1e-6) continue;
          const bone = bones[segment];
          if (!bone) continue;
          const data = { direction, visibility: 0.9 };
          if (segment < 2
            ? this.aim(bone, bones[segment + 1], data, alpha)
            : this.aimLocalAxis(bone, data, alpha)) tracked++;
        }
      }
    }
    return tracked;
  }

  updateJaw(face, alpha) {
    const jaw = this.rig.bones.jaw;
    const neutral = this.rig.neutralPose.jaw;
    const score = face?.blendshapes?.jawOpen;
    if (!jaw || !neutral || !Number.isFinite(score)) return;
    const target = neutral.quaternion.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0),
        THREE.MathUtils.clamp(score, 0, 1) * 0.23),
    );
    jaw.quaternion.slerp(target, alpha);
    jaw.updateMatrixWorld(true);
  }

  orientRoot(basis, alpha) {
    const root = this.rig.bones.root;
    if (!root?.parent || !this.rootReference) return;
    const target = basis.clone().multiply(this.rootReference.basisInverse)
      .multiply(this.rootReference.world);
    const parent = root.parent.getWorldQuaternion(new THREE.Quaternion());
    root.quaternion.slerp(parent.invert().multiply(target).normalize(), alpha);
    root.updateMatrixWorld(true);
  }

  aim(bone, child, segment, alpha) {
    if (!bone?.parent || !child) return false;
    const s = this.scratch;
    if (!this.stableTarget(bone, segment)) return false;
    const confidence = THREE.MathUtils.clamp((segment.visibility - 0.4) / 0.55, 0.2, 1);
    bone.quaternion.slerp(s.target, alpha * confidence);
    bone.updateMatrixWorld(true);
    return true;
  }

  aimLocalAxis(bone, segment, alpha) {
    if (!bone?.parent) return false;
    const s = this.scratch;
    if (!this.stableTarget(bone, segment)) return false;
    bone.quaternion.slerp(s.target, alpha * 0.9);
    bone.updateMatrixWorld(true);
    return true;
  }
  bindAim(bone, child) {
    if (!bone) return;
    const axis = child ? child.getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize()
      : new THREE.Vector3(0, 1, 0);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const plane = axisBasis(axis.clone().applyQuaternion(world), new THREE.Vector3(1, 0, 0));
    this.bindings.set(bone, { axis, quaternion: bone.quaternion.clone(), world, planeInverse: plane?.invert() });
  }

  stableTarget(bone, segment) {
    const bind = this.bindings.get(bone), s = this.scratch;
    if (!bind || !segment?.direction) return false;
    bone.parent.getWorldQuaternion(s.parent).invert();
    cameraDirection(segment.direction, this.viewRotation, s.desired).applyQuaternion(s.parent);
    if (!s.desired.toArray().every(Number.isFinite) || s.desired.lengthSq() < .5) return false;
    s.current.copy(bind.axis).applyQuaternion(bind.quaternion);
    s.delta.setFromUnitVectors(s.current, s.desired.normalize());
    s.target.copy(s.delta).multiply(bind.quaternion).normalize();
    return true;
  }
}

function axisBasis(direction, normal) {
  const y = direction.clone().normalize();
  const x = normal.clone().addScaledVector(y, -normal.dot(y)).normalize();
  if (x.lengthSq() < .5 || y.lengthSq() < .5) return null;
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function orientationBasis(lateral, up) {
  if (lateral.lengthSq() < 1e-8 || up.lengthSq() < 1e-8) return null;
  const x = lateral.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  if (z.lengthSq() < 1e-8) return null;
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
