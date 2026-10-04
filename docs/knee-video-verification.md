# Knee Motion Video Verification

## Defect And Fix

On October 1, 2026, a regression reproduced a visible bent knee remaining near
2.2 degrees of rendered flexion when an unrelated opposite foot had low
confidence. The renderer was applying the bilateral assessment-quality gate to
all lower-body animation. Each leg now requires its own usable hip/knee/ankle
chain. Missing joints still hold that chain. Full-body assessment requirements,
offscreen landmark rejection, and the root/torso orientation safeguards are
unchanged.

An additional playback defect stopped pose scheduling after video end. A seek
now restarts pose updates, including while paused. User scrubbing invalidates
the previous assessment; explicit replay retains its newly started assessment.

## Real Video

- Source: [TensorFlow.js official pose-detection test video](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/test_data/pose_squats.mp4).
- Local-only fixture: `.artifacts/knee-video/pose_squats.mp4`.
- Duration: 13 seconds; resolution: 720 x 1280.
- SHA-256: `ea9151e447b301985d5d65666551ef863b369a2e0f3a71ddd58abef2e722f96a`.
- The clip is used for local software verification and is not bundled with the
  public application. Its source repository attribution is retained here.

The test uses the actual bundled MediaPipe Pose Lite worker and actual video
decoding, with no mocked landmarks. It observes pose-worker packets and rendered
rig knee angles during synchronized playback. It also seeks to an extended and
a bent pose after video end and checks that the rig updates.

The initial desktop run processed 156 source frames. The rendered left knee
ranged approximately 10-108 degrees and the right knee 15-106 degrees. These
are rendered estimates, not independently measured physiological angles. The
clean clip did not trigger the unrelated-foot gate; the targeted unit regression
isolates that failure separately. Do not present the video as a before/after
demonstration of that exact visibility failure.

## Reproduce

Start the local webapp on port 5180, then run:

```powershell
node --test src/anatomicalRig.test.js src/poseAssessment.test.js
node scripts/qa-knee-video.mjs .artifacts/knee-video/pose_squats.mp4
node scripts/qa-knee-video.mjs .artifacts/knee-video/pose_squats.mp4 mobile
```

JSON reports and extended/bent screenshots are written under
`.artifacts/knee-video`. The reports contain source hashes, pose-input and
rendered angle ranges, sample counts, and explicit validation limits. The same
script can take another local video path; its test requires meaningful knee
motion in both legs, so it is not appropriate for an arbitrary activity clip.

## Limits

### Seven-Second And Automatic-Trim Regression

An FFmpeg-derived seven-second copy of the same squat fixture is kept locally at
`.artifacts/knee-video/squat-7s.mp4` (SHA-256
`64b47a8f5201fc16fe98d800dc99572aff89b27d04b648f37f3d2c122c151320`).
The actual MediaPipe worker processed 84 samples. Desktop and 390 x 844 mobile
replay verified both knees bending, end-of-video seeking, and visible GLB output.
The mobile run rendered approximately 8.7-105.8 degrees left and 16.2-101.9
degrees right; these are display estimates, not reference biomechanical angles.

`scripts/qa-video-clips.mjs` verified a 6.5-second observation exported from the
seven-second clip, replay, and a separate 135-second loop stopping at the 120-second
automatic analysis boundary. The original video is not rewritten. Reports are in
`.artifacts/video-clips`; real-video rig screenshots are in
`.artifacts/seven-second-rig`. Shorter observations do not relax visibility or
minimum usable-sample requirements.

### User-Supplied Rear-View Squat Regression

On October 1, 2026, the user supplied `4921644-hd_1066_1920_25fps.mp4`, a
7.32-second, 1066 x 1920, 25 FPS rear-view squat clip. SHA-256:
`46758b8602ea3d5e0609cb9ad4336ece76f1dbaca30d54bd5ff42b3700b2167d`.
The original remains local and unchanged. Its distribution license has not been
established; do not bundle it with the app or publish the test screenshots.

The clip reproduced two additional defects: scrubbing to the terminal frame
could leave no displayed pose, and tiny rear-view depth changes crossed the
atan2 +/-pi boundary, sending clamped pelvis yaw to alternating side views.
The scheduler now processes the terminal still once, and the display uses a
continuous, smoothed heading with a shared body/leg reference. Paused matched
poses remain inspectable and are explicitly labeled recorded, not newly observed.

Actual MediaPipe processed 88 source frames. The 390 x 844 mobile run collected
140 rendered samples; waist heading remained rear-facing at 166.9-187.6 degrees
(maximum recorded sample-to-sample change 8.1 degrees). Thus gross flips were
removed, but residual monocular orientation jitter is not claimed to be zero.
Desktop and mobile bent/extended screenshots and reports are under
`.artifacts/user-squat-video`. A separate actual-GLB unit regression alternates
small pelvis depth errors across +/-pi and verifies stable rear-facing heading
and consistent hip/foot side ordering.

The same clip passed the actual CUDA DensePose test: 17 visible charts and
20,976 colored surface pixels at 1.50 s, two moving-frame inferences of 249.9
and 265.7 ms, and a matched 4.50 s paused frame (141.8 ms inference / 352 ms
browser round trip). Consent withdrawal cleared the overlay and the browser
reported no page errors. Artifacts are in `.artifacts/user-squat-video/densepose`.
These sparse timing samples and unlabeled surface maps are not accuracy or
frame-rate guarantees.

```powershell
node scripts/qa-knee-video.mjs "D:\Downloads\4921644-hd_1066_1920_25fps.mp4" desktop .artifacts/user-squat-video
node scripts/qa-knee-video.mjs "D:\Downloads\4921644-hd_1066_1920_25fps.mp4" mobile .artifacts/user-squat-video
```

### Interpretation

This is real-video pipeline and retargeting verification, not clinical
validation. Comparing a rendered joint with the pose model that drives it does
not establish camera accuracy. The source has no independent motion-capture
reference used by this test. Astronaut, microgravity, multi-person, heavily
occluded, and extreme-pose performance remain unvalidated. Raw test landmarks
are used transiently by the QA harness; the saved report contains aggregates.
