# AstroBone Functional Camera Validation Protocol

## Status And Question

Protocol version: 1.0, frozen for the first external pilot. The browser implementation and aggregate evidence export are complete. Human data collection has not started.

Research question: how reliably and accurately does AstroBone estimate sagittal-plane lower-limb movement from a single RGB webcam when compared with an independent reference, and under which capture conditions does it fail?

This study validates a functional observation channel. It does not validate fracture detection, clinical gait analysis, injury clearance, or astronaut health prediction. Camera findings never alter AstroBone's X-ray score, mechanical-demand estimate, or skeletal-fragility estimate.

## Participants And Governance

- Begin with healthy adults performing low-risk movements.
- Obtain the review, informed consent, and data-handling approval required by the host institution before collection.
- Exclude injured or symptomatic participants from this first pilot unless a later study has qualified clinical oversight and separate approval.
- Record participant eligibility, consent version, withdrawals, adverse events, and all protocol deviations.
- Determine and document sample size from a precision or power analysis before enrollment; do not choose it after seeing results.

Participants stop immediately for pain, dizziness, instability, or discomfort. A stable chair or support and a trained observer must be available for sit-to-stand and squat tasks.

## Frozen AstroBone Configuration

- MediaPipe Pose Landmarker Lite, 33 landmarks, running locally in the browser.
- Fourteen mapped rig segments with the shipped adaptive smoothing and visibility rules.
- Eight-second assessment window.
- Automatic centering or one manual recenter before the first trial; no participant-specific angle correction.
- One fixed release commit, browser version, camera model, resolution, and device specification recorded for every session.
- `astrobone-movement-evidence-v3` as the analysis packet. The packet contains aggregate metrics only, with no video, image, or raw landmark data. This version-one study analyzes its preregistered lower-limb fields only; shoulder, elbow, and reach-cycle fields remain exploratory unless the protocol is formally amended before collection.

Any implementation or threshold change after collection begins creates a new protocol version and requires a separate result set.

## Reference And Synchronization

Preferred reference: synchronized marker-based optical motion capture with documented joint-angle conventions. A calibrated electrogoniometer or blinded frame-by-frame reference annotation may support a narrower pilot, but its uncertainty and limited movement scope must be reported.

Use a visible synchronization event at the start of every dynamic trial. Align coordinate systems and define flexion sign, neutral pose, event boundaries, filtering, and missing-frame handling before analysis. The reference analyst should be blinded to AstroBone results where practical.

## Tasks And Conditions

Start with movements dominated by the sagittal plane because monocular pose validity is task- and plane-dependent:

1. Neutral standing for static offset and tracking stability.
2. Controlled bilateral knee flexion and extension.
3. Repeated sit-to-stand or a shallow bilateral squat within the participant's comfortable range.
4. Normal standing movement used only to test repeatability, not to claim clinical gait validity.

Capture repeated trials in the nominal setup, then vary one factor at a time: lighting, clothing contrast, camera distance, partial limb occlusion, left/right body orientation, and device performance. Record every failed or incomplete trial. Do not silently discard low-quality frames or participants.

## Recorded Outputs

For each AstroBone trial, preserve the exported aggregate evidence packet and its release commit. Analyze:

- total, detected, and usable frame counts and rates;
- mean and tenth-percentile rig coverage;
- median FPS, median inference latency, and 95th-percentile latency;
- left and right knee, hip, and ankle range of motion;
- left-right asymmetry and change from a session baseline;
- incomplete captures, tracking loss, anatomically implausible output, and recovery time.

Reference recordings, if retained, belong to the governed study dataset and must be de-identified, access-controlled, and covered by a retention schedule. AstroBone itself must continue to process webcam frames locally and export no raw frames or landmarks.

## Statistical Analysis

- Report mean absolute error, root mean squared error, mean bias, and 95% limits of agreement for comparable angles.
- Report an explicitly selected absolute-agreement intraclass correlation coefficient with a confidence interval; correlation alone is insufficient.
- Report within-session and between-session test-retest reliability.
- Stratify results by task, joint, side, capture condition, and device rather than presenting one pooled accuracy number.
- Report missingness and failure frequency beside accuracy so successful frames cannot hide poor availability.
- Use Bland-Altman plots and time-aligned error plots; publish representative failure cases.
- Freeze exclusions, preprocessing, and success thresholds before collection. Thresholds require biomechanics and human-factors review and must not be invented from the pilot results.

Until those preregistered thresholds are met on an independent evaluation, the interface must label the channel as estimated functional evidence and retain its current non-diagnostic warning.

## Deliverables And Gate Decision

The Gate 4 evidence package consists of the signed protocol, release commit and dependency versions, device/camera table, de-identified aggregate packets, analysis code, complete results with confidence intervals, failure-case gallery, protocol deviations, and reviewer sign-off.

Gate 4 passes only when the preregistered accuracy, reliability, availability, and failure-handling criteria are met for the stated tasks and conditions. A pass does not authorize clinical or flight use; it supports only the bounded functional-observation claim tested here.

## Scientific Basis

- [MediaPipe BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) documents the model output and intended boundaries.
- [Webcam-based 3D range-of-motion evaluation against OptiTrack](https://pmc.ncbi.nlm.nih.gov/articles/PMC10593217/) supports direct reference comparison and reports joint-dependent limitations.
- [Markerless sit-to-stand reliability and validity against VICON](https://pmc.ncbi.nlm.nih.gov/articles/PMC12115460/) motivates absolute-agreement and task-specific reporting.
- [MediaPipe knee-valgus comparison with VICON](https://pmc.ncbi.nlm.nih.gov/articles/PMC11399566/) reinforces plane- and task-specific validation.
- [Systematic review of markerless pose validation](https://pmc.ncbi.nlm.nih.gov/articles/PMC13306381/) supports reporting absolute error and agreement rather than correlation alone.
