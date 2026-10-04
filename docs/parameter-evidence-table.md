# AstroBone Parameter Evidence Table

Status: V1 audit and V2 disposition
Date: 2026-08-26

## Confidence Scale

- **High**: directly measured for the scenario, mathematically defined, or
  reported for the same variable and anatomical context.
- **Medium**: supported by human evidence but transferred across loading mode,
  site, population, or measurement method.
- **Low**: engineering assumption, uncalibrated proxy, numerical safeguard, or
  demo preset.

Confidence applies to AstroBone's use of a value, not to the quality of the
source paper. A high-quality paper can still be a low-confidence transfer to a
midshaft EVA-tool impact.

## Active V1 Parameters

| ID | Parameter and key | Active value or range | Evidence class | Source and applicability | Confidence | V2 disposition |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | Target, `target` | Tibial shaft | Frozen design scope | NASA identifies applied load and skeletal competence as the governing fracture-risk relationship [1]. This does not select a numerical shaft model. | High for scope | Retain tibia only; define the cross-section location explicitly. |
| E-01 | Object mass, `massKg` | Default 2 kg; 0.1-5 kg app range | Measured or scenario-defined | No mission-occurrence dataset supports the preset or range. | High when measured; Low as preset | Require measured mass or label the value as scenario-assumed. |
| E-02 | Impact speed, `speedMps` | Default 4 m/s; 0.1-5 m/s app range | Measured or reconstructed | No mission-occurrence distribution supports the preset or range. | High when measured; Low as preset | Derive from video/telemetry where possible; otherwise carry a broad reconstruction distribution. |
| E-03 | Angle, `angleDegrees` | 75 degrees; 0-90 degrees from local surface plane | Geometric convention plus event reconstruction | `v_n = v sin(theta)` is consistent with this convention: 0 degrees glancing, 90 degrees normal. | High for convention; event-dependent for value | Retain the convention and store the local bone-axis direction separately. |
| E-04 | Effective contact area, `contactAreaMm2` | Web 12 mm2; verified Simulink case 60 mm2 | Engineering assumption | Neither value is externally calibrated. The differing values belong to different stored scenarios. | Low | Replace with measured contact geometry or a justified distribution; never present either value as an EVA standard. |
| E-05 | Impact duration, `impactDurationMs` | Web 10 ms; verified Simulink case 8 ms | Engineering assumption | No tool/suit/tibia pulse measurement supports either preset. | Low | Measure or source a contact pulse; use the full impulse time history when available. |
| E-06 | Momentum transfer | Normal velocity arrested; no rebound | Simplifying assumption | NASA's suit-analog study shows impact attenuation varies substantially with suit offset and load [2]. | Low | Add an explicit transfer/attenuation term only after its scenario distribution is justified. |
| B-01 | Cortical Young's modulus, `boneModulusGPa` | Default 17 GPa; 11.8-20.9 GPa | Human tissue literature | Human tibial cortical specimens showed directional Young's modulus from 11.8 to 20.9 GPa [3]. A scalar midpoint removes anisotropy. | Medium | Use directional modulus only for strain; do not let modulus define failure by itself. |
| B-02 | Baseline stress capacity, `baselineCapacityMPa` | Default 110 MPa; 75-205 MPa | Tissue-level translational proxy | Human cortical bone differs between tension and compression [4], and tibial tissue shear strength has been measured separately [5]. One scalar is not whole-bone strength. | Low | Remove the single capacity. Use separate tension, compression, and shear capacities with geometry. |
| B-03 | Bone reserve index, `boneIndex` | Default 0.90; 0.45-1.20 | Uncalibrated person factor | It is not mapped to DXA, QCT, HR-pQCT, biomarkers, or measured failure load. | Low | Default to neutral until a documented measurement-to-capacity mapping exists. |
| B-04 | Microgravity exposure, `microgravityDays` | Default 180 days; 0-183 days scope | Mission record or scenario | Duration is directly knowable. | High | Retain as a measured mission-state input. |
| B-05 | Monthly capacity loss, `monthlyMicrogravityLossRate` | Default 1.25%; 1.0-1.5%/month | BMD-derived translational proxy | NASA reports BMD loss at this scale [1], but a 17-astronaut HR-pQCT study estimated distal-tibia failure-load loss near 0.8-0.9%/month over 3.5-7 month missions [6]. Neither is a midshaft impact law. | Low | Replace direct BMD-to-strength transfer with an uncertain estimated-strength modifier anchored to human HR-pQCT/FE evidence. Do not extrapolate beyond studied durations without a separate model. |
| B-06 | Maximum modeled loss, `maximumMicrogravityLossFraction` | 30% | Numerical safeguard | No clinical or mission threshold supports 30%. | Low | Replace with an explicit validity horizon; a clamp must not be interpreted biologically. |
| R-01 | DCR thresholds | 0.50, 0.80, 1.00 | Definition plus communication heuristics | `1.00` is the model's demand-equals-capacity boundary. `0.50` and `0.80` are not validated cutoffs. NASA BFxRM also uses an applied-load-to-strength index but has additional probabilistic machinery [7]. | High for `1.00` definition; Low for lower bands | Preserve `RI >= 1` as the capacity-exceedance event; label lower bands as provisional communication bands. |
| A-01 | Classifier threshold | 0.50 | Untuned model threshold | The served-checkpoint evaluator uses 0.50, but threshold selection and external calibration are pending. | Low | Freeze before evaluation, report threshold-specific confusion counts, and do not call the score confidence. |
| A-02 | Segmentation threshold | 0.50 | Untuned model threshold | Used for prototype masks; served-checkpoint and independent evaluation are pending. | Low | Keep optional and prevent mask area from driving mechanics or urgency. |

