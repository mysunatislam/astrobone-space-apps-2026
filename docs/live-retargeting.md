# Live human retargeting

## Signal path

Camera frames stay in the browser. The MediaPipe pose worker returns 33 image
landmarks and estimated 3D world landmarks. Adaptive landmark filtering feeds a
persistent quaternion solver for the imported clothed-human GLB. Fourteen observed
segments drive seventeen mapped rig bones, including the spine chain.

World landmark directions use camera coordinates: x right, y down, with depth
converted to the Three.js camera-facing basis. Anatomical left is bound to left
rig bones; right is bound to right. Mirroring is a display transformation applied
once to each of the video, landmark overlay, and GLB canvas. It never swaps the
anatomical measurements or evidence labels.

The live view uses a fixed camera-facing orientation. Orbit and pan are disabled
during tracking; they remain available in non-camera modes. Automatic framing
expands the view for raised hands and feet. The prerecorded clip is not evaluated
during live retargeting. Simulated impact objects are hidden in live mode.

## Missing observations

Visible upper-body segments can animate without passing the separate full-body
assessment quality gate. Hidden segments retain their last local rotations,
except feet, which retain their last trusted world orientation so a moving shin
does not rotate an unobserved foot. See the anatomical-rig document for the
upright foot-pitch guard and display-only grounding limitations.
Missing detections and packets older than 750 ms hold the pose and display a
tracking-loss state. Retained filtered landmarks do not count as fresh assessment
evidence. Root translation requires visible hips and a centered reference.
Pelvis rotation and torso bending require a usable full-body frame. Each leg
can animate independently when its own hip, knee and ankle are visible; a hidden
opposite foot no longer freezes a visible knee. Unsupported leg chains hold their
last pose. Partial captures can also drive supported neck, arm and hand
segments. This prevents inferred hips in face/hand close-ups from contorting
the whole body.
Image-space visibility caps 3D joint confidence, and offscreen joints are not
retargeted. The full-body assessment requires each necessary lower-body joint
to meet its confidence threshold, rather than accepting a high average alone.

## Verification

- `npm test`: includes real-GLB left/right, vertical-direction, partial-body,
  missing-frame, stale-frame, and desktop/mobile framing regressions.
- `node scripts/qa-live-rig.mjs`: synthetic camera and pose-worker packets through
  the actual controller, real GLB renderer, and UI, on desktop and phone sizes.
  Checks canvas pixels, shared mirror transforms, tracking loss, and recovery.
- `node scripts/qa-camera-click.mjs`: real pointer events reach the camera control.

Synthetic tests verify software wiring and geometry, not human tracking accuracy.
A physical webcam and Android-device session are still needed to evaluate latency,
occlusion, camera-driver mirroring, and pose-estimation error in real conditions.
The supplied `human_body_clothed.glb` replaces the old skeleton display. It has
163 skin joints and four animation clips. `src/humanRig.js` maps its anatomical
bones after GLTFLoader name normalization. The idle clip supplies the neutral
pose. No new asset is published by this local change.

## Hands, face, and rest observations

A separate MediaPipe worker runs Hand Landmarker (up to two hands, 21 points
each) and Face Landmarker (one face, 478 points and selected expression scores).
Task models and WASM files are bundled locally. Inference is rate-limited and
does not queue frames while the worker is busy. A checkbox disables the extra
tracking on slower devices. Results older than 900 ms are labeled delayed and
cannot update the rest observation or trigger a spoken closure alert.

Hand wrists are associated with anatomical body wrists before finger bones are
driven. Ambiguous hands still appear in the camera overlay, but do not animate
an arbitrarily selected arm. Finger segment directions drive the human rig;
the jaw-opening score drives a limited jaw rotation. Face mesh, eye outlines,
and lip outlines appear in the camera overlay. The model has no verified eyelid
blendshapes, so eye closure is a measured camera observation, not an eyelid
animation on the avatar.

The rest cue requires eight seconds of observed bilateral eye closure. Missing
face detections, reversed timestamps, or gaps over two seconds reset the timer.
It issues one optional spoken cue per continuous closure, with a two-minute
voice cooldown. Eye closure does not establish sleep, fatigue, or a sleep stage.
The threshold is a prototype interaction rule, not a medical threshold.

`node scripts/qa-human-detail.mjs` runs the actual models on the official
MediaPipe `woman_hands.jpg` sample supplied in `.artifacts`, checks both hand
landmark sets, the face mesh and expression scores, and saves desktop/mobile
screenshots. This static sample checks integration, not tracking accuracy in
real human movement. The image is not included in the shipped app.

## Scope and limitations

This is estimated body motion, not exact motion capture. Hand landmarks add
finger articulation, but monocular occlusion and palm orientation remain
ambiguous. Camera landmarks do not measure forces, bone strength, or fracture
diagnosis. Face and hand detail needs adequate image resolution and lighting.
See the [MediaPipe Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
for the image/world landmark and visibility contract.
See also the [Hand Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
and [Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
