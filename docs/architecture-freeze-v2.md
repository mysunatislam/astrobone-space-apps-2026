# AstroBone Architecture Freeze

Status: science-chain freeze v2
Date: 2026-08-26

## Formal Project Identity

AstroBone is a **prototype mission-adaptive skeletal digital twin framework** for
transparent, onboard musculoskeletal decision support. Its mechanics channel
estimates a **relative skeletal mechanical risk index**. It does not diagnose a
fracture or estimate a person's clinical fracture probability.

The frozen demonstration scenario is a direct EVA-tool impact to the tibial
shaft during a six-month exploration transit. The whole skeleton is a rigged
display and movement interface, not patient-specific collision geometry.

## Frozen System Boundary

| Layer | Frozen role | Evidence boundary |
| --- | --- | --- |
| Raspberry Pi | Intended local computer for the later physical demonstrator | Hardware integration is not evidence of model validity |
| Five-inch touchscreen | Intended crew interface | No new screen flow until the science contract is stable |
| NoIR camera | Local pose and activity observation | It cannot see bone or confirm/exclude fracture |
| Certified/external radiograph | Event-triggered structural image input | AstroBone does not create ionizing-radiation hardware |
| DenseNet121 image model | Supporting fracture-screening channel | Score is not calibrated probability and not astronaut-specific |
| U-Net++ mask model | Optional localization support | Weak localization cannot drive the mechanics or response by itself |
| Level-A JavaScript model | Active analytical mechanics envelope | Scenario comparison only; not validated human biomechanics |
| MATLAB/Simulink | Equation implementation verification | Not clinical validation; update only after V2 equations are frozen |
| Monte Carlo | Conditional model uncertainty | Reports `P(RI >= 1 | assumptions)`, not fracture incidence |
| NASA OSDR-804 | Biological plausibility and data-provenance example | Mouse microCT does not calibrate human capacity |

Explicit exclusions for this release are DIY X-ray hardware, ANSYS, a new
Simscape/Simscape Multibody contact model, autonomous treatment, and additional
anatomical targets.

## Frozen Information Flow

```text
Mission state and skeletal evidence
                |
                v
      Estimated capacity state
                |
Measured/reconstructed event and movement
                |
                v
       Mechanical demand model
                |
                v
 Relative index RI = demand / capacity
                |
       +--------+---------+
       |                  |
Local pose evidence   External X-ray evidence
       |                  |
       +--------+---------+
                |
 Evidence completeness and concordance
                |
                v
 Approved response, monitoring, and handoff
```

The channels meet at a transparent decision layer. They are not converted to a
single weighted medical score. Crew-reported red flags can increase operational
priority but cannot alter the image-model output or mechanics calculation.

## Claim Lexicon

| Avoid | Approved wording |
| --- | --- |
| fracture prediction | relative skeletal mechanical risk estimation |
| fracture probability from mechanics | modeled capacity-exceedance probability, `P(RI >= 1 | assumptions)` |
| patient-specific digital twin | prototype mission-adaptive skeletal digital twin framework |
| AI confidence | fracture-screening model score unless calibration is demonstrated |
| model validation for the Simulink match | analytical-to-Simulink implementation verification |
| real-time astronaut monitoring | local prototype pose assessment |
| combined risk score | evidence completeness, concordance, and review priority |

NASA publications may use the formal term "fracture risk" when their work is
being described. AstroBone must not inherit NASA's validated-model claims.

## Output Contract

The active V1 app may report energy, impulse, average normal force, nominal
contact stress, strain proxy, adjusted stress-capacity proxy, DCR, assumptions,
and scope warnings. `DCR = 1` is a model-defined capacity boundary. The `0.50`
and `0.80` bands are unvalidated communication bands.

V2 will report separate axial, bending, transverse-shear, and torsional demand
components; component utilization; `RI`; an uncertainty interval; and the
conditional fraction `P(RI >= 1 | assumptions)`. V2 is specified in
`mechanical-model-v2.md` but is not active in the interface yet.

## Decision Rules

1. Preserve raw component outputs and provenance.
2. Treat missing imaging as missing evidence, not a negative image.
3. Treat disagreement between mechanics and imaging as wider uncertainty.
4. Let explicit crew-condition red flags increase review priority.
5. Never allow one channel to rewrite another channel's score.
6. Link any action to an approved mission or clinical protocol.

## Change Gate

A proposed change is accepted only if it improves at least one part of this
loop without weakening traceability:

```text
Measure -> Estimate -> Predict -> Act -> Update
```

Here, "Predict" means a conditional model trajectory or capacity-exceedance
distribution. It does not mean a diagnosis. Any new numerical parameter needs a
source, unit, evidence class, confidence grade, uncertainty treatment, and test
before it can enter the active model.
