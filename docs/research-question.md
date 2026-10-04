# AstroBone Research Question

Status: frozen research scope v1  
Date: 2026-07-22

## Primary Question

Can a prototype mission-adaptive skeletal digital twin framework keep impact mechanics, microgravity-related skeletal capacity, and medical-image evidence traceable while estimating relative skeletal mechanical risk under a spaceflight-related loading scenario?

## First Scenario

The first research version is intentionally narrow:

- event: an EVA hand tool directly impacts the tibial shaft
- subject context: an adult crew member after simulated microgravity exposure
- target anatomy: tibia only
- exposure conditions: 0, 1, 3, and 6 months
- live physics: Level-A analytical impact model
- structural evidence: FracAtlas classifier and segmentation outputs, kept separate from mechanics
- output: mechanical demand, estimated capacity, demand-capacity ratio (DCR), research band, assumptions, and warnings

The existing whole-skeleton visualization remains a display twin. It is not the collision geometry or a patient-specific anatomical model.

## Sub-questions

1. How do impact speed, mass, angle, contact area, and pulse duration affect estimated tibial contact stress?
2. How does an uncertain microgravity-related capacity modifier change the DCR?
3. Which parameters contribute most strongly to variation in the DCR?
4. Can explicit intervals and warnings prevent false precision?
5. Can higher-fidelity simulations later be reduced to a real-time web replay without hiding their assumptions?

## Estimation Contract

AstroBone v1 estimates a relative skeletal mechanical index. It returns:

- kinetic and normal-impact energy
- estimated normal impulse and average force
- nominal contact stress and linear-elastic strain
- baseline and adjusted stress capacity
- DCR and a research concern band
- model assumptions and out-of-scope warnings

AstroBone v1 does not predict a clinically calibrated probability of fracture. A value such as `DCR = 0.68` means that the model's nominal demand is 68% of its assumed adjusted capacity. It does not mean a 68% fracture probability.

## Separation Of Evidence

The following channels remain independent until the decision layer displays them:

1. Physics demand: reconstructed event mechanics.
2. Skeletal capacity: baseline reserve and modifiers.
3. Image evidence: fracture-like model score and localization from the X-ray models.
4. Crew condition: pain, swelling, limb use, and sensation for operational response priority.

Symptoms must not alter the image model score. Image predictions must not silently alter the physics calculation.
The decision layer must not collapse these channels into an arbitrary weighted
medical score; it reports evidence completeness, concordance, and explicit
review rules.

## Initial Success Criteria

- all equations use explicit SI conversions
- repeated inputs reproduce identical outputs
- unit and monotonicity tests pass
- invalid physical inputs are rejected
- research-range violations are visible
- the interface displays DCR rather than a fracture probability
- every default and range is documented in the data dictionary

## Source Basis

- NASA, Risk of Spaceflight-Induced Bone Changes: https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/
- NASA, Risk of Bone Fracture due to Spaceflight-induced Changes to Bone: https://www.nasa.gov/directorates/esdmd/hhp/risk-of-bone-fracture-due-to-spaceflight-induced-changes-to-bone/
- NASA NTRS, Risk Assessment of Bone Fracture During Space Exploration Missions: https://ntrs.nasa.gov/citations/20080047428
- NASA NTRS, Sensitivity Analysis of the Bone Fracture Risk Model: https://ntrs.nasa.gov/citations/20170005223

