# Articulated Anatomical Reference

Movement capture uses `public/models/anatomy/musculoskeletal-rigged.glb`.
The same model follows live-camera and uploaded-video pose packets. It contains
277 skeletal and 683 muscular named atlas structures, bound to 64 rig joints
and merged into two render meshes. These are structure counts, not a claim of
277 individual bones or 683 independently measured muscles. The source includes
cartilage, tendons, sheaths, and related structures. It is a musculoskeletal
atlas, not a complete organs, vessels, or nervous-system model.

## Observed Versus Coupled Motion

| Input | Maximum live coverage | Meaning |
| --- | --- | --- |
| MediaPipe body landmarks | 16 directional channels | Estimated head, trunk, shoulder, arm, hand, leg, and foot directions |
| Fresh hand landmarks | 30 finger-segment directions | Three articulated segments per finger on each hand |
| Fresh face blendshape | One jaw-opening cue | Bounded visual jaw rotation, not measured jaw biomechanics |
| Remaining reference structures | Coupled to the above rig | Not independently observed inside the body |

The coverage display counts fresh usable directions, not rendered structures.
Each leg is gated by its same-side hip/knee/ankle chain, not the stricter bilateral
assessment gate. Its tracked/held status appears under the viewer. This display
change does not qualify partial footage as a complete functional assessment.
Absent or stale pose data holds the last pose and shows tracking loss. Partial
views cannot count unseen lower-body channels. Missing finger detail does not
invent finger movement. Mirroring is applied consistently to the camera,
overlay, and rendered display without swapping anatomical left/right identity.

The current retargeter keeps the body upright and rate-limits root yaw to 120
degrees per second after its first usable heading. Circular angle differences
keep rear-facing estimates near +/-180 degrees continuous instead of clamping
them to opposite side views. Leg bend-plane references share this body heading.
This is display stabilization, not a measured limit on human rotation. It does not
reconstruct lying, inverted, or unrestricted microgravity rotation. Avoid using
those movements as an accuracy demonstration. Monocular depth, occlusion,
clothing, motion blur, and differing body proportions remain error sources.

A paused video holds the display only when its pose timestamp matches the
selected media time within the 0.2-second cached-frame tolerance. The UI labels
it as a recorded pose. The original observation timestamp and assessment data
are not refreshed; live-camera tracking loss still expires normally. Seeking
to the terminal video frame processes one final still without restarting an
assessment or an inference polling loop.

## Squat And Foot Display Safeguards

Thigh and shin orientation share a temporally stabilized bend-plane normal.
Near extension, where that plane is undefined, the previous normal is retained
instead of allowing arbitrary axial roll. Foot orientation uses heel-to-toe
landmarks rather than the elevated ankle-to-toe vector. Foot smoothing occurs in
world space so a bending shin cannot temporarily drag the sole into a tiptoe.

Foot channels require heel/toe visibility of at least 0.65 and a nondegenerate
direction. The upright display rejects inferred foot pitch over 35 degrees;
such frames, or missing foot landmarks, hold the last trusted world orientation
(the neutral reference orientation before any trusted observation). The UI labels
this state `fixed`, not `tracked`. This heuristic may withhold a genuine large
heel rise; it is not a validated ankle range limit or measurement correction.

A reference-ground adjustment lowers the rig pelvis as the knees bend. It is
display grounding, not measured foot contact, a floor reconstruction, force
estimation, or inverse dynamics. Pose-derived assessment angles remain unchanged.
Repeated-squat tests verify no accumulated leg twist, level-sole preservation,
and world-orientation hold during foot tracking loss.

## Rig Construction

`src/anatomicalRigging.js` bakes source atlas transforms into floating-point
geometry before creating the hierarchy. Manual reference joint centers define
the body chains. Finger centers are derived from the named phalanx geometry.
Each skeletal structure is rigidly attached to one joint, preserving its shape.
Muscle vertices are blended between two nearby, region-constrained kinematic
axes, with chest/back origin anchoring to avoid the adjacent arm pulling the
lower torso. This is visual linear-blend skinning, not a muscle-tendon solver.

The spine, ribs, scapulae, forearm bones, and toes have coupled approximations;
their independent physiological articulation is not recovered. Muscle wrapping,
volume conservation, physiological strain, and joint contact mechanics are not
modeled. Extreme poses may show intersections or stretching of muscle surfaces.
The viewer offers separate bones/muscles, muscle opacity, and mesh lines so these
limitations can be inspected rather than hidden.

The pose model does **not** measure muscle activation, EMG, force, bone density,
internal bone motion, damage, or health status. No activity heatmap or clinical
score is inferred from reference-mesh deformation. Such measurements require
appropriate additional sensing, modeling, and independent validation.

## Rebuild And Verify

From the project directory:

```powershell
node scripts/build-anatomical-rig.mjs
node --test src/anatomicalRig.test.js
npm test
npm run build
$env:ASTROBONE_QA_ANGLE = 'd3d11'
node scripts/qa-live-rig.mjs http://127.0.0.1:5180/
```

The build preserves source and output SHA-256 hashes plus every named structure's
joint assignment in `public/models/anatomy/rig-manifest.json`. The original static
atlas remains unchanged and separately searchable in the anatomy tab. The GLB
link under the live viewer downloads the articulated reference asset.

Unit tests check atlas-envelope preservation after GLB compression, normalized
weights, 64 joints, complete structure mapping, rigid bone geometry, finite
muscle deformation, side identity, finger/jaw movement, and stale-data handling.
Playwright checks actual WebGL pixels, pose-driven motion, separate anatomical
layers, mirroring, partial-body tracking, held poses, and responsive layout on
desktop and mobile. Its pose packets are synthetic: passing these tests is
software verification, not camera accuracy or clinical validation.

Before a validated-motion claim, compare a frozen version against synchronized
reference motion capture or an appropriate instrumented protocol. Report
per-joint angular error, missing-frame rate, end-to-end timing, side-identity
failures, and results for occlusion and off-axis views. A biomechanics reviewer
should inspect joint centers and each anatomical coupling separately.

## Provenance

Real-video knee regression results and reproduction steps are in
[knee video verification](knee-video-verification.md).

Source: [Z-Anatomy](https://github.com/LluisV/Z-Anatomy), revision
`6c7f9016bd5899ac8edafd31b9900c151df42ed6`, CC BY-SA 4.0, with BodyParts3D/DBCLS
attribution and source-specific terms retained in `SOURCE-LICENSE.txt`.
The derivative anatomy assets are not relicensed under AstroBone's MIT code
license. Keep their notices and applicable ShareAlike terms when redistributing.
