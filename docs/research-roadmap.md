# AstroBone Research Roadmap

> Historical planning document. The active 2026 competition scope is frozen in
> `architecture-freeze-v2.md`; its exclusions and claim boundaries take
> precedence over the Simscape/FEA ideas below.

AstroBone should grow into an explainable fracture-risk digital twin, not a diagnosis app. The defensible pitch is:

> A simulation and decision-support prototype that links applied loads, skeletal fragility, and uncertainty into a visual digital twin for exploration crews.

## Research Questions

1. How do object mass, speed, angle, contact area, and target anatomy change local bone stress or strain?
2. How does skeletal fragility change after reduced mechanical loading, especially long-duration microgravity exposure?
3. Which simplified mathematical model is honest enough for a prototype and still traceable to higher-fidelity biomechanics?
4. How can Simulink/Simscape produce physics outputs that the web digital twin can replay and explain?
5. How can we validate the model against published fracture-risk, QCT/FEA, spaceflight-bone, and impact literature?

## Phase 0 - Current Prototype

Status: done.

Deliverables:

- Three.js web twin with articulated leg/skeleton visualization
- Impact controls for mass, speed, angle, contact area, bone strength, and target site
- Exploration-crew evidence and response workflow
- Chatbot-style explanation layer
- Initial risk-score placeholder model

Limitations:

- Procedural anatomy, not CT-derived geometry
- Heuristic risk score, not a validated fracture probability
- No Simscape/FEA backend yet
- No uncertainty model
- No dataset calibration

## Phase 1 - Literature Base

Goal: build a paper-backed foundation before adding more code.

Minimum reading groups:

1. NASA fracture risk and astronaut bone loss
2. NASA Bone Fracture Risk Model (BFxRM)
3. Digital Astronaut / bone remodeling work
4. QCT and finite-element fracture load prediction
5. Spaceflight animal, astronaut, and analog skeletal evidence
6. Simscape Multibody contact, CAD import, flexible bodies, and external force workflows

Output:

- `docs/literature-map.md`
- annotated Zotero/Mendeley folder, if you use a reference manager
- one-page technical thesis: "What exactly are we predicting?"

## Phase 2 - Mathematical Core

Goal: replace the current heuristic risk score with layered models.

Start with three levels:

### Level A - Transparent Impact Model

Use this for live web interaction.

Variables:

- `m`: object mass, kg
- `v`: impact speed, m/s
- `theta`: impact angle relative to bone surface normal
- `A`: contact area, m^2
- `E_bone`: apparent elastic modulus, Pa
- `S_bone`: strength modifier from density, microgravity exposure, age, or injury history

Core equations:

```text
E_k = 0.5 * m * v^2
v_n = v * sin(theta)
E_normal = 0.5 * m * v_n^2
J = m * delta_v
F_avg = J / delta_t
sigma = F_avg / A
epsilon = sigma / E_bone
risk_index = demand / capacity
```

This is not enough for clinical prediction, but it is excellent for explaining angle, speed, mass, and contact area.

### Level B - Bone Fragility Model

NASA-facing prototype:

```text
BMD_loss_fraction = clamp(months_in_microgravity * monthly_loss_rate, 0, max_loss)
strength_factor = f(BMD_loss_fraction, site_modifier, recovery_modifier)
capacity = baseline_capacity * strength_factor
```

Use ranges, not one fake-exact number. NASA public pages commonly describe bone-density loss around 1% to 1.5% per month during four-to-six-month missions, while older Digital Astronaut material often references 1% to 2% per month in microgravity.

### Level C - Simulation/FEA Model

Use for offline validation and high-fidelity case studies.

Options:

- MATLAB/Simulink + Simscape Multibody for multibody dynamics and contact forces
- MATLAB PDE Toolbox or external FEA for simplified bone deformation
- OpenSim for musculoskeletal force estimation
- Python finite-element pipeline later, if MATLAB licensing becomes a blocker

Output from Level C should feed the web app as JSON time-series:

