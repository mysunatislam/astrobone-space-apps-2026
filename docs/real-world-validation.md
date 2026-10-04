# AstroBone Real-World Validation Plan

## Purpose

AstroBone currently demonstrates a credible evidence workflow. It does not yet demonstrate clinical effectiveness. Real-world effectiveness must be established separately for imaging, movement, mechanics, workflow usability, and mission operations before those channels can support a stronger claim.

## Validation Ladder

### Gate 0 - Software And Privacy

Status: implemented and tested.

- Unit tests cover mechanics, evidence fusion, care priority, schema validation, and movement calculations.
- Desktop and mobile browser tests cover layout, skeleton rendering, motion, camera processing, and console errors.
- The API enforces image type, size, and response-schema constraints.
- X-rays are decoded in memory and not retained by the API.
- Webcam frames are processed locally in the browser and not uploaded.

Passing this gate proves implementation behavior, not medical accuracy.

### Gate 1 - Exact Internal Model Evaluation

Status: tooling implemented; checkpoint-aligned report pending.

- Evaluate the exact DenseNet121 and U-Net++ checkpoints used by the API.
- Freeze and hash the test manifests and checkpoints.
- Report confusion counts, ROC-AUC, average precision, sensitivity, specificity, F1, Brier score, calibration error, Dice, and IoU.
- Add bootstrap 95% confidence intervals and representative false-positive/false-negative cases.
- Check for patient, study, or duplicate-image leakage across splits.

This gate supports an internal held-out FracAtlas claim only.

### Gate 2 - External Imaging Evaluation

Status: not started.

- Select a license-compatible fracture dataset from a different institution and acquisition pipeline.
- Lock preprocessing and thresholds before evaluation.
- Report performance by anatomy, image quality, age group where permitted, and fracture visibility.
- Record out-of-distribution rejection and unreadable-image behavior.
- Have a qualified reviewer inspect localization overlays and failure cases.

This gate tests transportability. It still does not validate astronaut imaging.

### Gate 3 - Mechanics Calibration

Status: Simulink implementation consistency completed; external calibration not started.

- Define one frozen EVA-tool-to-tibia test geometry.
- Measure or source impact mass, normal velocity, pulse duration, contact patch, and padding/suit attenuation.
- Compare the V2 reference kernel with hand calculations, MATLAB, Simulink, and one independent reduced-order biomechanics or supervised benchtop benchmark. Finite-element work is deferred beyond the competition release.
- Report error for peak/average force, impulse, contact stress proxy, and uncertainty coverage.
- Replace assumed parameters only when a traceable measurement supports the change.

The target is a validated engineering scenario envelope, not a human fracture threshold.

### Gate 4 - Functional Camera Reliability

Status: browser implementation and aggregate evidence export completed; human reliability study not started.

- Follow the frozen [functional camera validation protocol](functional-camera-validation-protocol.md).
- Use healthy adult volunteers in a non-diagnostic movement protocol with appropriate review and informed consent.
- Compare camera-derived knee, hip, and ankle motion with a synchronized reference system, beginning with sagittal-plane tasks.
- Test lighting, clothing, camera distance, occlusion, frame rate, and left/right orientation.
- Report usable-frame and detection rates, angle error, absolute agreement, test-retest reliability, latency, and failure frequency.
- Export the versioned aggregate movement-evidence packet; do not export video, images, or raw landmarks.
- Keep movement findings separate from fracture-image and mechanics scores.

### Gate 5 - Crew-Analog Workflow Study

Status: not started.

- Recruit participants with operational, medical, or human-factors expertise.
- Run scripted delayed-communication cases with missing and conflicting evidence.
- Measure time to first protective action, missed critical steps, handoff completeness, workload, and trust calibration.
- Compare AstroBone with a static checklist baseline.
- Revise language and ordering from observed errors, not preference alone.

### Gate 6 - Expert And Mission Review

Status: not started.

- Aerospace-medicine review of condition questions and response wording.
- Biomechanics review of assumptions and uncertainty ranges.
- Human-factors review of alarms, evidence gaps, and delayed-communication workflow.
- Security/privacy review for any deployment beyond a local research demonstration.
- Document reviewer role, date, scope, findings, and implemented changes.

### Gate 7 - Prospective Clinical Or Flight Use

Out of competition scope.

Prospective patient or astronaut use would require formal study governance, representative data, medical-device/regulatory analysis, cybersecurity controls, clinical performance validation, and organizational approval. AstroBone must not imply that this gate has been reached.

## Competition Evidence Package

For Space Apps, package the strongest completed evidence without overstating it:

1. Reproducible build and public source.
2. Automated software, 3D, and privacy test summary.
3. Exact checkpoint report with hashes and confidence intervals.
4. NASA OSDR transformation script, source hashes, and use boundary.
5. Simulink artifact and internal consistency result.
6. A failure-case gallery showing when the system says evidence is incomplete.
7. The frozen functional-camera study protocol and an example aggregate evidence packet.

## Success Definition

The competition prototype is effective when it helps a user identify missing evidence, stop unsafe loading, complete a consistent condition check, and create a more complete delayed-care handoff. It should not be judged effective because it produces a high fracture score on one demonstration image.
