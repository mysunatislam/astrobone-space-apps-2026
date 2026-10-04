# AstroBone Third-Party Data, Models, Assets, And Software

This file records external resources used by the public prototype. Their original licenses apply to those materials; AstroBone's MIT license does not replace them.

## NASA Data And Resources

### NASA OSDR-575 and OSDR-435

- [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575): Inspiration4 serum cardiovascular panel, CC0-1.0. AstroBone displays cohort median CRP for seven study visits; 28 records, four people. Not personal wearable data.
- [OSD-435](https://osdr.nasa.gov/bio/repo/data/studies/OSD-435): public, unrestricted mouse radiation/cardiac echocardiography and ISA metadata. Study DOI: https://doi.org/10.26030/dc1p-q547. Related paper: https://doi.org/10.1016/j.lssr.2019.01.003. Original data terms apply; only attributed derived group summaries are bundled, not an assertion of MIT licensing over NASA research files.
- Transformations, exclusions, original URLs and source hashes: `docs/mission-health-data.md` and `public/data/mission-research.json`.
- NASA cohorts are external evidence, never assigned to the fictional demo astronaut or used as a clinical calibration set.

### NASA Open Science Data Repository OSDR-804 / LSDS-130

- Study: Rodent Research-1 bone microCT data
- URL: https://osdr.nasa.gov/bio/repo/data/studies/OSD-804
- DOI: https://doi.org/10.26030/yh5h-h706
- License: CC0 1.0
- Used files: `data/LSDS-130_microCT_Cahill_microCT_TRANSFORMED.csv` and `data/LSDS-130_microCT_Data_Dictionary.csv`
- Use: AstroBone derives flight-versus-ground-control summary statistics displayed as spaceflight biological evidence.
- Boundary: mouse microCT data is not human or astronaut fracture-risk calibration.

NASA public research pages and technical reports cited by AstroBone are listed in the app and research documentation. NASA names and links identify source material and do not imply NASA endorsement.

## Fracture Imaging Data

### FracAtlas

- Paper: https://pmc.ncbi.nlm.nih.gov/articles/PMC10404222/
- DOI: https://doi.org/10.1038/s41597-023-02432-4
- License: CC BY 4.0, as published with the dataset
- Use: prototype DenseNet121 classification, U-Net++ localization, and the held-out demonstration image `IMG0001739.jpg` with a derived overlay.
- Boundary: public clinical radiographs are not astronaut medical images.

## 3D Asset

### User-supplied clothed human

- Supplied source: `D:/Downloads/human_body_clothed.glb`
- Local file: `public/models/human_body_clothed.glb`
- Contents: 163-joint skin, textured clothing/body, finger and jaw bones, four animation clips.
- Changes in AstroBone: runtime scaling, anatomical rig mapping, and pose/hand/jaw retargeting.
- Creator and redistribution license: not provided with this local asset. Confirm source attribution and redistribution rights before publishing this replacement model. AstroBone's code license does not license this asset.

## Computer-Vision Model And Runtime

### MediaPipe Pose Landmarker Lite

- Project: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- Model source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- Runtime package: `@mediapipe/tasks-vision`
- License: Apache License 2.0
- Model SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- Use: browser-local body landmarks for non-diagnostic movement summaries and skeleton retargeting.

### EfficientDet-Lite0 Object Detector

- Guide: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js
- Model source: https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite
- Runtime package: `@mediapipe/tasks-vision`
- License: Apache License 2.0
- Model SHA-256: `2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b`
- Use: browser-local supported-object labels and pixel bounding boxes for coarse left/ahead/right and area-change cues.
- Boundary: the COCO-trained model does not represent every object, mission equipment requires a custom dataset, and monocular box growth is not calibrated distance or collision prediction.

### MediaPipe Hand and Face Landmark models

- Hand guide: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- Hand bundle: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- Face guide: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Face bundle: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Runtime: `@mediapipe/tasks-vision`, Apache License 2.0. Model usage is subject to the source model terms.
- Use: local finger tracking, facial mesh, eye/lip observations, and bounded jaw animation.
- Boundary: these models estimate landmarks and expression coefficients; the eye-closure cue is an unvalidated prototype rule and does not establish sleep or a health condition.
- QA-only image: https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/woman_hands.jpg, linked by the official MediaPipe sample notebook. Kept under `.artifacts`, not bundled or displayed as user data.

## Main Software Libraries

- Three.js: https://github.com/mrdoob/three.js, MIT License
- Vite: https://github.com/vitejs/vite, MIT License
- Playwright: https://github.com/microsoft/playwright, Apache License 2.0
- Capacitor Core and Android: https://github.com/ionic-team/capacitor, MIT License
- Capacitor Filesystem and Share plugins: https://github.com/ionic-team/capacitor-plugins, MIT License
- FastAPI: https://github.com/fastapi/fastapi, MIT License
- PyTorch: https://github.com/pytorch/pytorch, BSD-style license
- torchvision: https://github.com/pytorch/vision, BSD-style license
- segmentation-models-pytorch: https://github.com/qubvel-org/segmentation_models.pytorch, MIT License

Consult `package-lock.json`, `requirements-api.txt`, and `requirements-ml.txt` for the complete dependency set and versions installed for a given build.

## Optional Local Vision Runtime

Model code and weights are downloaded separately under `E:\AstroBoneRuntime\vision`,
not shipped in the website or Android package. `manifest.json` records revisions,
source URLs and SHA-256 checksums.

- InstantHMR: https://github.com/mohamdev/InstantHMR, Apache-2.0 code; distilled
  weights at https://huggingface.co/momolesang/InstantHMR use the SAM license.
- MHR: https://github.com/facebookresearch/MHR, Apache-2.0; asset release v1.0.1.
- RTMW/MMPose: https://github.com/open-mmlab/mmpose, Apache-2.0 code. Review model
  checkpoint and upstream training-data terms before redistribution.
- RTMLib: https://github.com/Tau-J/rtmlib, Apache-2.0.
- ONNX Runtime: https://github.com/microsoft/onnxruntime, MIT.
- The browser POS implementation is based on the mathematical method in Wang et
  al., "Algorithmic Principles of Remote PPG," IEEE TBME 64(7), 2017, 1479-1491;
  the reference implementation is https://github.com/ubicomplab/rPPG-Toolbox.
- The One Euro filter implements Casiez et al. (2012), https://gery.casiez.net/1euro/.

## Team-Generated Evidence

### DensePose And Musculoskeletal Atlas

- DensePose / Detectron2: https://github.com/facebookresearch/detectron2,
  revision `fc3b7a1e658db27cdb52ee94ef5dcec7cc7eb1e7`, Apache-2.0 code.
- DensePose R50-FPN s1x checkpoint `model_final_162be9.pkl`: CC BY-SA 3.0,
  documented in the upstream `projects/DensePose/doc/DENSEPOSE_IUV.md`.
  Stored only in the optional local WSL runtime, not the website bundle.
- Z-Anatomy: https://github.com/LluisV/Z-Anatomy,
  revision `6c7f9016bd5899ac8edafd31b9900c151df42ed6`, CC BY-SA 4.0.
- BodyParts3D by DBCLS: CC BY-SA 2.1 Japan, credited by Z-Anatomy.
  Full source notices are preserved at `public/models/anatomy/SOURCE-LICENSE.txt`.
  The derived GLB has been converted, annotation markers removed, simplified,
  and compressed. It retains named skeletal and muscular mesh structures.
  `musculoskeletal-rigged.glb` additionally merges those structures into two
  render layers and adds 64 manual reference joints, rigid skeletal attachments,
  and approximate two-joint muscle skinning. `rig-manifest.json` preserves every
  structure-to-joint assignment, pinned source revision, and source/output hashes.
  This derivative is not covered by the app's MIT license; retain attribution
  and the applicable ShareAlike license when redistributing it.
- NASA photograph used only for local DensePose smoke testing:
  https://www.nasa.gov/image-article/astronaut-bob-hines-works-out-space-station/,
  image asset `iss067e180951.jpg`, credit NASA. It is not training data and
  does not establish model accuracy, an astronaut health finding, or endorsement.

The Level-A Simulink model exports, deterministic web artifact, transformed NASA summary, application code, documentation, and QA harness were assembled for AstroBone. Mathematical agreement and synthetic uncertainty outputs are labeled as internal research evidence, not third-party validation.

### Cardiovascular Reference Assets And Equations

- `public/models/anatomy/cardiovascular.glb`: derivative of Z-Anatomy's
  `CardioVascular41.fbx`, same pinned revision and ShareAlike attribution above.
  Annotation markers removed; named surfaces grouped, simplified and compressed.
  The manifest retains source names, coordinates, source/output SHA-256 hashes.
  Static reference geometry only; no subject-specific reconstruction or CFD mesh.
- IUPS Physiome Model Repository, "Lumped-parameter cardiovascular model with
  Windkessel after-load": https://models.physiomeproject.org/e/43/MainWindKessel.cellml
  CC BY 3.0: https://models.physiomeproject.org/e/43/MainWindKessel.cellml/license_citation
  Unmodified generated equations and source units are retained in
  `scripts/vendor/physiome/`. AstroBone's separate wrapper uses SciPy LSODA,
  varies only cycle period, converts pressure units and exports reference traces.
  These model files and derived outputs are not relicensed as MIT.
- NASA OSDR OSD-569 (Inspiration4 complete blood count) and OSD-656 (urine
  immune-protein panel): only visible, unrestricted artifacts were downloaded
  through OSDR file metadata. Derived descriptive summaries retain accession,
  canonical download URL, field, unit, exclusion rules and source SHA-256.
  No participant-level identifiers are bundled in the public summaries.

### Presentation Media (`public/pitch/`)

- `squat-pexels-4921644.mp4`: Pexels video 4921644, used under the Pexels
  License (https://www.pexels.com/license/). Pose tracking runs on it live in
  the presentation.
- `broll-bone-loss.mp4` and `concept-camera-baseline.mp4`: generated by the
  team with Google Gemini; labeled as AI-generated wherever shown.
- `team-*.webp` / `team-*.jpg`: team member photos supplied by the team for
  this presentation. Not licensed for reuse.
