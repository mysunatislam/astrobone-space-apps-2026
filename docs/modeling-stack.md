# Modeling Stack

> Historical option map. The active competition architecture is frozen in
> `architecture-freeze-v2.md`. A new Simscape or FEA model is explicitly outside
> the current release.

AstroBone should be built as layers. Each layer has a job, a fidelity level, and a way to validate it.

## Layer 1 - Web Digital Twin

Location: `src/`

Purpose:

- Fast interaction
- 3D explanation
- Chatbot-style reasoning
- Scenario setup and replay

Technology:

- Three.js
- Vite
- JSON scenario files

Inputs:

- Scenario: exploration-crew EVA impact
- Object mass, speed, angle, contact area
- Target anatomy
- Bone strength modifier
- Microgravity exposure and estimated bone reserve

Outputs:

- Visible impact path
- Risk band
- Assumption explanation
- Replay of force/stress/strain time-series when available

## Layer 2 - JavaScript Risk Kernel

Purpose:

- Live calculation while the user drags controls
- Transparent equations
- Unit-safe conversion

Recommended file:

```text
src/riskModel.js
```

Functions:

```js
calculateImpactDemand(inputs)
calculateFragility(inputs)
calculateRiskBand(demand, capacity, uncertainty)
runSensitivitySweep(inputs)
```

Do not bury equations inside UI code. Keep the math importable and testable.

## Layer 3 - Python Research Tools

Purpose:

- Batch sweeps
- Plots
- Uncertainty analysis
- Model comparison

Recommended folder:

```text
python/
  astrobone/
    impact.py
    fragility.py
    uncertainty.py
    validation.py
  notebooks/
  tests/
```

Key libraries:

- NumPy
- SciPy
- pandas
- matplotlib/plotly
- SALib for sensitivity analysis

Python outputs should become JSON files that the web app can load.

## Layer 4 - Simulink/Simscape

Purpose:

- Multibody dynamics
- Impact/contact force curves
- Joint load transfer
- Controlled scenario sweeps

Recommended folder:

```text
simscape/
  models/
  scripts/
  exported/
```

Core blocks/features to use:

- Solid blocks for femur/tibia/impact object
- Revolute or 6-DOF joints depending on model fidelity
- Spatial Contact Force for object-to-bone proxy impact
- External Force and Torque for controlled load application
- Transform Sensor, Joint Sensor, and force outputs
- General Flexible Beam for simplified bone flexibility
- Reduced Order Flexible Solid for later ROM-based anatomy

Minimum Simscape model:

```text
World
  -> lower-limb body chain
  -> target-region contact proxy
  -> projectile body
  -> contact force block
  -> sensors
  -> export force-time and kinematics
```

## Layer 5 - Finite Element / Flexible Bone

Purpose:

- Estimate local stress/strain
- Calibrate the simpler web model
- Produce validation cases

Start simple:

- Tibia as hollow beam
- Femur as beam or simplified solid
- Linear elastic material
- Boundary conditions from Simscape force output

Then improve:

- CT/QCT-derived mesh
- Spatially varying material properties
- Failure criteria
- Fatigue damage accumulation

## Layer 6 - Assistant/Chatbot

Purpose:

- Explain what happened
- Explain assumptions
- Explain uncertainty
- Avoid diagnosis claims

The assistant should answer from:

- Current scenario inputs
- Risk kernel outputs
- Simulation metadata
- Source-backed knowledge base

Do not let the assistant invent medical conclusions. It should say "risk estimate" and "seek professional evaluation" for real-world injury concerns.

## Data Contract

Every simulation output should use one shared shape.

```json
{
  "id": "eva-tool-tibia-oblique-001",
  "mode": "space",
  "modelLevel": "simscape-rigid-contact-v1",
  "inputs": {
    "massKg": 0.092,
    "speedMps": 18,
    "angleDeg": 54,
    "contactAreaMm2": 18,
    "targetRegion": "tibia",
    "microgravityDays": 210,
    "boneStrengthIndex": 0.84
  },
  "outputs": {
    "peakForceN": 1120,
    "impulseNs": 2.4,
    "peakStressMPa": 62,
    "peakStrainMicrostrain": 3100,
    "riskIndex": 0.48,
    "riskBand": "watch"
  },
  "timeSeries": {
    "timeS": [0, 0.001, 0.002],
    "forceN": [0, 420, 1120],
    "strainMicrostrain": [0, 1200, 3100]
  },
  "uncertainty": {
    "method": "parameter-sweep",
    "riskLow": 0.31,
    "riskMid": 0.48,
    "riskHigh": 0.66
  },
  "assumptions": [
    "Linear elastic bone approximation",
    "Contact area fixed during impact",
    "No clinical diagnosis"
  ]
}
```

## Coding Order

1. Extract current risk math into `src/riskModel.js`.
2. Add unit tests for the risk kernel.
3. Add assumptions panel to the web UI.
4. Add scenario JSON import/export.
5. Build Python version of the same equations.
6. Add sensitivity sweeps and plots.
7. Build first Simscape rigid-contact model.
8. Export Simscape results to JSON.
9. Replay Simscape output in the web twin.
10. Replace procedural model with anatomical mesh display.

## Definition Of "Research-Grade Prototype"

The project becomes research-grade when:

- Equations are visible and testable.
- Sources are cited for assumptions.
- Units are handled correctly.
- Uncertainty is shown.
- The web twin can replay physics outputs from an external model.
- The assistant explains limits and never diagnoses.
- Validation cases are documented.