## Archived Monte Carlo V1 Assumptions

The existing 5,000-run Simulink package is reproducible but its distributions are
scenario assumptions, not measured mission frequencies.

| Input | Archived distribution | Confidence for occurrence modeling | Required V2 action |
| --- | --- | --- | --- |
| Mass | Triangular 0.5/2/4 kg | Low | Use task inventory or telemetry evidence. |
| Speed | Triangular 1/4/8 m/s | Low | Use task/video reconstruction evidence. |
| Angle from surface normal | Uniform 0-90 degrees | Low | Replace with task geometry or an explicitly exploratory distribution. |
| Contact area | Triangular 40/60/100 mm2 | Low | Calibrate contact geometry and suit coupling. |
| Duration | Triangular 5/8/15 ms | Low | Calibrate pulse duration or use measured force history. |
| Exposure | Triangular 0/12/24 months | Low and outside V1 scope | Restrict to the validity horizon supported by the selected human evidence. |
| Effective capacity | Truncated normal 25 +/- 2.5 MPa, bounded 18-32 MPa | Low | Retire after V2 mode-specific capacity is defined. |
| Monthly loss | Truncated normal 1.25 +/- 0.25%, bounded 0.5-2.0% | Low | Anchor to estimated strength evidence and separate between-person variability. |

The V2 stochastic output is written as:

```text
P(RI >= 1 | model, scenario, distributions)
```

It is a modeled capacity-exceedance fraction conditional on assumptions. It is
not event incidence, injury probability, or clinical fracture probability.

## V2 Parameters That Must Be Sourced Before Activation

| ID | Parameter | Why it is required | Current status |
| --- | --- | --- | --- |
| V2-G01 | Tibial cross-sectional area, `A_b` | Converts axial force to nominal axial stress | Source/measurement required for the selected shaft location |
| V2-G02 | Principal second moments, `I_x`, `I_y` | Converts bending moments to surface stress | Source/CT geometry required |
| V2-G03 | Torsion constant or polar proxy, `J_t` | Converts torque to torsional shear | Source/CT geometry required; circular-tube approximation is known to overestimate tibial torsional strength [8] |
| V2-G04 | Outer-fiber distances, `c_x`, `c_y` | Defines maximum bending and torsional stress location | Source/CT geometry required |
| V2-G05 | Contact-point vector, `r` | Separates bending moment and torque from force | Event reconstruction required |
| V2-M01 | Tensile capacity, `C_t` | Separate normal-stress failure mode | Human tibial tissue source and whole-bone mapping required |
| V2-M02 | Compressive capacity, `C_c` | Compression differs from tension [4] | Human tibial tissue source and whole-bone mapping required |
| V2-M03 | Shear capacity, `C_s` | Required for transverse shear and torsion | Human tibial cortical shear evidence exists [5]; structural mapping required |
| V2-C01 | Mission strength factor, `S_mission` | Adjusts capacity without equating BMD and strength | Human HR-pQCT/FE estimated failure-load evidence is the provisional anchor [6] |
| V2-C02 | Person-specific reserve factor, `S_person` | Represents individual skeletal state | No active mapping; must remain 1.0 unless sourced measurement is available |
| V2-E01 | Suit/contact transfer factor | Represents offset, pressure, padding, and compliance | NASA analog data exists [2], but direct transfer to this scenario needs review |

## Source Register

1. [NASA 2024 Fracture Evidence Report](https://ntrs.nasa.gov/citations/20240005190)
2. [NASA EVA Suit Impact Load Attenuation Study](https://ntrs.nasa.gov/citations/20110011355)
3. [Hoffmeister et al., anisotropy of human tibial cortical-bone modulus](https://pubmed.ncbi.nlm.nih.gov/10912351/)
4. [Leng et al., human tibial cortical bone in tension and compression](https://pmc.ncbi.nlm.nih.gov/articles/PMC2736133/)
5. [Tang et al., progressive shear behavior of human tibial cortical bone](https://pmc.ncbi.nlm.nih.gov/articles/PMC3552154/)
6. [Gabel et al., spaceflight changes in distal-tibia density and estimated failure load](https://pmc.ncbi.nlm.nih.gov/articles/PMC8862023/)
7. [NASA BFxRM Sensitivity Analysis](https://ntrs.nasa.gov/citations/20170005223)
8. [Cordey et al., torsional tube-model limitation for human tibiae](https://pubmed.ncbi.nlm.nih.gov/11052385/)

## Audit Decisions

1. No V1 demo preset is promoted to a mission population parameter.
2. The active 1.25% monthly modifier remains explicitly provisional until V2 is
   implemented; it must not be described as measured strength loss.
3. The web default and verified Simulink case remain distinct named scenarios.
4. V2 cannot be activated until every `V2-*` input has a unit, source,
   uncertainty distribution, validity range, and benchmark test.
