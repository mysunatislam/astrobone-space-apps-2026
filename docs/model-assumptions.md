# AstroBone Level-A Model Assumptions

Status: active analytical research model v1.1 with Level-A Simulink implementation evidence

Date: 2026-08-26

## Purpose

The Level-A model is a fast, explainable screening calculation for scenario comparison. Its analytical implementation and Simulink block diagram now agree for 25 verification cases. This establishes implementation consistency, not biomechanical or clinical validity.

This document describes the active V1 equations. The frozen V2 reduced-order
axial, bending, shear, and torsion specification is in
`mechanical-model-v2.md`. V2 is not active and the archived Simulink package has
not been relabeled as V2.

## Mechanics

The angle is measured from the local surface plane. Therefore, 0 degrees is tangential and 90 degrees is normal.

```text
v_n = v * sin(theta)
E_k = 0.5 * m * v^2
E_normal = 0.5 * m * v_n^2
J = m * v_n
F_average = J / delta_t
sigma = F_average / A
epsilon = sigma / E_bone
```

Unit conversions are explicit:

```text
grams -> kilograms:      g / 1000
milliseconds -> seconds: ms / 1000
square millimeters -> m2: mm2 * 1e-6
gigapascals -> pascals:  GPa * 1e9
megapascals -> pascals:  MPa * 1e6
```

The impulse calculation assumes that the normal velocity is arrested during the chosen contact pulse with no rebound. The result is an average force, not a peak force.

## Capacity

```text
C_adjusted = C_0 * S_microgravity * S_site * S_person
S_microgravity = 1 - min(months * monthly_loss_rate, maximum_loss)
DCR = contact_stress / C_adjusted
```

For the frozen EVA-tool/tibia scenario, `S_site = 1`. `S_person` is the normalized bone reserve index supplied to the model.

NASA's public 1%-1.5% monthly figure describes average mineral-density loss in weight-bearing bone. The v1 model temporarily applies that fraction as a capacity modifier. This is a translational approximation, not evidence that density and strength decrease one-for-one.

A human HR-pQCT/micro-FE study reported approximately 0.8%-0.9% estimated
distal-tibia failure-load loss per month over 3.5-7 month missions. V2 will use
that estimated-strength evidence as a provisional anchor instead of silently
equating BMD loss with strength loss, while preserving the anatomical and
loading-mode transfer limitation.

## Research Bands

| DCR | Label |
| ---: | --- |
| `< 0.50` | Lower relative concern |
| `0.50 to < 0.80` | Monitor |
| `0.80 to < 1.00` | Elevated relative concern |
| `>= 1.00` | Potential capacity exceedance |

These are research thresholds for scenario comparison. They are not clinical cutoffs and are not mapped to fracture probability.

## Material Assumptions

- Bone is homogeneous and linear elastic.
- The modulus is scalar even though cortical bone is anisotropic.
- Baseline capacity is a nominal tissue-level stress scale.
- The exported Simulink case instead uses 25 MPa as an effective research-envelope stress proxy. Loading that case carries its capacity definition and all other hidden parameters into the browser.
- The same nominal capacity is used for tension, compression, shear, and bending in v1.
- Geometry, cortical thickness, trabecular structure, defects, age, sex, and remodeling history are not resolved.

## Contact Assumptions

- The selected area is a uniform effective contact patch.
- Soft tissue, suit material, padding, tool compliance, and local curvature are not modeled.
- Force is distributed uniformly; local peak stress and stress concentration are omitted.
- A direct normal impulse is used; bending moment, torsion, axial load transfer, and joint constraints are omitted.
- Impact duration is an uncertain input and is expected to dominate many scenarios.

NASA has measured EVA-suit impact attenuation as a source of uncertainty in fracture prediction. That attenuation is deliberately excluded from v1 until a separate suit/contact factor is validated: https://ntrs.nasa.gov/citations/20110011355

## Scope Warnings

The implementation warns when:

- the selected anatomy is not the tibia
- any value falls outside the initial research range

Out-of-range inputs still calculate when they are physically valid so existing demonstrations can be explored, but their model status is displayed as outside the frozen scope. Negative mass or speed, non-positive area/duration/material values, invalid angles, and non-finite values are rejected.

## Interpretation Boundary

Valid statement:

> Under the stated assumptions, this scenario has a higher DCR than the baseline because normal speed increased and adjusted capacity decreased.

Invalid statement:

> This astronaut has a 68% chance of fracture.

## Sources

- NASA 2024 fracture evidence report: https://ntrs.nasa.gov/citations/20240005190
- NASA formal fracture-risk record: https://www.nasa.gov/directorates/esdmd/hhp/risk-of-bone-fracture-due-to-spaceflight-induced-changes-to-bone/
- NASA spaceflight-induced bone changes: https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/
- NASA BFxRM sensitivity analysis: https://ntrs.nasa.gov/citations/20170005223
- NASA EVA suit impact attenuation: https://ntrs.nasa.gov/citations/20110011355
- Human tibial cortical-bone modulus anisotropy: https://pubmed.ncbi.nlm.nih.gov/10912351/
- Human cortical-bone post-yield and failure properties: https://pmc.ncbi.nlm.nih.gov/articles/PMC4996317/
- Human tibia dynamic fracture behavior: https://pubmed.ncbi.nlm.nih.gov/8939012/
- Spaceflight bone microarchitecture, density, and estimated strength: https://pubmed.ncbi.nlm.nih.gov/33597120/

