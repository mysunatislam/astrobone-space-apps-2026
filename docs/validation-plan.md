# AstroBone Validation Plan

Status: plan v1  
Date: 2026-07-22

## Validation Claim

The first validation target is limited to reproducible and physically consistent relative DCR estimates for EVA-tool impacts to a simplified tibia. It is not validation of diagnosis or fracture probability.

## Layer 1: Software And Units

Acceptance criteria:

- all automated tests pass
- identical JSON inputs produce identical outputs
- doubling speed quadruples kinetic energy
- increasing mass increases impulse and force
- decreasing area increases stress
- increasing normal angle increases normal energy
- decreasing capacity increases DCR
- zero speed produces zero energy, force, stress, and DCR
- invalid physical values are rejected
- no scalar output is `NaN` or infinite
- a hand-calculated SI case agrees within floating-point tolerance

## Layer 2: Analytical Benchmarks

Create three frozen JSON cases:

1. Earth baseline, broad low-speed contact.
2. Six-month mission, moderate oblique EVA-tool contact.
3. Six-month mission, concentrated near-normal contact.

For every release, store expected energy, impulse, force, stress, capacity, DCR, band, and warnings. A changed result requires an explicit model-version note.

## Layer 3: Sensitivity And Uncertainty

The current exploratory envelope contains 5,000 Monte Carlo runs. Before a validation release, justify every input distribution, run convergence checks, and increase to at least 10,000 samples. Run one-at-a-time sweeps for mass, speed, angle, area, duration, modulus, baseline capacity, bone index, and mission duration.

Required outputs:

- median DCR
- 5th-95th percentile interval
- rank or variance contribution of each uncertain input
- speed-versus-DCR curve
- area-versus-stress curve
- mission-duration-versus-capacity curve
- tornado plot
- speed/capacity heatmap

Acceptance criterion: results must follow the expected monotonic relationships. Counterintuitive behavior must be explained or treated as a defect.

## Layer 4: External Biomechanics

Compare orders of magnitude against:

- published cortical-bone modulus and stress ranges
- human tibia dynamic fracture-load studies
- V2 analytical beam-section benchmark cases
- published combined axial/bending and torsion evidence without importing their injury thresholds
- benchtop impact measurements if safe facilities and supervision are available

Simscape and finite-element work are not competition-release requirements. They
may be considered only after the V2 reduced-order model and its source table are
stable.

Do not compare nominal contact stress directly with whole-bone fracture force without a geometry and boundary-condition mapping.

## Layer 5: Imaging

Validate FracAtlas separately:

- group-safe train/validation/test split
- confusion matrix, ROC, and precision-recall curves
- Dice and IoU for segmentation
- bootstrap confidence intervals
- Grad-CAM and mask overlays
- failure-case review
- model card with intended and prohibited uses

The imaging result remains a separate evidence channel and must not be described as spaceflight-specific fragility.

## Layer 6: Expert And Operational Review

Seek review from biomechanics, orthopedics/radiology, aerospace medicine, and EVA operations. Reviewers should assess assumptions, input ranges, interpretation language, warning behavior, and whether the crew workflow avoids delaying approved care.

## Traceability

Every validation artifact should record:

- model version and source commit
- scenario JSON hash
- code and dependency versions
- parameter source and distribution
- random seed for stochastic analysis
- generated timestamp
- known exclusions

## Stop Conditions

Do not convert DCR to fracture probability until a validated transfer function and representative human outcome data exist. Do not claim clinical or operational readiness until external validation and qualified review are complete.

