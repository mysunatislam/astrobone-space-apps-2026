# Validation-first web workflow

## Motion

Live body pose is the low-latency default. Face/finger tracking, object awareness,
local MHR reconstruction and pulse are optional, separate workloads. Source images
for the body worker are capped at a 640-pixel long edge; one request can be in flight.
The latency label measures capture-to-result age, not only model execution time.

Recorded MP4/WebM exercise footage (up to 100 MB) is automatically limited to its
first 120 seconds for analysis, without rewriting the original file. Clips of at
least 7 seconds get an observation window of up to 8 seconds with a half-second
end margin (6.5 seconds for a 7-second clip). Shorter clips support motion preview
only. Visibility and sample-quality gates still apply; accepting a file does not
guarantee a complete assessment. Segment boundaries and observation duration are
retained in exported video evidence.

The selected clip can be prepared at 12 samples/second before playback. Both
preparation and playback stop at the clip boundary. The timeline selects the corresponding
cached pose. Seeking clears the active assessment and movement counters. Angular
velocities and observation duration use source video time, not CPU processing time
or playback speed. No frame/image is uploaded by this browser-only path.

Single-camera estimation cannot exactly recover hidden limbs, anatomical rotation
or forces. Prepared replay removes inference from playback but retains sampling and
model error. It requires one clear subject and a stable camera. Astronaut exercise
equipment, unusual orientations and occlusion need a separate validation set.
The upright display guard suppresses uncertain pelvis pitch/roll and invalid
spine inversion. Display quaternions are neutral-pose referenced to avoid accumulated
twist. These display safeguards do not change exported measured joint angles.

## Mechanics and biomechanics

The verification workbench evaluates a solid circular beam in a principal-axis frame:
M = r x F, sigma = M c / I, tau = 4 V / (3 A), I = pi r^4 / 4.
It also verifies impulse/average-force units and geometric joint angles at six
known angles. These are numerical/analytical checks, not tissue validation.
The beam geometry and capacities are illustrative, not astronaut-specific values.

The next physical references are synchronized goniometer or optical motion-capture
joint angles, a calibrated load cell for applied force, and measured specimen
geometry if beam results are compared with physical loading. Video alone cannot
validate bone force, BMD, muscle strength or fracture risk.

Reference JSON uses `astrobone-reference-v1`, explicit metric/unit, pseudonymous
subject ID, device and protocol, and a synthetic-data declaration. Failed estimates
use null and remain in the coverage denominator. Reports include MAE, RMSE, signed
bias, descriptive agreement limits and subject-macro MAE. Frames are correlated;
these are not clinical confidence intervals. No independent validation data are
bundled. File imports are processed in memory; only an explicit export saves them.

## rPPG model shortlist (checked 2026-09-29)

- POS: deployed experimental baseline. No contact-reference validation yet.
- PHASE-Net: official training, testing and deployment code exists. Its deployment
  notes describe sliding-window, not strictly causal inference. Evaluate separately
  before activating in the app; training/checkpoint provenance and licensing must
  be checked. https://github.com/Alex036225/PhaseNet/tree/main/deploy
- FactorizePhys: official NeurIPS 2024 code, appropriate as an independent comparison.
  https://github.com/PhysiologicAILab/FactorizePhys
- The supplied PHASE-Net/PhysDG/FLOW/BTS accuracy figures have not been reproduced
  here. Different datasets, within-dataset and held-out-dataset protocols cannot be
  ranked as though they were one test. PhysDG is a challenge, not a single deployable
  architecture. No winner model or unverified checkpoint is presented as installed.

Evaluate frozen models on subject-disjoint development/test partitions, retain
dataset/protocol metadata and reference device timestamps, and report failed-window
coverage alongside error. Include motion, illumination and skin-tone variation,
window duration, preprocessing, actual hardware latency and startup latency. Do
not tune quality gates on the final test set. A single published MAE is not evidence
for this camera, exercise protocol or astronauts.

All optional health/environment/AI panels remain research demonstrations. The
core contribution is traceable kinematics, transparent mechanics and reproducible
reference comparison, not an autonomous clinical decision or claimed competition win.
