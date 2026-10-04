# AstroBone MotionGuard

MotionGuard is the observed-movement channel of AstroBone. It uses the existing
on-device MediaPipe Pose Landmarker Lite worker and the rigged skeleton. It does
not replace the image model, infer bone density, or change the mechanical DCR.

## Current Measurements

- Shoulder elevation: `angle(elbow, shoulder, hip)`, in degrees. The value is a
  camera-coordinate proxy and is unavailable when the complete arm is not tracked.
- Elbow flexion: `180 - angle(shoulder, elbow, wrist)`, in degrees.
- Hip flexion: `180 - angle(shoulder, hip, knee)`, in degrees.
- Knee flexion: `180 - angle(hip, knee, ankle)`, in degrees. Zero is full extension.
- Bilateral difference: an independent absolute left-right difference for each
  tracked shoulder, elbow, hip, and knee measurement.
- Trunk axis deviation: angle between the normalized hip-to-shoulder axis and
  the pose coordinate Y axis. This is not a gravity-referenced clinical angle.
- Joint angular speed: mean absolute bilateral change divided by elapsed time for
  each tracked joint. It is unavailable after a tracking gap greater than one second.
- Squat repetitions: complete observed extension-flexion-extension cycles with
  per-repetition peak flexion, maximum angle difference, and flexed-phase time.
- Alternating knee cycles: completed knee flexion cycles, cycle rate, and timing
  coefficient of variation. These are not verified steps, heel strikes, balance
  scores, or fall-susceptibility predictions.
- Controlled reach cycles: per-side lowered-raised-lowered shoulder cycles. These
  are motion counts, not a strength, technique, fatigue, or rehabilitation score.

The twin updates its pose and observed-movement state with each usable fresh
frame. A completed eight-second assessment includes MotionGuard aggregates in
`astrobone-movement-evidence-v3`. Video, images, and raw landmark arrays are not
included. Mode changes reset protocol counters; mode controls are disabled during
a capture to prevent mixed-protocol results.

On the web, **Webcam source** lists browser-reported `videoinput` devices and an
explicit selection is requested with an exact device ID. **System default camera**
uses the preferred Crew or Environment orientation, which is also the primary
control on Android. Device labels may remain generic until camera permission is
granted. A `devicechange` event refreshes the list when supported.

## Prototype Counting Rules

These thresholds are engineering rules for counting, not clinical cutoffs or
exercise prescriptions:

- Squat: first observe mean flexion at or below 20 degrees; then at least 50
  degrees; then return to at most 20 degrees. The observed flexed phase must last
  0.6 to 15 seconds. Starting in a flexed pose does not count a repetition.
- Knee cycle: first observe at most 12 degrees, then at least 28 degrees, then
  return to at most 12 degrees. A cycle must last 0.2 to 5 seconds.
- Reach cycle: first observe shoulder elevation at or below 45 degrees, then at
  least 110 degrees, then return to at most 45 degrees. The elevated-return phase
  must last 0.3 to 10 seconds. Starting raised or losing arm tracking cannot count.
- Timing: at least four alternating cycle completions, with every adjacent
  interval between 0.2 and 5 seconds. Rate is `60000 / mean(interval_ms)`;
  timing CV is `100 * population_standard_deviation / mean`.
- Frames: missing, unusable, held (`detected: false`), or invalid geometry is
  rejected. A gap greater than one second resets in-progress cycles and timing
  history, while preserving completed counts. Duplicate timestamps cannot
  duplicate a completion event.
- Spoken observation: a knee-angle difference of at least 20 degrees sustained
  for three seconds can prompt a camera/protocol review, with a 30-second
  cooldown. This cue is disabled in alternating-cycle and reach modes because
  instantaneous bilateral difference is expected during those movements.

## Mechanical Loading Boundary

Pose is kinematics, not kinetics. No weighted "movement quality", "absorption",
"bone health", or fracture-risk score is fabricated from these measurements.
The interface explicitly reports bone load as not measured.

To add an actual loading channel, first connect measured or validated modeled
external forces and contacts, subject-specific geometry and inertial parameters,
and a calibrated kinematic coordinate system. Then validate inverse dynamics
against a reference before coupling outputs to the Simulink or bone-stress model.
OpenSim explicitly requires external-force and subject-specific model information
for accurate joint-force and torque calculations:
https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063

## Pose Engine Choice

The working Android/web engine remains MediaPipe with 33 landmarks:
https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker

More landmarks alone do not establish better accuracy. A YOLO Pose adapter can be
evaluated later against the same annotated clips, hardware, and error metrics.
No YOLO model is included or claimed in this milestone. The existing MediaPipe
engine avoids a second model download and preserves the verified 14-segment rig
retargeting path. Raspberry Pi or NoIR-camera performance is not yet validated.

## Validation Gates

1. Compare joint angles with synchronized goniometer or motion-capture references.
2. Report angle MAE, repeatability, counting precision/recall, cycle timing error,
   usable-frame rate, latency, and false spoken-cue rate.
3. Test lighting, clothing, camera roll, view angle, distance, occlusion, low frame
   rate, front/rear mirroring, and realistic exercise hardware.
4. Evaluate on the intended Android and Raspberry Pi hardware, including offline
   operation and a 15-minute thermal/battery run.
5. Use expert-reviewed exercise protocols; do not ask injured people to perform
   test movements. Clinical or astronaut effectiveness is not established by
   software tests or synthetic landmarks.
