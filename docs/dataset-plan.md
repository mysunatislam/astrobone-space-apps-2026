# Deep Learning Dataset Plan

> Historical dataset plan. Use `architecture-freeze-v2.md` and
> `parameter-evidence-table.md` for the active scope and claim boundary.

AstroBone needs more than one dataset. There is no public astronaut fracture dataset suitable for training a diagnostic model, so the credible path is:

1. Train vision models on public fracture imaging datasets.
2. Use Simulink/Simscape and mathematical models for physics/risk simulation.
3. Connect both streams in the web digital twin.

The model must be described as fracture detection/risk-estimation research, not clinical diagnosis.

## Recommended Primary Dataset

### GRAZPEDWRI-DX

Use for:

- fracture object detection
- bounding-box localization
- YOLO-style training
- first deep learning demo

Why this is the best first dataset:

- 20,327 pediatric wrist trauma X-ray images
- 6,091 patients and 10,643 studies
- 74,459 image labels and 67,771 labeled objects
- includes fracture annotations
- public, research-grade paper
- CC BY 4.0 license
- existing YOLO baselines make it easier to compare our results

Links:

- Paper: https://www.nature.com/articles/s41597-022-01328-z
- Dataset landing page: https://figshare.com/articles/dataset/GRAZPEDWRI-DX/14825193
- Common YOLO split: https://ruiyangju.github.io/GRAZPEDWRI-DX_JU/

Recommended first model:

```text
YOLOv8 / YOLOv10 object detection
Input: wrist X-ray
Output: fracture bounding box + confidence
Metrics: mAP@50, mAP@50-95, precision, recall
```

Why it is not enough:

- pediatric wrist only
- not leg/tibia/femur
- X-ray detection, not true early stress-fracture prediction

## Recommended Second Dataset

### FracAtlas

Use for:

- multi-region fracture classification
- localization
- segmentation
- leg/hip/shoulder/hand variety

Why it matters:

- 4,083 musculoskeletal X-ray images
- 717 fracture images
- 922 fracture instances
- annotations in COCO, VGG, YOLO, and Pascal VOC formats
- includes hand, leg, hip, and shoulder scans
- useful for segmentation masks and multi-region demo

Links:

- Paper: https://www.nature.com/articles/s41597-023-02432-4
- Dataset: https://figshare.com/articles/dataset/The_dataset/22363012
- Hugging Face mirror/loader: https://huggingface.co/datasets/yh0701/FracAtlas_dataset

Recommended model:

```text
Stage 1: EfficientNet/ConvNeXt classifier for fracture vs non-fracture
Stage 2: YOLO or Mask R-CNN for localization/segmentation
Stage 3: Grad-CAM/attention map export into the digital twin UI
```

Why it is not enough:

- much smaller than GRAZPEDWRI-DX
- fracture-positive class is imbalanced
- still radiograph-based, not physics/impact data

## Useful Pretraining Dataset

### MURA

Use for:

- musculoskeletal radiograph pretraining
- abnormality classification
- representation learning

Why it matters:

- 40,561 multi-view upper-extremity radiographic images
- 14,863 studies from 12,173 patients
- radiologist-labeled normal/abnormal

Links:

- Official page: https://stanfordmlgroup.github.io/competitions/mura/
- Stanford AIMI page: https://aimi.stanford.edu/datasets/mura-msk-xrays

Important limitation:

- MURA labels abnormality, not fracture specifically.
- It is useful for pretraining or abnormality triage, not as the main fracture localization dataset.

## Lower-Limb Reference Dataset

### LERA - Lower Extremity Radiographs

Use for:

- lower-extremity radiograph orientation/type work
- normal/abnormal testing
- possible lower-limb pretraining

Links:

- Stanford AIMI: https://aimi.stanford.edu/datasets/lera-lower-extremity-radiographs

Important limitation:

- small public dataset
- normal/abnormal labels, not detailed fracture boxes
- not enough alone for a strong fracture model

## 3D CT Datasets

These are not leg datasets, but they are useful if we want a serious 3D medical-imaging pipeline.

### RSNA 2022 Cervical Spine Fracture Detection

Use for:

- 3D CT fracture classification
- vertebra-level labels
- DICOM processing
- segmentation/bounding-box learning

Links:

- Paper: https://pubs.rsna.org/doi/10.1148/ryai.230034
- Kaggle competition: https://www.kaggle.com/competitions/rsna-2022-cervical-spine-fracture-detection/
- Health Data Nexus version: https://healthdatanexus.ai/content/cspine/1.0.0/

Why it matters:

- 3,112 CT scans in the RSNA/Kaggle dataset
- expert annotations
- noncommercial research availability

### RibFrac

Use for:

- 3D CT fracture segmentation
- instance segmentation
- 3D U-Net experiments

Links:

- Project page: https://m3dv.github.io/FracNet/
- Zenodo: https://zenodo.org/records/3893508

Why it matters:

- public CT benchmark for rib fracture detection/segmentation/classification
- voxel-level labels
- good for learning 3D fracture segmentation workflow

Important limitation:

- ribs, not legs
- CC BY-NC 4.0 license

## What We Should Not Use As The Main Dataset

Avoid making the core model depend on random Kaggle fracture folders unless:

- original source is clear
- license is clear
- label quality is documented
- patient/data leakage can be checked
- train/validation/test split is patient-safe

Many Kaggle fracture datasets are good for quick experiments but weak for a NASA-facing research story.

## Recommended Training Roadmap

### Model 1 - Fracture Detector MVP

Dataset:

- GRAZPEDWRI-DX

Model:

- YOLOv8 or YOLOv10

Output:

- fracture bounding box
- confidence
- Grad-CAM or detection overlay

Purpose:

- prove that the project has a real deep learning component

### Model 2 - Multi-Region Fracture Model

Dataset:

- FracAtlas

Model:

- classifier + detector/segmenter

Output:

- fracture/no fracture
- region
- mask or box

Purpose:

- connect AI prediction to body-region map in the 3D twin

### Model 3 - 3D CT Research Model

Dataset:

- RSNA cervical spine CT or RibFrac

Model:

- 3D CNN / 3D U-Net

Output:

- fracture score with explicit calibration status
- voxel/segment localization

Purpose:

- learn serious volumetric medical imaging workflow

### Model 4 - AstroBone Fusion Model

Inputs:

- image-model prediction
- impact simulation outputs
- bone fragility parameters
- uncertainty band

Output:

- explainable risk report
- 3D visualization
- assistant explanation

This is the model that makes AstroBone different from a normal fracture detector.

## Data Folder Policy

Do not commit datasets to git.

Recommended local structure:

```text
data/
  raw/
    grazpedwri-dx/
    fracatlas/
    mura/
    rsna-cspine/
  processed/
    grazpedwri-yolo/
    fracatlas-coco/
  splits/
  reports/
```

Keep only scripts, metadata, and notes in the repo.

## Immediate Decision

Start with:

```text
GRAZPEDWRI-DX for detection
FracAtlas for multi-region segmentation
```

This pair gives the project a strong public-data foundation.

## Space-Specific Add-On

For astronaut/space-traveler bone modeling, use the companion plan:

```text
docs/space-bone-datasets.md
```

The key starting point is NASA OSDR `OSD-804`, a Rodent Research-1 spaceflight bone dataset with microCT and histology data from mice flown on the ISS for 37 days. It should be used to estimate microgravity-linked fragility, not to train a clinical X-ray fracture detector.
