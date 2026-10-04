# AstroBone Validation And Model Cards

## Validation Purpose

AstroBone is a research prototype for explainable musculoskeletal decision support. It is not a diagnostic system. Validation should show that each layer behaves plausibly before any clinical or mission claim is made.

## Mechanics Model Card

Inputs:
- object mass converted to kilograms
- speed in meters per second
- impact angle in degrees
- contact area in square millimeters
- impact duration in milliseconds
- cortical-bone modulus in gigapascals
- nominal baseline capacity in megapascals
- target region
- bone strength index
- microgravity exposure

Current formulas:
- kinetic energy = `0.5 * massKg * speed^2`
- normal speed = `speed * sin(angle)`
- estimated impulse = `massKg * normalSpeed`
- average force = `estimatedImpulse / impactDuration`
- nominal contact stress = `averageForce / contactArea`
- estimated strain = `contactStress / boneModulus`
- adjusted capacity = `baselineCapacity * microgravity * site * person factors`
- DCR = `contactStress / adjustedCapacity`

Intended use:
- show directionally correct relationships
- support live scenario exploration
- expose assumptions for judges and reviewers
- compare scenarios with a transparent demand-capacity ratio

Non-use:
- do not treat DCR as fracture probability
- do not use it for medical treatment decisions
- do not treat nominal contact stress as a local peak or whole-bone fracture criterion

Next validation:
- hand-calculation and automated unit/sanity cases
- Monte Carlo intervals and sensitivity analysis
- MATLAB and Simulink implementation checks after V2 equations are frozen
- an independent reduced-order biomechanics or controlled benchtop benchmark
- comparison with biomechanics literature
- clinician or aerospace-medicine review

## Image Model Card

Classifier:
- architecture: DenseNet121
- dataset: FracAtlas prototype split
- served checkpoint: best validation-loss checkpoint, epoch recorded in the API response
- checkpoint-aligned test evaluation: pending

Segmenter:
- architecture: U-Net++ with DenseNet121 encoder
- dataset: FracAtlas mask prototype split
- served checkpoint: best validation-loss checkpoint, epoch recorded in the API response
- checkpoint-aligned test evaluation: pending

Prior experiment note:
- a final-epoch experiment reported classifier AUC 0.899, fracture recall 0.656, and segmenter Dice 0.394
- those values are not claimed as metrics for the checkpoints served by the current API
- run `python -m ml.scripts.evaluate_served_checkpoints` before publishing served-model performance claims

Intended use:
- provide image evidence inside a broader decision record
- compare imaging signal with impact mechanics and condition report

Non-use:
- not a standalone diagnosis
- not validated on astronaut medical images
- not validated for occult stress fracture detection

Failure modes:
- subtle fractures can be missed
- masks can under-localize or over-localize
- dataset distribution can differ from real mission imaging
- image evidence can disagree with event mechanics

## Dataset Card

FracAtlas:
- public musculoskeletal X-ray dataset for fracture classification, localization, and segmentation
- useful for prototype training and explainable image overlays
- not a spaceflight dataset

NASA and spaceflight evidence:
- NASA identifies bone fracture risk as tied to altered gravity, compromised bone strength, expected loads, and skeletal fragility.
- NASA describes average bone-density loss of about 1% to 1.5% per month in microgravity during four-to-six-month missions.
- NASA HRP and related life-science repositories provide the correct direction for space-specific evidence, but astronaut medical data can be controlled or aggregated.

## Source Links

- NASA fracture-risk record: https://www.nasa.gov/directorates/esdmd/hhp/risk-of-bone-fracture-due-to-spaceflight-induced-changes-to-bone/
- NASA bone-change overview: https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/
- NASA Human Research Program: https://www.nasa.gov/hrp/
- FracAtlas paper: https://pmc.ncbi.nlm.nih.gov/articles/PMC10404222/

## Competition Claim Boundary

Strong claim:
AstroBone demonstrates an explainable workflow that combines impact mechanics, public fracture-image AI, skeletal fragility assumptions, crew condition, and a handoff plan.

Avoid:
AstroBone detects astronaut fractures or predicts actual fracture probability.

Best near-term claim:
AstroBone is a NASA-relevant prototype for transparent onboard skeletal-mechanics review when imaging, event reconstruction, and medical support are incomplete.