```json
{
  "scenario": "eva_tool_tibia_oblique",
  "time": [0, 0.001, 0.002],
  "impactForceN": [0, 420, 1120],
  "targetBone": "tibia",
  "peakStressMPa": 88,
  "peakStrainMicrostrain": 3900,
  "riskBand": "watch",
  "uncertainty": {
    "low": 0.31,
    "mid": 0.48,
    "high": 0.66
  }
}
```

## Phase 3 - Simulink/Simscape Track

Goal: create a reproducible physics backend.

Model 1: single bone as rigid body with contact proxy

- Rigid femur/tibia body
- Impact object body
- Spatial Contact Force block
- External Force and Torque block for controlled impacts
- Sensors for force, velocity, and joint reaction loads

Model 2: two-segment lower limb

- Femur, tibia/fibula, foot
- Hip/knee/ankle joints
- Contact proxy at target site
- Parameter sweep over mass, speed, angle, and contact area

Model 3: flexible bone approximation

- General Flexible Beam for a simplified long bone
- Reduced Order Flexible Solid if a mesh/ROM workflow is available
- Export peak displacement, reaction force, strain estimate, and modal response

Model 4: web replay export

- MATLAB script runs batches
- Saves `.mat` and `.json`
- Web app loads JSON and animates load transfer, hotspot, and assistant explanation

## Phase 4 - Anatomy And Assets

Goal: replace procedural anatomy with credible geometry.

Asset paths:

- Open lower-limb skeleton mesh with license suitable for demo
- CT-derived mesh if available from a public dataset
- Separate bones: femur, tibia, fibula, patella, foot bones
- Rigged display skeleton for animation
- Simplified collision proxies for simulation

Rule: do not simulate collision directly against a beautiful dense display mesh. Use simplified contact geometry for physics, then visualize results on the anatomical mesh.

## Phase 5 - Validation

Validation should happen in layers.

1. Dimensional checks: units and equations are correct.
2. Physics sanity checks: higher speed, smaller contact area, and more normal impact should increase stress.
3. Literature checks: compare outputs to published ranges for bone loss, fracture loads, and tibial strain.
4. Sensitivity analysis: show which inputs dominate risk.
5. Uncertainty: show low/mid/high bands instead of one overconfident score.
6. Expert review: ask a biomechanics/orthopedic/physiology mentor to critique assumptions.

NASA judges will respect transparent uncertainty more than fake certainty.

## Phase 6 - Software Architecture

Recommended repo structure:

```text
src/                         web digital twin
docs/                        research and validation notes
simscape/                    MATLAB/Simulink models and scripts
models/                      anatomy meshes, collision proxies, sample scenarios
data/scenarios/              JSON simulation outputs
research/papers/             local notes only, not copyrighted PDFs
python/                      preprocessing, sensitivity analysis, validation plots
```

## Phase 7 - NASA Demo Package

Demo story:

1. "NASA already studies fracture risk because spaceflight changes bone strength."
2. "Existing risk models are complex and hard to communicate."
3. "AstroBone makes the applied-load plus skeletal-fragility process visible."
4. "The assistant explains assumptions, uncertainties, and next actions."
5. "The system turns incomplete evidence into a transparent action and handoff record."

NASA-facing phrasing:

- Use "fracture-risk estimation"
- Use "explainable simulation"
- Use "digital twin prototype"
- Avoid "diagnoses fractures"
- Avoid "guarantees early detection"

## Near-Term Sprint

Sprint 1:

- Build `docs/literature-map.md`
- Replace heuristic risk function with named Level A equations
- Add units to every UI input/output
- Add a "model assumptions" panel

Sprint 2:

- Add JSON scenario import/export
- Add uncertainty bands
- Add basic sensitivity sweep in JavaScript or Python

Sprint 3:

- Create first Simscape model
- Export one force-time curve
- Replay that curve in the web twin

Sprint 4:

- Add real anatomical meshes
- Create NASA Space Apps submission materials
- Record 2-minute demo video
