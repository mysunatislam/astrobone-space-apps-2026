# Literature Map

> Research catalogue. Entries about Simscape and FEA are background options, not
> current competition-release commitments. See `architecture-freeze-v2.md`.

This is the starting bibliography for making AstroBone credible. Keep notes short and brutally practical: what does the source let us model, validate, or avoid?

## NASA And Spaceflight Bone Risk

### NASA Human Research Program Evidence Report - Risk of Bone Fracture

Link: https://ntrs.nasa.gov/api/citations/20240005190/downloads/2024%20FINAL%20HRP-F07-ERft%20R2%20Fracture.pdf?attachment=true

Why it matters:

- NASA frames astronaut fracture risk as a biomechanical problem.
- The report discusses skeletal changes, surveillance limits, and fracture risk after spaceflight exposure.
- Use it to justify the project's NASA relevance and to choose language carefully.

How AstroBone uses it:

- Applied load + skeletal fragility architecture
- NASA mode assumptions
- Validation and uncertainty language

### NASA BFxRM - Bone Fracture Risk Model

Links:

- https://pubmed.ncbi.nlm.nih.gov/19707874/
- https://www1.grc.nasa.gov/wp-content/uploads/Nelson_etal_2009_ABME_PredicitingBoneFractureInAstronauts.pdf
- https://ntrs.nasa.gov/api/citations/20140011095/downloads/20140011095.pdf

Why it matters:

- BFxRM is the clearest precedent for astronaut fracture-risk modeling.
- It uses statistical risk forecasting, uncertainty bounding, sensitivity analysis, characteristic loading scenarios, and Monte Carlo-style thinking.

How AstroBone uses it:

- Treat risk as a distribution, not a single number.
- Implement parameter sweeps and uncertainty bands.
- Explain how input assumptions drive output.

### Digital Astronaut Project - Bone Remodeling Model

Links:

- https://ntrs.nasa.gov/citations/20140006747
- https://ntrs.nasa.gov/citations/20140003236
- https://techport.nasa.gov/projects/23245

Why it matters:

- NASA has already used the "Digital Astronaut" framing for computational physiology.
- The bone remodeling work explicitly connects microgravity exposure to bone mass loss, especially lower extremities.

How AstroBone uses it:

- Position AstroBone as a visual/explainable lower-limb extension, not as a replacement for NASA's modeling.
- Build a simple bone-strength change model that can later be swapped for higher-fidelity remodeling logic.

### NASA Public Bone Changes Page

Link: https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/

Why it matters:

- Public-facing NASA explanation suitable for project intro and demo.
- Mentions weight-bearing bones, microgravity, density loss, and fracture susceptibility.

How AstroBone uses it:

- Introductory explanation in the app.
- Human-readable source for judges who are not biomechanics specialists.

## NASA Exploration Medical Operations

### Exploration Medical Capability CDSS Architecture

Link: https://ntrs.nasa.gov/citations/20220017869

Why it matters:

- Long-duration exploration adds communication delay, evacuation limits, and strict constraints on
  mass, power, crew time, and medical resources.
- NASA describes an integrated medical data architecture supporting autonomous clinical decision
  support.

How AstroBone uses it:

- Treat detection as one input to a broader onboard workflow.
- Preserve structured evidence, uncertainty, response actions, and handoff data.

### Earth-Independent Medical Operations

Links:

- https://ntrs.nasa.gov/citations/20230003307
- https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/

Why it matters:

- Medical responsibility increasingly shifts toward the crew as distance from Earth grows.
- The proposed decision-support direction includes continuous data gathering and real-time guidance.

How AstroBone uses it:

- Prevention, assessment, response, monitoring, and delayed handoff are first-class functions.
- The system supports crew decisions but does not replace qualified medical authority.

### Exploration Medical Technologies

Link: https://www.nasa.gov/glenn/glenn-expertise-space-exploration/human-health-performance/exploration-medical-technologies/

Why it matters:

- NASA identifies in-flight imaging, health monitoring, analysis, and medical inventory as important
  capabilities for exploration.

How AstroBone uses it:

- Future integration targets include ultrasound, wearable monitoring, medical inventory, and
  protocol-linked consumables.

