# Space-Specific Bone Data Plan

> Dataset catalogue, not the active model plan. The current competition scope is
> frozen in `architecture-freeze-v2.md`; animal data must not calibrate human
> capacity.

There is no large public "astronaut fracture image dataset" comparable to GRAZPEDWRI-DX or FracAtlas. Real astronaut skeletal health data exists, but it is sensitive medical data and is often controlled, aggregated, or summarized through NASA human research channels.

For AstroBone, the proper space-specific data strategy is:

1. Use clinical X-ray datasets for fracture detection.
2. Use NASA spaceflight/analog bone datasets for microgravity bone-loss modeling.
3. Use Simulink/Simscape to generate physics scenarios.
4. Fuse all streams in the digital twin.

## Best Space-Bone Dataset To Start With

### NASA OSDR OSD-804 - Rodent Research-1 Bone MicroCT/Histology

Use for:

- spaceflight-specific bone-loss modeling
- microCT/histology feature extraction
- femur-focused skeletal fragility priors
- biological validation of "space mode"

Why it matters:

- NASA Rodent Research-1 mission
- mice flown on the ISS for 37 days
- microcomputed tomography and histological analyses of bone
- reported site-specific cancellous and cortical bone loss in femur
- directly relevant to microgravity-induced skeletal fragility

Links:

- OSDR study: https://osdr.nasa.gov/bio/repo/data/studies/OSD-804
- Data.gov mirror: https://catalog.data.gov/dataset/37-day-microgravity-exposure-in-16-week-female-c57bl-6j-mice-during-the-nasa-rodent-resear
- Related paper: https://pmc.ncbi.nlm.nih.gov/articles/PMC11940681/

Recommended use in AstroBone:

```text
Input: flight vs ground-control mouse bone measurements
Output: microgravity fragility modifier
Model type: statistical/ML, not large deep learning
Twin effect: update bone-strength index and uncertainty bands
```

## Other NASA Space-Bone / Microgravity Datasets

### NASA LSDA/NLSP - 14-Day Spaceflight Bone Measurements

Use for:

- bone length, densitometry, and microCT measurements after spaceflight
- animal-model comparison against OSD-804

Why it matters:

- includes bone length, densitometry, and microCT measurements
- spaceflight duration is shorter than RR-1, useful for time-response comparison

Link:

- NLSP record: https://nlsp.nasa.gov/view/lsdapub/lsda_dataset/IDP-LSDA_DATASET-0000000000001558

### NASA OSDR OSD-133 - Medaka Osteoclast

Use for:

- osteoclast activation biology
- molecular response to altered gravity
- mechanistic explanation layer

Why it matters:

- bone mineral density loss in spaceflight is strongly connected to bone resorption
- osteoclast behavior helps explain why unloading changes bone balance

Link:

- OSDR study: https://osdr.nasa.gov/bio/repo/data/studies/OSD-133

### NASA Open Data - Osteoclast Differentiation In Modeled Microgravity

Use for:

- simulated microgravity cell-response modeling
- omics/cell-level ML experiments

Why it matters:

- modeled microgravity experiments can help explain mechanisms when human data is unavailable
- useful for the assistant's scientific explanation, not direct fracture detection

Link:

- NASA data portal: https://data.nasa.gov/dataset/microarray-profile-of-gene-expression-during-osteoclast-differentiation-in-modeled-microgr

## Human Astronaut Bone Data

### NASA Bone and Mineral Evaluation and Analysis

Use for:

- human-spaceflight framing
- target skeletal regions
- expected rate of bone loss
- model assumptions and validation priors

Why it matters:

- NASA monitors astronauts pre/post-flight with DXA scans.
- NASA states astronauts can lose around 1% to 2% bone density per month in the hip and spine.
- It explains that NASA also studies QCT, pQCT, MRI, and biochemical markers.

Link:

- https://www.nasa.gov/directorates/esdmd/hhp/bone-and-mineral-evaluation-and-analysis/

### NASA Human Research Program Bone Risk Evidence

Use for:

- risk statement
- citations
- validation language
- limitations

Link:

- https://ntrs.nasa.gov/api/citations/20240005190/downloads/2024%20FINAL%20HRP-F07-ERft%20R2%20Fracture.pdf?attachment=true

Important:

- Do not expect raw astronaut medical records to be openly downloadable.
- Treat astronaut DXA/BMD values as controlled human-subject data unless NASA explicitly publishes a de-identified dataset.

## Spaceflight Analog Data

### Bed Rest Studies

Use for:

- human unloading analog
- validation of bone-loss rate and recovery
- countermeasure testing

Candidate sources:

- NASA/NLSP 17-week horizontal bedrest summarized dataset: https://nlsp.nasa.gov/view/lsdapub/lsda_dataset/IDP-LSDA_DATASET-0000000000002437
- AGBRESA / head-down tilt bed rest publications

How to use:

```text
Input: bed-rest duration, countermeasure condition, BMD/biomarker change
Output: analog fragility curve
Model type: mixed-effects regression / Bayesian model
```

## What To Train

### Do Not Train A Space Fracture Detector From Only Space Data

The space-specific datasets are too small and not fracture-image datasets. A CNN/YOLO model trained only on these would be weak and scientifically misleading.

### Train These Instead

#### Model A - Clinical Fracture Detector

Datasets:

- GRAZPEDWRI-DX
- FracAtlas

Task:

- fracture localization and segmentation from X-rays

#### Model B - Space Bone Fragility Estimator

Datasets:

- OSD-804
- LSDA/NLSP 14-day spaceflight bone dataset
- bed-rest analog summaries

Task:

- estimate bone-strength index shift after microgravity or unloading

Recommended methods:

- regression
- Bayesian model
- random forest / gradient boosting
- small neural network only if there is enough tabular/omics data

#### Model C - Biology Explanation Model

Datasets:

- OSD-133
- osteoclast modeled microgravity microarray data

Task:

- explain bone resorption / formation imbalance
- identify pathways related to microgravity response

Recommended methods:

- differential expression
- pathway analysis
- SHAP on small ML classifiers

#### Model D - Synthetic Impact/Risk Model

Data source:

- Simulink/Simscape generated sweeps

Task:

- map impact mass, speed, angle, contact area, and bone-strength state to risk bands

Recommended methods:

- physics-informed surrogate model
- uncertainty-aware regression

## Recommended AstroBone Fusion

```text
Clinical image model:
  "Is a fracture visible now?"

Space bone model:
  "How fragile is this skeleton under microgravity/unloading?"

Physics model:
  "What stress/strain does this impact generate?"

Digital twin:
  "Where is the load, what is the risk band, and why?"
```

This is the NASA-facing architecture. The space datasets do not replace clinical fracture datasets; they make the fracture-risk model space-relevant.

## Immediate Next Step

Start with OSD-804.

1. Download OSD-804 metadata and files through NASA OSDR.
2. Inspect available microCT/histology tables and images.
3. Build a small notebook:
   - flight vs ground control
   - femur vs vertebra
   - cancellous vs cortical metrics
   - fragility modifier estimate
4. Feed the resulting modifier into `src/riskModel.js`.

This gives AstroBone a real space-biology backbone.
