# AstroBone Data Dictionary

Status: active Level-A model v1, science-chain audited
Date: 2026-08-26

Canonical calculations use SI units. The current web slider stores object mass in grams for display and converts it to `massKg` before calculation.

This file describes the active V1 implementation. Source confidence and V2
disposition are audited in `parameter-evidence-table.md`. V2 geometry and
mode-specific capacities are specified in `mechanical-model-v2.md` but are not
active in the app.

## Model Inputs

| Variable | API key | Unit | Guided default | Initial research range | Source or status | Initial uncertainty treatment |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Scenario mode | `mode` | enum | `space` | `space` | Frozen first scope | None |
| Target region | `target` | enum | `tibia` | `tibia` | Frozen first scope | Other targets generate a warning |
| Object mass | `massKg` | kg | 2.0 | 0.1-5.0 | Measured or scenario-defined | Measurement error; start with +/-2% |
| Impact speed | `speedMps` | m/s | 4.0 | 0.1-5.0 | Measured or scenario-defined | Start with +/-5% |
| Impact angle | `angleDegrees` | degrees from surface plane | 75 | 0-90 | Reconstructed event geometry | Start with +/-5 degrees |
| Contact area | `contactAreaMm2` | mm2 | 12 | 10-5000 | Estimated effective patch | High uncertainty; start with +/-50% |
| Impact duration | `impactDurationMs` | ms | 10 | 1-100 | Engineering placeholder | High uncertainty; start with +/-50% |
| Bone modulus | `boneModulusGPa` | GPa | 17 | 11.8-20.9 | Human tibial cortical-bone literature | Sample across the reported range |
| Baseline capacity | `baselineCapacityMPa` | MPa | 110 | 75-205 | Cortical tissue yield/ultimate stress scale; not whole-bone strength | Start with +/-25% and test alternatives |
| Bone reserve index | `boneIndex` | ratio | 0.90 | 0.45-1.20 | Normalized person factor; not yet tied to DXA/QCT | Start with +/-10% |
| Microgravity exposure | `microgravityDays` | days | 180 | 0-183 | Mission record | Treat as known |
| Monthly loss rate | `monthlyMicrogravityLossRate` | fraction/month | 0.0125 | 0.010-0.015 | NASA reports average BMD loss, not direct strength loss | Sample uniformly in v1 uncertainty work |
| Maximum modeled loss | `maximumMicrogravityLossFraction` | fraction | 0.30 | 0-0.30 | Numerical safeguard; not a clinical threshold | Scenario assumption |

## Derived Outputs

| Output | API key | Unit | Definition |
| --- | --- | ---: | --- |
| Kinetic energy | `kineticEnergyJ` | J | `0.5 * massKg * speedMps^2` |
| Normal impact energy | `normalImpactEnergyJ` | J | `0.5 * massKg * (speedMps * sin(angle))^2` |
| Estimated impulse | `estimatedImpulseNs` | N s | `massKg * normalImpactSpeedMps` |
| Average force | `averageForceN` | N | `estimatedImpulseNs / impactDurationSeconds` |
| Contact stress | `contactStressPa` | Pa | `averageForceN / contactAreaM2` |
| Estimated strain | `estimatedStrain` | dimensionless | `contactStressPa / boneModulusPa` |
| Baseline capacity | `baselineCapacity` | Pa | Reference tissue-level stress capacity |
| Adjusted capacity | `adjustedCapacity` | Pa | Baseline capacity multiplied by capacity factors |
| Mechanical demand ratio | `mechanicalDemandRatio` | ratio | Contact stress divided by unadjusted capacity |
| V1 relative mechanical index (DCR) | `demandCapacityRatio` | ratio | Nominal contact stress divided by adjusted stress-capacity proxy |
| Relative concern band | `riskBand` | enum/object | Research threshold associated with DCR |
| Assumptions | `assumptions` | text list | Assumptions active in every calculation |
| Warnings | `warnings` | text list | Scope and research-range violations |

## Separate Evidence And Operational Inputs

| Variable | Owner | Role | Must not change |
| --- | --- | --- | --- |
| X-ray fracture-screening model score | DenseNet121 image channel | Fracture-like image evidence; not calibrated as a probability | Physics or capacity outputs |
| Localized mask area | U-Net++ image channel | Spatial image evidence | Physics or symptom values |
| Pain, swelling, limb use, sensation | Care-plan channel | Operational review priority | Image model score or DCR |

The decision layer applies explicit review rules. It does not calculate a
weighted cross-domain score from these channels.

## Parameter Sources

- NASA reports average mineral-density loss of about 1%-1.5% per month in weight-bearing bones during four-to-six-month missions: https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/
- NASA's BFxRM uses applied load, bone strength, uncertainty distributions, and a fracture-risk index: https://ntrs.nasa.gov/citations/20170005223
- Human tibial cortical bone has substantial directional modulus variation; one study reported approximately 11.8-20.9 GPa for Young's modulus: https://pubmed.ncbi.nlm.nih.gov/10912351/
- A cortical-bone review summarizes broad yield and ultimate stress values, illustrating why 110 MPa is only a nominal tissue-level starting point: https://pmc.ncbi.nlm.nih.gov/articles/PMC4996317/
- Dynamic whole-tibia fracture loads vary widely and are not interchangeable with tissue stress: https://pubmed.ncbi.nlm.nih.gov/8939012/

