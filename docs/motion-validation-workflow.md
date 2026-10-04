# Motion Validation Workflow

## Claim Boundary

The October 2, 2026 pilot measures development-video reliability, repeated-run
agreement, and processing time. It does not validate joint-angle accuracy,
astronaut performance, bone loading, muscle activation, or medical decisions.
The two original clips have already influenced software changes. They must not
be relabeled as an independent held-out test set. Dark/occluded versions are
synthetic conditions from the same subject, not additional participants.

## Run The Pilot

Start the webapp on port 5180. From the project root:

```powershell
node scripts/prepare-validation-fixtures.mjs
node scripts/validate-motion.mjs
```

Fixture preparation refuses to overwrite existing outputs. Once those fixtures
exist, run only the second command. Original source videos are not modified.
The protocol is `validation/motion-pilot-v1.json`; do not change targets after
seeing results. A fresh output directory under `.artifacts/validation` contains:

- `frozen-manifest.json`: protocol, input hashes, source hashes, model hash.
- Per-run JSON: every planned 12 Hz sample, including missing estimates.
- `report.json`: condition results, repeatability, environment and failures.
- `report.md`: human-readable results and claim limits.

Three independently initialized worker runs are made for each source clip.
Visibility and frame processing use the production MediaPipe worker and
the same cached-playback joint-angle code. No landmark packets are mocked.
Only joint-angle/quality/timing traces are saved; raw frames and landmarks are
not included in the report. Outputs and fixture videos are private local artifacts.

The current worker tries GPU inference and falls back to CPU if initialization
or runtime support fails. Each report records the actual backend. The earlier
CPU run remains an immutable baseline; set `ASTROBONE_POSE_DELEGATE=CPU` for an
explicit CPU rerun, and use a new output directory. Prepared-replay p95 inference
on the six normal development runs ranged from 246.22-588.25 ms with CPU and
65.60-133.63 ms with GPU. Desktop load was not controlled, so this is an observed
implementation comparison, not a controlled device benchmark or live-camera FPS.

Capture-to-result timing starts before image-bitmap preparation and ends when
the browser receives a worker result. It is not camera sensor latency or
display latency. Worker initialization and full preparation wall time are
separate. Browser/OS caches and other desktop workloads are not controlled;
repeat the frozen plan under an idle, plugged-in machine before device claims.
Prepared replay runs at 12 source samples/second; it cannot establish live FPS.

The numerical checks compare mechanics equations with closed-form solutions.
Passing those checks does not validate the simplified beam as living bone.

## Public Reference Dataset

First candidate: the OpenCap laboratory validation dataset associated with
Uhlrich et al. It includes synchronized videos and laboratory measurement data;
the authors describe ten participants and squat, sit-to-stand, drop-jump and
walking trials. Use the **marker-based laboratory reference**, not OpenCap's
own markerless output, when evaluating AstroBone.

Primary sources:

- [Dataset and reproduction instructions](https://github.com/opencap-org/opencap-core#reproducing-results-from-the-paper)
- [Authors' video-processing script and session documentation](https://github.com/opencap-org/opencap-core/blob/main/ReproducePaperResults/labValidationVideosToKinematics.py)
- [Paper and validation methods](https://doi.org/10.1371/journal.pcbi.1011462)
- [Dataset download page](https://simtk.org/frs/?group_id=2385)
- [MediaPipe model and output documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)

The download page returned HTTP 403 to the research tool on October 2, 2026.
No reference dataset has been downloaded or evaluated by this pilot. Obtain
`LabValidation_withVideos` through the official page, review its current usage
terms, and retain its license/citation and archive checksum. Do not bypass login
or access restrictions. Raw identifiable videos should not be redistributed in
AstroBone's public demo. The source repository's code license is not automatically
the dataset license.

## Reference Preparation Gates

1. Inventory actual downloaded subject/trial/camera IDs and available laboratory
   reference files. Do not assume file paths or synchronization offsets.
2. Assign whole subjects to development and locked-test groups before inspecting
   AstroBone errors. All cameras, repetitions, frames and augmentations from the
   same participant stay in the same partition. Record exclusions before testing.
3. Freeze model, preprocessing, quality gates and software hashes. Use only the
   development subjects to set synchronization/calibration conventions and any
   quality thresholds. Do not tune thresholds to the locked test.
4. Match the measurement definition. AstroBone currently computes unsigned
   geometric flexion: 180 degrees minus the angle at the knee formed by
   hip, knee and ankle centers. A standard OpenSim `knee_angle_r` coordinate is
   not automatically the same quantity. Use independently reconstructed joint
   centers to derive the matching geometric quantity, or implement and validate
   a coordinate-compatible clinical-angle pipeline separately.
5. Establish video/reference time alignment from the dataset's synchronization
   or a predeclared synchronization event, not by minimizing final test error.
   Document reference clock minus video clock, units, sampling rates and tolerance.
6. Review the conversion with someone familiar with the reference system's
   coordinate definitions. Preserve source-file hashes and processing code.
7. Evaluate every preselected trial, retain failed predictions, and report
   per-subject, camera-view and activity strata. Aggregate at subject level for
   generalization; thousands of frames are not thousands of participants.

No claim of a 5-degree, 95-percent, clinical, or NASA-approved threshold is made.
Accuracy acceptance criteria need to be chosen for the intended use and reviewed
before the locked evaluation, not selected to make observed results pass.

## Compare Synchronized Reference Angles

`validation/reference-template.json` is deliberately incomplete and will fail
validation until real provenance and measurements are supplied. Do not populate
it with AstroBone or another monocular model's predictions and call that ground
truth. Each sample has `timeSeconds`, `leftKneeFlexionDeg`, and
`rightKneeFlexionDeg`; use explicit `null` for unavailable values.

Set `independentFromPoseModel` only after confirming the laboratory source.
`synthetic` must be true for mathematical fixtures. Reference and prediction
video hashes and subject IDs must match exactly. The reference angle definition
must be `unsigned_hip_knee_ankle_flexion_deg`. Time samples must be strictly
increasing and the time offset must be locked before evaluation.

```powershell
node scripts/evaluate-angle-reference.mjs <pilot-run.json> <reference.json> <output-directory>
```

The evaluator uses the supplied fixed clock offset and nearest reference sample
within the supplied tolerance; it does not fit a lag or interpolate across gaps.
It saves alignment coverage, reference availability, prediction coverage, MAE,
RMSE, signed bias and descriptive limits of agreement. Matched failed predictions
remain in coverage denominators. Insufficient data produces no accuracy score.
Per-side pair files can also be imported in the existing reference workbench.
Declarations and provenance fields are not independently audited by the software.

## Later Mechanical Validation

Force claims require synchronized calibrated force measurement, geometry and
boundary-condition records. A beam verification is not fracture validation.
Muscle activation requires an appropriate independent measurement protocol;
colored surface maps and animated reference muscles do not measure activation.
Spaceflight and unusual-orientation performance require a separate external set.