## CT/QCT And Finite Element Fracture Prediction

### CT-Based FE Prediction Of Femoral Fracture Load

Link: https://pubmed.ncbi.nlm.nih.gov/9593205/

Why it matters:

- Classic support for CT-based finite-element models estimating femoral fracture load.
- Includes loading conditions related to gait stance and fall impact.

How AstroBone uses it:

- Long-term validation direction for femur module.
- Supports the claim that anatomy-specific geometry and material properties matter.

### Robust QCT/FEA Models Of Proximal Femur

Link: https://pmc.ncbi.nlm.nih.gov/articles/PMC3870095/

Why it matters:

- Discusses QCT-based FE models for estimating proximal femur strength, stress, and strain.

How AstroBone uses it:

- Reference for FEA validation plan.
- Helps decide what outputs matter: stiffness, fracture load, stress, strain.

### FE Analysis And Hip Fracture Risk

Link: https://pmc.ncbi.nlm.nih.gov/articles/PMC2659519/

Why it matters:

- Studies association between FE-derived hip strength and fracture risk.

How AstroBone uses it:

- Supports separating "bone strength/capacity" from "applied demand."

### Review Of CT-Based FE Fracture Risk

Link: https://pmc.ncbi.nlm.nih.gov/articles/PMC10941185/

Why it matters:

- Useful overview of where CT/FEA fracture assessment is effective and what its limits are.

How AstroBone uses it:

- Validation section and limitations statement.

## Bone Remodeling And Mechanostat Concepts

### Frost Mechanostat

Links:

- https://pubmed.ncbi.nlm.nih.gov/3688455/
- https://pubmed.ncbi.nlm.nih.gov/20516629/

Why it matters:

- Gives a conceptual model for bone adaptation to mechanical loading.
- Useful for explaining how reduced mechanical loading can change skeletal adaptation during spaceflight.

How AstroBone uses it:

- Bone adaptation explanation.
- Long-term remodeling module.

### Mathematical Modeling Of Bone Remodeling Review

Link: https://pmc.ncbi.nlm.nih.gov/articles/PMC11864782/

Why it matters:

- Broad review of biochemical and mechanobiological models.

How AstroBone uses it:

- Helps choose whether the first remodeling model should be simple mechanostat, cellular, or hybrid.

## Simulink And Simscape

### Simscape Multibody Overview

Link: https://www.mathworks.com/products/simscape-multibody.html

Why it matters:

- Official MathWorks description of multibody dynamics with bodies, joints, constraints, force elements, sensors, and 3D animation.

How AstroBone uses it:

- Build lower-limb multibody dynamics backend.

### Simscape Multibody Contact

Links:

- https://www.mathworks.com/help/sm/ug/modeling-contact-force-between-two-solids.html
- https://www.mathworks.com/help/sm/ref/spatialcontactforce.html
- https://www.mathworks.com/help/sm/ug/use-contact-proxies.html

Why it matters:

- Contact modeling is central to the impact simulation.
- MathWorks uses penalty-style contact with spring-damper behavior.

How AstroBone uses it:

- Model impact object against target-region contact proxy.
- Sweep stiffness, damping, friction, speed, and angle.

### CAD/URDF Import

Links:

- https://www.mathworks.com/help/sm/ref/smimport.html
- https://www.mathworks.com/help/sm/ug/cad-translation.html
- https://www.mathworks.com/help/sm/ug/urdf-import.html

Why it matters:

- Needed if we create anatomy/collision assemblies outside MATLAB.

How AstroBone uses it:

- Import simplified lower-limb assemblies into Simscape.

### Flexible Bodies

Links:

- https://www.mathworks.com/help/sm/ref/generalflexiblebeam.html
- https://www.mathworks.com/help/sm/ref/reducedorderflexiblesolid.html
- https://www.mathworks.com/help/sm/ug/modal-reduction-for-flexible-bodies.html

Why it matters:

- Rigid bodies can estimate collision loads but not strain distribution.
- Flexible bodies or FEA are needed for deformation/strain approximation.

How AstroBone uses it:

- Start with flexible beam tibia/femur approximation.
- Later move to reduced-order flexible solids from mesh/FEA.
