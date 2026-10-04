import "./styles.css";
import "./uiV5.js";
import { initCompanion } from "./companionPanel.js";
import { initHealthLayers } from "./healthLayers.js";
import { initLocalMesh } from "./localMesh.js";
import { initResearchWorkspace } from "./researchWorkspace.js";
import { applyTechnicalHuman } from "./technicalHuman.js";
import "./technicalHuman.css";
import { initAnatomyAtlas } from "./anatomyAtlas.js";
import { initDensePose } from "./densePose.js";
import { initAnatomicalMotion } from "./anatomicalMotion.js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MODEL_DEFAULTS, TARGET_META, calculateRisk } from "./riskModel.js";
import { calculateDecision } from "./decisionModel.js";
import { calculateCarePlan } from "./carePlan.js";
import { PoseAssessmentController } from "./poseAssessment.js";
import { validateExerciseVideo } from "./videoEvidence.js";
import { isPausedVideoPose } from "./videoPoseTrack.js";
import { CrewSafetyMonitor } from "./safetyMonitor.js";
import { VoiceAssistant } from "./voiceAssistant.js";
import {
  MotionGuardAnalyzer,
  MOTION_GUARD_JOINTS,
  MOTION_GUARD_MODES,
} from "./motionGuard.js";
import { normalizeVideoInputs } from "./cameraDevices.js";
import { buildMissionReview, compareMissionScenarios } from "./missionReview.js";
import { bindHumanRig } from "./humanRig.js";
import { FaceActivityObserver } from "./detailObservations.js";
import { SkeletalRetargeter, hasLiveSegments, fitTrackedRigInView } from "./skeletalRetargeter.js";
import {
  MOVEMENT_EVIDENCE_SCHEMA_VERSION,
  createMovementEvidencePacket,
} from "./movementEvidence.js";
import { validateImageEvidence } from "./imageEvidence.js";
import { XrayApiClient } from "./xrayApi.js";
import {
  buildTimestampedJsonFilename,
  nativeRuntime,
  shareJsonEvidence,
} from "./nativeRuntime.js";
import {
  compareRiskToSimulation,
  simulationScenarioToUiState,
  validateSimulationEvidence,
} from "./simulationEvidence.js";
import "./labShell.js"; // shared header, menu and palette with the twin (imported last: its theme wins)

const WEB_MODEL_INPUTS = Object.freeze({
  impactDurationMs: MODEL_DEFAULTS.impactDurationMs,
  boneModulusGPa: MODEL_DEFAULTS.boneModulusGPa,
  baselineCapacityMPa: MODEL_DEFAULTS.baselineCapacityMPa,
  monthlyMicrogravityLossRate: MODEL_DEFAULTS.monthlyMicrogravityLossRate,
  maximumMicrogravityLossFraction: MODEL_DEFAULTS.maximumMicrogravityLossFraction,
});

const state = {
  ...WEB_MODEL_INPUTS,
  mode: "space",
  objectType: "evaTool",
  motionMode: "stand",
  target: "tibia",
  mass: 2000,
  speed: 4,
  angle: 75,
  contactArea: 12,
  boneIndex: 0.9,
  microgravityDays: 180,
  painScore: 6,
  swelling: "moderate",
  mobility: "limited",
  sensationChange: false,
};

const aiState = {
  loaded: false,
  fractureScore: null,
  fractureDetected: false,
  maskAreaFraction: null,
  overlaySrc: "",
  warning: "Research model score. Not a calibrated probability or diagnosis.",
  provenance: "DenseNet121 + U-Net++ | FracAtlas held-out evaluation",
};

const functionalState = {
  currentPose: null,
  currentDetails: null,
  result: null,
  baseline: null,
  latestResult: null,
  calibration: null,
};

const simulationEvidenceState = {
  available: false,
  active: false,
  evidence: null,
  comparison: null,
  error: "",
};

const nasaEvidenceState = {
  available: false,
  summary: null,
};

function appAssetUrl(path) {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\/+/, "")}`;
}

let workflowStage = 0;
const incidentLog = [];
const completedCareActions = new Set();
let scenarioReference = null;
const safetyEventLog = [];
let safetyAlertTimer = null;
let selectedCameraFacing = "user";
let selectedCameraDeviceId = "";
let mirrorBeforeVideo = null;
const motionGuardTrace = {
  lastTimestamp: null,
  maxSamples: 120,
  samples: [],
};

const workflowStages = [
  {
    title: "Collect structural evidence",
    description:
      "Connect an image result when available, while preserving a clear path for action when imaging is delayed or unavailable.",
    nextLabel: "Next: event",
  },
  {
    title: "Reconstruct the event",
    description:
      "Define where the load lands and how mass, speed, angle, and contact area concentrate energy.",
    nextLabel: "Next: crew",
  },
  {
    title: "Assess reserve and condition",
    description:
      "Combine skeletal reserve with reported symptoms and function to set operational urgency.",
    nextLabel: "Next: response",
  },
  {
    title: "Build the response and handoff",
    description:
      "Turn evidence into checkable actions, a trend log, and a compact packet for remote medical review.",
    nextLabel: "Restart review",
  },
];

const OBJECT_META = {
  evaTool: { label: "EVA hand tool", hudLabel: "EVA hand tool" },
};

const presets = {
  eva: {
    ...WEB_MODEL_INPUTS,
    mode: "space",
    objectType: "evaTool",
    motionMode: "stand",
    target: "tibia",
    mass: 2000,
    speed: 4,
    angle: 75,
    contactArea: 12,
    boneIndex: 0.9,
    microgravityDays: 180,
    painScore: 6,
    swelling: "moderate",
    mobility: "limited",
    sensationChange: false,
  },
};

const refs = {
  canvas: document.querySelector("#twin-canvas"),
  twinViewGrid: document.querySelector("#twin-view-grid"),
  brandSubtitle: document.querySelector("#brand-subtitle"),
  platformStatus: document.querySelector("#platform-status"),
  missionQuestion: document.querySelector("#mission-question"),
  problemCopy: document.querySelector("#problem-copy"),
  solutionCopy: document.querySelector("#solution-copy"),
  lifecycleTitle: document.querySelector("#lifecycle-title"),
  helpPrevent: document.querySelector("#help-prevent"),
  helpAssess: document.querySelector("#help-assess"),
  helpRespond: document.querySelector("#help-respond"),
  helpMonitor: document.querySelector("#help-monitor"),
  guidedDemo: document.querySelector("#guided-demo"),
  sceneDecisionScore: document.querySelector("#scene-decision-score"),
  sceneEvidenceCount: document.querySelector("#scene-evidence-count"),
  riskScore: document.querySelector("#risk-score"),
  riskStatus: document.querySelector("#risk-status"),
  loadPath: document.querySelector("#load-path"),
  impactObjectLabel: document.querySelector("#impact-object-label"),
  activeObjectName: document.querySelector("#active-object-name"),
  energyMetric: document.querySelector("#energy-metric"),
  stressMetric: document.querySelector("#stress-metric"),
  fragilityMetric: document.querySelector("#fragility-metric"),
  confidenceMetric: document.querySelector("#confidence-metric"),
  targetRegion: document.querySelector("#target-region"),
  mass: document.querySelector("#mass"),
  speed: document.querySelector("#speed"),
  angle: document.querySelector("#angle"),
  contactArea: document.querySelector("#contact-area"),
  boneIndex: document.querySelector("#bone-index"),
  microgravityDays: document.querySelector("#microgravity-days"),
  painScore: document.querySelector("#pain-score"),
  swelling: document.querySelector("#swelling"),
  mobility: document.querySelector("#mobility"),
  sensationChange: document.querySelector("#sensation-change"),
  massOutput: document.querySelector("#mass-output"),
  speedOutput: document.querySelector("#speed-output"),
  angleOutput: document.querySelector("#angle-output"),
  areaOutput: document.querySelector("#area-output"),
  boneOutput: document.querySelector("#bone-output"),
  daysOutput: document.querySelector("#days-output"),
  painOutput: document.querySelector("#pain-output"),
  spaceFields: document.querySelector("#space-fields"),
  assistantMode: document.querySelector("#assistant-mode"),
  supportPanelTitle: document.querySelector("#support-panel-title"),
  conditionHeading: document.querySelector("#condition-heading"),
  mobilityLabel: document.querySelector("#mobility-label"),
  tabLabelEvidence: document.querySelector("#tab-label-evidence"),
  tabLabelImpact: document.querySelector("#tab-label-impact"),
  tabLabelBone: document.querySelector("#tab-label-bone"),
  tabLabelDecision: document.querySelector("#tab-label-decision"),
  responseTimelineLabel: document.querySelector("#response-timeline-label"),
  chatLog: document.querySelector("#chat-log"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  resetButton: document.querySelector("#reset-button"),
  aiPanel: document.querySelector("#ai-panel"),
  aiDecision: document.querySelector("#ai-decision"),
  aiScore: document.querySelector("#ai-score"),
  aiMaskArea: document.querySelector("#ai-mask-area"),
  aiOverlay: document.querySelector("#ai-overlay"),
  aiEmptyState: document.querySelector("#ai-empty-state"),
  aiEmptyText: document.querySelector("#ai-empty-text"),
  aiWarning: document.querySelector("#ai-warning"),
  aiProvenance: document.querySelector("#ai-provenance"),
  aiServiceStatus: document.querySelector("#ai-service-status"),
  analyzeXray: document.querySelector("#analyze-xray"),
  loadDemoPrediction: document.querySelector("#load-demo-prediction"),
  clearPrediction: document.querySelector("#clear-prediction"),
  xrayFile: document.querySelector("#xray-file"),
  nativeApiConfig: document.querySelector("#native-api-config"),
  apiBaseUrl: document.querySelector("#api-base-url"),
  saveApiBase: document.querySelector("#save-api-base"),
  clearApiBase: document.querySelector("#clear-api-base"),
  apiBaseStatus: document.querySelector("#api-base-status"),
  poseVideo: document.querySelector("#pose-video"),
  poseOverlay: document.querySelector("#pose-overlay"),
  poseViewport: document.querySelector("#pose-viewport"),
  poseEmpty: document.querySelector("#pose-empty"),
  poseLinkState: document.querySelector("#pose-link-state"),
  poseLiveFps: document.querySelector("#pose-live-fps"),
  cameraStatus: document.querySelector("#camera-status"),
  twinFeedLabel: document.querySelector("#twin-feed-label"),
  motionGuardTraceCanvas: document.querySelector("#motionguard-trace-canvas"),
  motionGuardTraceJoint: document.querySelector("#motionguard-trace-joint"),
  twinLeftKnee: document.querySelector("#twin-left-knee"),
  twinRightKnee: document.querySelector("#twin-right-knee"),
  twinLeftKneeBar: document.querySelector("#twin-left-knee-bar"),
  twinRightKneeBar: document.querySelector("#twin-right-knee-bar"),
  twinLeftJointLabel: document.querySelector("#twin-left-joint-label"),
  twinRightJointLabel: document.querySelector("#twin-right-joint-label"),
  twinKneeDifference: document.querySelector("#twin-knee-difference"),
  twinMotionState: document.querySelector("#twin-motion-state"),
  assessmentProgress: document.querySelector("#assessment-progress"),
  trackingQuality: document.querySelector("#tracking-quality"),
  rigCoverage: document.querySelector("#rig-coverage"),
  poseLatency: document.querySelector("#pose-latency"),
  detailStatus: document.querySelector("#detail-status"),
  detailTracking: document.querySelector("#detail-tracking"),
  detailHands: document.querySelector("#detail-hands"),
  detailEyes: document.querySelector("#detail-eyes"),
  detailMouth: document.querySelector("#detail-mouth"),
  detailRest: document.querySelector("#detail-rest"),
  kneeAsymmetry: document.querySelector("#knee-asymmetry"),
  kneeRange: document.querySelector("#knee-range"),
  baselineChange: document.querySelector("#baseline-change"),
  functionalWarning: document.querySelector("#functional-warning"),
  toggleCamera: document.querySelector("#toggle-camera"),
  uploadVideo: document.querySelector("#upload-video"),
  videoUploadFeedback: document.querySelector("#video-upload-feedback"),
  exerciseVideoFile: document.querySelector("#exercise-video-file"),
  replayVideo: document.querySelector("#replay-video"),
  centerPose: document.querySelector("#center-pose"),
  mirrorPreview: document.querySelector("#mirror-preview"),
  cameraFacingButtons: [...document.querySelectorAll(".camera-facing-button")],
  cameraDevice: document.querySelector("#camera-device"),
  refreshCameras: document.querySelector("#refresh-cameras"),
  cameraDeviceStatus: document.querySelector("#camera-device-status"),
  recordBaseline: document.querySelector("#record-baseline"),
  recordAssessment: document.querySelector("#record-assessment"),
  exportMovementEvidence: document.querySelector("#export-movement-evidence"),
  cameraMotion: document.querySelector("#camera-motion"),
  safetyAlert: document.querySelector("#safety-alert"),
  safetyAlertTitle: document.querySelector("#safety-alert-title"),
  safetyAlertMessage: document.querySelector("#safety-alert-message"),
  safetyMonitorStatus: document.querySelector("#safety-monitor-status"),
  postureStatus: document.querySelector("#posture-status"),
  postureTimer: document.querySelector("#posture-timer"),
  objectCount: document.querySelector("#object-count"),
  objectInference: document.querySelector("#object-inference"),
  approachStatus: document.querySelector("#approach-status"),
  voiceStatus: document.querySelector("#voice-status"),
  detectedObjects: document.querySelector("#detected-objects"),
  objectAwareness: document.querySelector("#object-awareness"),
  voiceAlerts: document.querySelector("#voice-alerts"),
  postureThreshold: document.querySelector("#posture-threshold"),
  testVoice: document.querySelector("#test-voice"),
  safetyEventLog: document.querySelector("#safety-event-log"),
  motionGuardMode: document.querySelector("#motionguard-mode"),
  motionGuardStatus: document.querySelector("#motionguard-status"),
  motionGuardFlexion: document.querySelector("#motionguard-flexion"),
  motionGuardDifference: document.querySelector("#motionguard-difference"),
  motionGuardFlexionLabel: document.querySelector("#motionguard-flexion-label"),
  motionGuardDifferenceLabel: document.querySelector("#motionguard-difference-label"),
  motionGuardTrunk: document.querySelector("#motionguard-trunk"),
  motionGuardSpeed: document.querySelector("#motionguard-speed"),
  motionGuardSpeedLabel: document.querySelector("#motionguard-speed-label"),
  motionGuardJointRows: [...document.querySelectorAll(".motionguard-joint-row[data-joint]")],
  motionGuardCountLabel: document.querySelector("#motionguard-count-label"),
  motionGuardCount: document.querySelector("#motionguard-count"),
  motionGuardTimingLabel: document.querySelector("#motionguard-timing-label"),
  motionGuardTiming: document.querySelector("#motionguard-timing"),
  motionGuardState: document.querySelector("#motionguard-state"),
  motionGuardRecommendation: document.querySelector("#motionguard-recommendation"),
  motionGuardDetail: document.querySelector("#motionguard-detail"),
  motionGuardReset: document.querySelector("#motionguard-reset"),
  motionGuardTwinState: document.querySelector("#motionguard-twin-state"),
  nasaEvidenceStatus: document.querySelector("#nasa-evidence-status"),
  nasaStudySummary: document.querySelector("#nasa-study-summary"),
  nasaDistalChange: document.querySelector("#nasa-distal-change"),
  nasaCorticalChange: document.querySelector("#nasa-cortical-change"),
  nasaVertebraChange: document.querySelector("#nasa-vertebra-change"),
  nasaEvidenceBoundary: document.querySelector("#nasa-evidence-boundary"),
  workflowTabs: [...document.querySelectorAll(".workflow-tab")],
  stagePanels: [...document.querySelectorAll("[data-stage-panel]")],
  stageKicker: document.querySelector("#stage-kicker"),
  stageTitle: document.querySelector("#stage-title"),
  stageDescription: document.querySelector("#stage-description"),
  workflowBack: document.querySelector("#workflow-back"),
  workflowNext: document.querySelector("#workflow-next"),
  workflowProgress: document.querySelector("#workflow-progress"),
  decisionSummary: document.querySelector("#decision-summary"),
  decisionGauge: document.querySelector("#decision-gauge"),
  decisionScore: document.querySelector("#decision-score"),
  decisionBand: document.querySelector("#decision-band"),
  decisionTitle: document.querySelector("#decision-title"),
  decisionRecommendation: document.querySelector("#decision-recommendation"),
  decisionCoverage: document.querySelector("#decision-coverage"),
  decisionUncertainty: document.querySelector("#decision-uncertainty"),
  decisionRationale: document.querySelector("#decision-rationale"),
  sourceImagingValue: document.querySelector("#source-imaging-value"),
  sourceImpactValue: document.querySelector("#source-impact-value"),
  sourceFragilityValue: document.querySelector("#source-fragility-value"),
  sourceImagingBar: document.querySelector("#source-imaging-bar"),
  sourceImpactBar: document.querySelector("#source-impact-bar"),
  sourceFragilityBar: document.querySelector("#source-fragility-bar"),
  carePriority: document.querySelector("#care-priority"),
  careSummary: document.querySelector("#care-summary"),
  careActions: document.querySelector("#care-actions"),
  logObservation: document.querySelector("#log-observation"),
  exportHandoff: document.querySelector("#export-handoff"),
  exportCompetitionBrief: document.querySelector("#export-competition-brief"),
  exportValidationReport: document.querySelector("#export-validation-report"),
  simulationEvidenceStatus: document.querySelector("#simulation-evidence-status"),
  simulationDcr: document.querySelector("#simulation-dcr"),
  simulationBand: document.querySelector("#simulation-band"),
  simulationStress: document.querySelector("#simulation-stress"),
  simulationVerification: document.querySelector("#simulation-verification"),
  simulationExceeded: document.querySelector("#simulation-exceeded"),
  simulationInterpretation: document.querySelector("#simulation-interpretation"),
  simulationSensitivity: document.querySelector("#simulation-sensitivity"),
  simulationProof: document.querySelector("#simulation-proof"),
  loadSimulationCase: document.querySelector("#load-simulation-case"),
  observationCount: document.querySelector("#observation-count"),
  protocolNote: document.querySelector("#protocol-note"),
  timelineSteps: [...document.querySelectorAll(".timeline-step")],
  motionButtons: [...document.querySelectorAll(".motion-button")],
};

const xrayApi = new XrayApiClient();
const voiceAssistant = new VoiceAssistant({
  enabled: refs.voiceAlerts.checked,
  onStatus: updateVoiceStatus,
});
const safetyMonitor = new CrewSafetyMonitor({
  postureHoldMs: Number(refs.postureThreshold.value),
  onUpdate: updateSafetyMonitorUi,
  onAlert: handleSafetyAlert,
});
const motionGuard = new MotionGuardAnalyzer({
  mode: refs.motionGuardMode.value,
  onUpdate: updateMotionGuardUi,
  onAlert: handleSafetyAlert,
});
const faceActivityObserver = new FaceActivityObserver();
const poseController = new PoseAssessmentController({
  video: refs.poseVideo,
  canvas: refs.poseOverlay,
  modelUrl: appAssetUrl("models/pose_landmarker_lite.task"),
  objectModelUrl: appAssetUrl("models/efficientdet_lite0_uint8.tflite"),
  handModelUrl: appAssetUrl("models/hand_landmarker.task"),
  faceModelUrl: appAssetUrl("models/face_landmarker.task"),
  wasmUrl: appAssetUrl("mediapipe"),
  onStatus: updateCameraStatus,
  onObjectStatus: updateObjectStatus,
  onDetailStatus: updateDetailStatus,
  onPose: updateLivePose,
  onDetails: updateDetailObservations,
  onObjects: updateLiveObjects,
  onAssessment: completeFunctionalAssessment,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111613);
scene.fog = new THREE.Fog(0x111613, 7, 15);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(4.8, 2.3, 6.8);

const renderer = new THREE.WebGLRenderer({
  canvas: refs.canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = window.innerWidth > 700;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, refs.canvas);
controls.target.set(0, -0.1, 0);
controls.enableDamping = true;
controls.minDistance = 3.6;
controls.maxDistance = 10;
controls.maxPolarAngle = Math.PI * 0.88;

scene.add(new THREE.HemisphereLight(0xdcefe8, 0x16211d, 2.4));

const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(4, 5, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x85ffd9, 1.4);
rimLight.position.set(-4, 1, -3);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 18),
  new THREE.MeshStandardMaterial({
    color: 0x26302b,
    roughness: 0.78,
    metalness: 0.08,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -4.4;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(18, 18, 0x4a5c53, 0x303c37);
grid.position.y = -4.38;
scene.add(grid);

const boneMaterial = new THREE.MeshStandardMaterial({
  color: 0xf3ead8,
  roughness: 0.52,
  metalness: 0.08,
});
const jointMaterial = new THREE.MeshStandardMaterial({
  color: 0xe5d5bd,
  roughness: 0.48,
});
const stressMaterial = new THREE.MeshStandardMaterial({
  color: 0xc58218,
  emissive: 0x8f3900,
  emissiveIntensity: 0.25,
  transparent: true,
  opacity: 0.72,
});
const envelopeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x7bd3c2,
  transparent: true,
  opacity: 0.12,
  roughness: 0.32,
  metalness: 0,
  transmission: 0.25,
  depthWrite: false,
});
const crackMaterial = new THREE.LineBasicMaterial({ color: 0xff564f, linewidth: 2 });

const leg = new THREE.Group();
leg.visible = false;
leg.rotation.y = -0.26;
leg.position.y = 1.28;
scene.add(leg);

const rig = buildLegRig();
leg.add(rig.root);

const externalSkeleton = {
  group: new THREE.Group(),
  model: null,
  mixer: null,
  action: null,
  clip: null,
  bones: {},
  fingers: { left: [], right: [] },
  neutralPose: {},
  boundsBones: [],
  loaded: false,
};
const HUMAN_MODEL_URL = appAssetUrl("models/anatomy/musculoskeletal-rigged.glb");
const liveRetargeter = new SkeletalRetargeter(externalSkeleton);
const liveRootOffset = new THREE.Vector3();
externalSkeleton.group.name = "Rigged human GLB display";
externalSkeleton.group.position.set(-0.1, 0.45, -0.1);
externalSkeleton.group.rotation.y = -0.32;
scene.add(externalSkeleton.group);
loadRiggedHuman();

const impactMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 24, 24),
  stressMaterial,
);
impactMarker.castShadow = true;
scene.add(impactMarker);

const stressRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.42, 0.015, 12, 80),
  stressMaterial,
);
stressRing.rotation.x = Math.PI / 2;
scene.add(stressRing);

const crackLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.12, 0.02, 0),
    new THREE.Vector3(-0.04, -0.12, 0.02),
    new THREE.Vector3(0.04, -0.02, -0.03),
    new THREE.Vector3(0.12, -0.18, 0.02),
  ]),
  crackMaterial,
);
scene.add(crackLine);

const projectile = new THREE.Group();
projectile.name = "Scenario impact object";
const projectileModels = {
  evaTool: createEvaToolProjectile(),
};
Object.entries(projectileModels).forEach(([objectType, model]) => {
  model.userData.objectType = objectType;
  projectile.add(model);
});
scene.add(projectile);

const arrow = new THREE.ArrowHelper(
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 0),
  1,
  0x5fe0c8,
  0.25,
  0.12,
);
scene.add(arrow);

const normalArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 0),
  0.7,
  0xf2b44b,
  0.16,
  0.08,
);
scene.add(normalArrow);

let latestModel = calculateRisk(state);
let latestDecision = calculateDecision({
  demandCapacityRatio: latestModel.demandCapacityRatio,
  mechanicsBand: latestModel.riskBand,
  fragility: latestModel.fragility,
});
let latestCarePlan = calculateCarePlan({
  decisionBand: latestDecision.band.key,
  aiLoaded: aiState.loaded,
  painScore: state.painScore,
  swelling: state.swelling,
  mobility: state.mobility,
  sensationChange: state.sensationChange,
});
let animationStart = performance.now();

function createEvaToolProjectile() {
  const group = new THREE.Group();
  group.name = "EVA hand tool";

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.065, 0.55, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd3d9dc,
      roughness: 0.34,
      metalness: 0.55,
    }),
  );
  handle.rotation.z = Math.PI / 2;
  handle.castShadow = true;
  group.add(handle);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.22, 0.13),
    new THREE.MeshStandardMaterial({
      color: 0x9aa6ad,
      roughness: 0.3,
      metalness: 0.68,
    }),
  );
  head.position.x = 0.31;
  head.castShadow = true;
  group.add(head);

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.068, 0.24, 16),
    new THREE.MeshStandardMaterial({
      color: 0x2d3935,
      roughness: 0.82,
    }),
  );
  grip.rotation.z = Math.PI / 2;
  grip.position.x = -0.12;
  group.add(grip);
  return group;
}

function buildLegRig() {
  const root = new THREE.Group();
  root.name = "Procedural leg rig";

  const skeletonRoot = new THREE.Bone();
  skeletonRoot.name = "hip";
  skeletonRoot.position.set(0, 0, 0);
  const kneeBone = new THREE.Bone();
  kneeBone.name = "knee";
  kneeBone.position.y = -2.16;
  const ankleBone = new THREE.Bone();
  ankleBone.name = "ankle";
  ankleBone.position.y = -2;
  const toeBone = new THREE.Bone();
  toeBone.name = "toe";
  toeBone.position.set(0.86, -0.15, 0.1);
  skeletonRoot.add(kneeBone);
  kneeBone.add(ankleBone);
  ankleBone.add(toeBone);
  root.add(skeletonRoot);

  const helper = new THREE.SkeletonHelper(skeletonRoot);
  helper.material.color.set(0x66dbc8);
  helper.material.opacity = 0.65;
  helper.material.transparent = true;
  root.add(helper);

  const pelvis = new THREE.Group();
  pelvis.name = "Pelvis support";
  pelvis.add(segmentMesh(1.35, 0.18, "pelvis-left", Math.PI / 2, 0, 0));
  pelvis.children[0].position.set(-0.22, 0.25, 0);
  const pelvisRight = segmentMesh(1.35, 0.18, "pelvis-right", Math.PI / 2, 0, 0);
  pelvisRight.position.set(0.22, 0.25, 0);
  pelvis.add(pelvisRight);
  root.add(pelvis);

  const hipJoint = jointMesh(0.24, "hip joint");
  hipJoint.position.set(0, 0, 0);
  root.add(hipJoint);

  const femurPivot = new THREE.Group();
  femurPivot.name = "Femur pivot";
  femurPivot.position.set(0, 0, 0);
  root.add(femurPivot);

  const femur = segmentMesh(2.16, 0.15, "femur", 0, 0, 0);
  femur.position.y = -1.08;
  femur.castShadow = true;
  femurPivot.add(femur);

  const kneePivot = new THREE.Group();
  kneePivot.name = "Knee pivot";
  kneePivot.position.y = -2.16;
  femurPivot.add(kneePivot);

  const kneeJoint = jointMesh(0.22, "knee joint");
  kneePivot.add(kneeJoint);

  const patella = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 32, 16).scale(1, 1.25, 0.5),
    jointMaterial,
  );
  patella.name = "patella";
  patella.position.set(0, -0.05, 0.25);
  patella.castShadow = true;
  kneePivot.add(patella);

  const shinPivot = new THREE.Group();
  shinPivot.name = "Shin pivot";
  kneePivot.add(shinPivot);

  const tibia = segmentMesh(1.98, 0.13, "tibia", 0, 0, 0);
  tibia.position.set(0.04, -0.99, 0);
  shinPivot.add(tibia);

  const fibula = segmentMesh(1.86, 0.055, "fibula", 0, 0, 0);
  fibula.position.set(0.24, -0.96, -0.03);
  shinPivot.add(fibula);

  const anklePivot = new THREE.Group();
  anklePivot.name = "Ankle pivot";
  anklePivot.position.y = -1.98;
  shinPivot.add(anklePivot);

  const ankleJoint = jointMesh(0.16, "ankle joint");
  anklePivot.add(ankleJoint);

  const footPivot = new THREE.Group();
  footPivot.name = "Foot pivot";
  footPivot.rotation.z = -0.2;
  anklePivot.add(footPivot);

  const foot = segmentMesh(1.02, 0.11, "foot", 0, 0, Math.PI / 2);
  foot.position.set(0.47, -0.12, 0.08);
  footPivot.add(foot);

  const toes = segmentMesh(0.42, 0.055, "toes", 0, 0, Math.PI / 2);
  toes.position.set(1.1, -0.16, 0.1);
  footPivot.add(toes);

  const envelope = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 3.75, 24, 48).scale(0.82, 1, 0.74),
    envelopeMaterial,
  );
  envelope.name = "transparent leg envelope";
  envelope.position.set(0.08, -2.03, 0.02);
  envelope.renderOrder = 3;
  root.add(envelope);

  return {
    root,
    skeletonRoot,
    kneeBone,
    ankleBone,
    femurPivot,
    shinPivot,
    anklePivot,
    femur,
    tibia,
    fibula,
    kneeJoint,
    ankleJoint,
    envelope,
  };
}

function segmentMesh(length, radius, name, rotX = 0, rotY = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 20, 36),
    boneMaterial.clone(),
  );
  mesh.name = name;
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function jointMesh(radius, name) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), jointMaterial);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

function loadRiggedHuman(url = HUMAN_MODEL_URL) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    url,
    (gltf) => {
      const model = gltf.scene;
      model.traverse(node => { if (node.userData.anatomicalRig) externalSkeleton.anatomical = node.userData; });
      model.name = externalSkeleton.anatomical ? "Rigged anatomical reference" : "Rigged technical human";
      externalSkeleton.boundsBones = [];
      model.traverse((child) => {
        if (child.isBone) externalSkeleton.boundsBones.push(child);
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material = Array.isArray(child.material)
              ? child.material.map((material) => material.clone())
              : child.material.clone();
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
              material.fog = false;
              if (material.isMeshStandardMaterial) { material.roughness = .62; material.metalness = .02; }
            }
          }
        }
      });

      if (!externalSkeleton.anatomical) applyTechnicalHuman(model);
      refs.canvas.dataset.surface = externalSkeleton.anatomical ? "anatomical-rig" : "technical-mesh";
      document.querySelector(".twin-source-badge").textContent = externalSkeleton.anatomical ? "Anatomical rig" : "Rigged mesh";
      fitModelToTwin(model, 4.35);
      externalSkeleton.group.add(model);
      externalSkeleton.model = model;
      const binding = bindHumanRig(model);
      externalSkeleton.bones = binding.bones;
      externalSkeleton.fingers = binding.fingers;
      externalSkeleton.loaded = Boolean(
        externalSkeleton.bones.root
          && externalSkeleton.bones.spine
          && externalSkeleton.bones.leftArm
          && externalSkeleton.bones.rightArm
          && externalSkeleton.bones.leftUpLeg
          && externalSkeleton.bones.leftLeg
          && externalSkeleton.bones.leftFoot,
      );

      if (gltf.animations.length > 0) {
        externalSkeleton.mixer = new THREE.AnimationMixer(model);
        externalSkeleton.clip = gltf.animations.find((clip) => clip.name === "Idle_Breathing") ?? gltf.animations[0];
        externalSkeleton.action = externalSkeleton.mixer.clipAction(externalSkeleton.clip);
        externalSkeleton.action.play();
      }
      captureRigPose(externalSkeleton, 0.25);

      leg.visible = false;
      refs.canvas.dataset.rigReady = String(externalSkeleton.loaded);
      updateMissionReview();
      updateScene();
      appendAssistantMessage(
        externalSkeleton.anatomical ? "Articulated anatomical reference loaded: 277 skeletal and 683 muscular structures. Camera landmarks drive estimated joint motion; individual muscle activation and internal loads are not measured." : "Rigged outer-body fallback loaded. The anatomical asset was unavailable.",
      );
    },
    undefined,
    (error) => {
      console.warn("Rigged human model failed to load.", error);
      if (url === HUMAN_MODEL_URL) { loadRiggedHuman(appAssetUrl("models/human_body_clothed.glb")); return; }
      refs.canvas.dataset.rigReady = "false";
      refs.poseLinkState.textContent = "Human model unavailable";
    },
  );
}

function fitModelToTwin(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 0.001);
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - 0.45, -center.z * scale);
}

function captureRigPose(rigState, normalizedPhase) {
  if (rigState.mixer && rigState.clip) {
    const duration = Math.max(rigState.clip.duration, 0.001);
    rigState.mixer.setTime(THREE.MathUtils.euclideanModulo(normalizedPhase, 1) * duration);
  }
  rigState.model?.updateMatrixWorld(true);
  rigState.neutralPose = {};

  Object.entries(rigState.bones).forEach(([key, bone]) => {
    if (!bone) return;
    rigState.neutralPose[key] = {
      quaternion: bone.quaternion.clone(),
      position: bone.position.clone(),
      scale: bone.scale.clone(),
    };
  });
  rigState.fingerNeutral = new Map();
  for (const chains of Object.values(rigState.fingers ?? {})) {
    for (const chain of chains) {
      for (const bone of chain) {
        if (bone) rigState.fingerNeutral.set(bone, {
          quaternion: bone.quaternion.clone(),
          position: bone.position.clone(),
          scale: bone.scale.clone(),
        });
      }
    }
  }
}

function updateFromInputs() {
  simulationEvidenceState.active = false;
  simulationEvidenceState.comparison = null;
  state.target = refs.targetRegion.value;
  state.mass = Number(refs.mass.value);
  state.speed = Number(refs.speed.value);
  state.angle = Number(refs.angle.value);
  state.contactArea = Number(refs.contactArea.value);
  state.boneIndex = Number(refs.boneIndex.value) / 100;
  state.microgravityDays = Number(refs.microgravityDays.value);
  state.painScore = Number(refs.painScore.value);
  state.swelling = refs.swelling.value;
  state.mobility = refs.mobility.value;
  state.sensationChange = refs.sensationChange.checked;
  latestModel = calculateRisk(state);
  updateUi();
  updateSimulationEvidenceUi();
  updateScene();
}

function syncInputs() {
  refs.targetRegion.value = state.target;
  refs.mass.value = state.mass;
  refs.speed.value = state.speed;
  refs.angle.value = state.angle;
  refs.contactArea.value = state.contactArea;
  refs.boneIndex.value = Math.round(state.boneIndex * 100);
  refs.microgravityDays.value = state.microgravityDays;
  refs.painScore.value = state.painScore;
  refs.swelling.value = state.swelling;
  refs.mobility.value = state.mobility;
  refs.sensationChange.checked = state.sensationChange;
  refs.motionButtons.forEach((button) => {
    const isActive = button.dataset.motion === state.motionMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  refs.assistantMode.textContent = "Research support";
  updateMissionCopy();
}

function updateUi() {
  latestDecision = calculateDecision({
    demandCapacityRatio: latestModel.demandCapacityRatio,
    mechanicsBand: latestModel.riskBand,
    fragility: latestModel.fragility,
    aiLoaded: aiState.loaded,
    fractureScore: aiState.fractureScore,
    fractureDetected: aiState.fractureDetected,
    physicsConfidence: latestModel.confidence,
  });

  refs.massOutput.textContent = `${state.mass} g`;
  refs.speedOutput.textContent = `${state.speed} m/s`;
  refs.angleOutput.textContent = `${state.angle} deg`;
  refs.areaOutput.textContent = `${state.contactArea} mm2`;
  refs.boneOutput.textContent = state.boneIndex.toFixed(2);
  refs.daysOutput.textContent = `${Math.round(state.microgravityDays)} d`;
  refs.painOutput.textContent = `${state.painScore} / 10`;
  refs.impactObjectLabel.textContent = OBJECT_META[state.objectType].hudLabel;
  refs.activeObjectName.textContent = OBJECT_META[state.objectType].label;

  latestCarePlan = calculateCarePlan({
    decisionBand: latestDecision.band.key,
    aiLoaded: aiState.loaded,
    painScore: state.painScore,
    swelling: state.swelling,
    mobility: state.mobility,
    sensationChange: state.sensationChange,
  });

  refs.riskScore.textContent = `${latestModel.demandCapacityRatio.toFixed(2)}x`;
  refs.riskStatus.textContent = aiState.loaded
    ? latestDecision.band.label
    : `${latestModel.riskBand.label} / incomplete`;
  refs.loadPath.textContent = `${Math.round(latestModel.normalComponent * 100)}% normal load path`;
  refs.energyMetric.textContent = `${latestModel.kineticEnergyJ.toFixed(1)} J`;
  refs.stressMetric.textContent = `${(latestModel.contactStressPa / 1e6).toFixed(1)} MPa`;
  refs.fragilityMetric.textContent = `${(latestModel.adjustedCapacity / 1e6).toFixed(1)} MPa`;
  refs.confidenceMetric.textContent = latestModel.confidence;
  refs.sceneDecisionScore.textContent = aiState.loaded
    ? latestDecision.concordance.shortLabel
    : "Incomplete";
  refs.sceneEvidenceCount.textContent = `${latestDecision.sourceCount} of 3`;

  const riskColor = getRiskColor(latestModel.displaySeverity);
  refs.riskScore.style.color = riskColor.css;
  refs.riskStatus.style.color = riskColor.css;
  updateAiUi();
  updateDecisionUi();
  updateCarePlanUi();
  updateMissionReview();
  updateScenarioComparison();
}

function currentScenarioSnapshot() {
  return { state: { ...state }, demandCapacityRatio: latestModel.demandCapacityRatio };
}

function currentMissionReview() {
  return buildMissionReview({
    skeletonLoaded: externalSkeleton.loaded,
    cameraReady: poseController.active && poseController.poseWorkerReady,
    nasaSummary: nasaEvidenceState.summary,
    simulation: simulationEvidenceState.evidence,
    imageLoaded: aiState.loaded,
    movement: functionalState.latestResult,
  });
}

function updateMissionReview() {
  const review = currentMissionReview();
  document.querySelector("#mission-artifact-count").textContent =
    `${review.availableArtifacts} / ${review.totalArtifacts} evidence artifacts available`;
  for (const selector of ["#mission-readiness-list", "#mission-review-checks"]) {
    const container = document.querySelector(selector);
    container.replaceChildren(...review.checks.map((check) => {
      const row = document.createElement("div");
      row.className = "mission-check";
      row.dataset.available = String(check.available);
      const title = document.createElement("strong");
      title.textContent = check.title;
      const status = document.createElement("span");
      status.className = "status-badge";
      status.textContent = check.available ? "Available" : "Missing";
      row.append(title, status);
      if (selector === "#mission-review-checks") {
        const scope = document.createElement("p");
        scope.textContent = check.scope;
        const next = document.createElement("small");
        next.textContent = check.next;
        row.append(scope, next);
      }
      return row;
    }));
  }
}

function updateScenarioComparison() {
  const comparison = compareMissionScenarios(scenarioReference, currentScenarioSnapshot());
  const output = document.querySelector("#scenario-comparison");
  output.hidden = !comparison;
  if (!comparison) return;
  document.querySelector("#reference-dcr").textContent = `${comparison.reference.toFixed(2)}x`;
  document.querySelector("#current-dcr").textContent = `${comparison.current.toFixed(2)}x`;
  document.querySelector("#comparison-delta").textContent = comparison.relativeChangePercent === null
    ? "No percentage comparison"
    : `${comparison.relativeChangePercent >= 0 ? "+" : ""}${comparison.relativeChangePercent.toFixed(1)}% modeled DCR`;
  document.querySelector("#comparison-inputs").textContent = comparison.changedInputs.length
    ? comparison.changedInputs.map((change) => `${change.label}: ${change.before} to ${change.after} ${change.unit}`.trim()).join("; ")
    : "No scenario inputs changed.";
  document.querySelector("#comparison-boundary").textContent = comparison.interpretation;
}

function updateMissionCopy() {
  refs.brandSubtitle.textContent =
    "Mission health observations. Evidence-linked crew review.";
  refs.missionQuestion.textContent =
    "Experimental impact workbench / separate from crew monitoring";
  refs.problemCopy.textContent =
    "In deep space, bone reserve may be reduced while evacuation, resupply, and real-time specialist support are limited.";
  refs.solutionCopy.textContent =
    "Explore assumed loads and analytical equations. These scenarios do not measure a crew member's bone capacity or determine clinical action.";
  refs.lifecycleTitle.textContent =
    "One onboard workflow from prevention to delayed medical handoff";
  refs.helpPrevent.textContent =
    "Screen planned EVA tasks and loose-object impacts before exposure.";
  refs.helpAssess.textContent =
    "Fuse imaging, movement, event mechanics, skeletal reserve, and crew condition.";
  refs.helpRespond.textContent =
    "Turn urgency into a checkable, protocol-linked crew action plan.";
  refs.helpMonitor.textContent =
    "Log change and package evidence for flight-surgeon review.";
  refs.guidedDemo.textContent = "Explore impact assumptions";
  refs.tabLabelEvidence.textContent = "Evidence";
  refs.tabLabelImpact.textContent = "Event";
  refs.tabLabelBone.textContent = "Crew";
  refs.tabLabelDecision.textContent = "Response";
  refs.supportPanelTitle.textContent = "Crew medical support";
  refs.conditionHeading.textContent = "Crew condition";
  refs.mobilityLabel.textContent = "Ability to use limb";
  refs.responseTimelineLabel.textContent = "Crew response";
}

function updateAiUi() {
  refs.aiPanel.classList.toggle("detected", aiState.loaded && aiState.fractureDetected);
  refs.aiPanel.classList.toggle("clear", aiState.loaded && !aiState.fractureDetected);
  refs.aiDecision.textContent = !aiState.loaded
    ? "Not loaded"
    : aiState.fractureDetected
      ? "Detected"
      : "Not detected";
  refs.aiScore.textContent = aiState.loaded
    ? `${(aiState.fractureScore * 100).toFixed(1)}/100`
    : "--";
  refs.aiMaskArea.textContent = aiState.loaded
    ? `${(aiState.maskAreaFraction * 100).toFixed(2)}%`
    : "--";
  refs.aiWarning.textContent = aiState.warning;
  refs.aiProvenance.textContent = aiState.provenance;

  if (aiState.overlaySrc) {
    refs.aiOverlay.src = aiState.overlaySrc;
    refs.aiOverlay.classList.remove("hidden");
    refs.aiEmptyState.classList.add("hidden");
  } else {
    refs.aiOverlay.removeAttribute("src");
    refs.aiOverlay.classList.add("hidden");
    refs.aiEmptyState.classList.remove("hidden");
    refs.aiEmptyText.textContent = aiState.loaded
      ? "Prediction loaded without a browser-accessible overlay."
      : "No X-ray evidence connected";
  }
}

async function initializeXrayService() {
  const serviceLabel = nativeRuntime.isNative ? "AI service" : "Local AI";
  refs.aiServiceStatus.dataset.state = "checking";
  refs.aiServiceStatus.textContent = `Checking ${serviceLabel.toLowerCase()}`;
  try {
    const health = await xrayApi.getHealth();
    const ready = health.status === "ready";
    refs.aiServiceStatus.dataset.state = ready ? "ready" : "missing";
    refs.aiServiceStatus.textContent = ready
      ? `${serviceLabel} ready / ${health.device}`
      : "Checkpoints not configured";
    refs.analyzeXray.disabled = !ready;
  } catch (error) {
    refs.aiServiceStatus.dataset.state = "offline";
    refs.aiServiceStatus.textContent = xrayApi.baseUrl
      ? `${serviceLabel} offline`
      : "AI service not configured";
    refs.analyzeXray.disabled = true;
    if (nativeRuntime.isNative) {
      refs.apiBaseStatus.textContent = error.message;
    }
  }
}

function initializeXrayAvailability() {
  if (!xrayApi.baseUrl) {
    refs.aiServiceStatus.dataset.state = "offline";
    refs.aiServiceStatus.textContent = nativeRuntime.isNative
      ? "AI service not configured"
      : "Local AI offline";
    refs.analyzeXray.disabled = true;
    return;
  }
  if (!nativeRuntime.isNative && xrayApi.baseUrl !== window.location.origin) {
    refs.aiServiceStatus.dataset.state = "offline";
    refs.aiServiceStatus.textContent = "Local AI optional";
    refs.analyzeXray.disabled = false;
    return;
  }
  initializeXrayService();
}

async function analyzeSelectedXray(file) {
  refs.analyzeXray.disabled = true;
  refs.analyzeXray.textContent = "Analyzing...";
  refs.aiServiceStatus.dataset.state = "working";
  refs.aiServiceStatus.textContent = "Running both models";
  try {
    const payload = validateImageEvidence(await xrayApi.analyze(file, state.target));
    applyAiPrediction(payload, payload.overlayDataUrl, payload.targetRegion);
    refs.aiServiceStatus.dataset.state = "ready";
    refs.aiServiceStatus.textContent = `AI service ready / ${payload.model.device}`;
    aiState.provenance = `${payload.model.classifier} | ${payload.inferenceMs} ms`;
    updateAiUi();
  } catch (error) {
    refs.aiServiceStatus.dataset.state = "error";
    refs.aiServiceStatus.textContent = "Analysis failed";
    appendAssistantMessage(`The X-ray analysis failed: ${error.message}`);
  } finally {
    refs.analyzeXray.disabled = false;
    refs.analyzeXray.textContent = "Analyze X-ray";
    refs.xrayFile.value = "";
  }
}

function updateVoiceStatus(status) {
  refs.voiceStatus.dataset.state = status.enabled
    ? status.available === false ? "error" : "ready"
    : "off";
  refs.voiceStatus.textContent = !status.enabled
    ? "Muted"
    : status.available === true
      ? `Ready / ${status.backend}`
      : status.available === false
        ? "Voice unavailable"
      : "Loading voice";
}

async function initializeVoiceAssistant(attempt = 0) {
  const status = await voiceAssistant.initialize();
  if (
    nativeRuntime.isNative
    && voiceAssistant.enabled
    && !status.available
    && attempt < 2
  ) {
    window.setTimeout(() => {
      void initializeVoiceAssistant(attempt + 1);
    }, 1_200);
  }
  return status;
}

function updateObjectStatus(status) {
  refs.objectInference.dataset.state = status.key;
  refs.objectInference.dataset.detail = status.error?.message ?? "";
  refs.objectInference.title = status.error?.message ?? "";
  refs.objectInference.textContent = status.label;
  if (status.key === "error") {
    refs.objectAwareness.checked = false;
    safetyMonitor.clearObjects();
  }
}

function updateDetailStatus(status) {
  refs.detailStatus.dataset.state = status.key;
  refs.detailStatus.textContent = status.label;
  refs.detailStatus.title = status.error?.message ?? "";
  if (status.key === "error") refs.detailTracking.checked = false;
}

function updateDetailObservations(details) {
  functionalState.currentDetails = details;
  if (functionalState.currentPose) {
    functionalState.currentPose.detailHands = details?.hands ?? [];
    functionalState.currentPose.detailFace = details?.face ?? null;
    functionalState.currentPose.detailTimestamp = details?.timestamp ?? null;
  }
  const observation = faceActivityObserver.update(details?.face, details?.timestamp);
  refs.detailHands.textContent = details ? `${details.hands.length} hand${details.hands.length === 1 ? "" : "s"}` : "Not visible";
  refs.detailEyes.textContent = observation.eyeState;
  refs.detailMouth.textContent = observation.mouthState;
  refs.detailRest.textContent = observation.prolongedClosure
    ? "Prolonged eye closure"
    : observation.closureSeconds >= 1 ? `${Math.floor(observation.closureSeconds)} s eyes closed` : "No cue";
  if (observation.newCue && poseController.sourceKind === "camera" && refs.voiceAlerts.checked) {
    void voiceAssistant.speak("Eyes have appeared closed for several seconds. Check alertness if this is unexpected.", {
      key: "prolonged-eye-closure", cooldownMs: 120_000,
    });
  }
}

function updateLiveObjects(payload) {
  if (!payload) {
    safetyMonitor.clearObjects();
    return;
  }
  safetyMonitor.updateObjects(
    payload.detections,
    {
      width: payload.frameWidth,
      height: payload.frameHeight,
    },
    payload.timestamp,
    {
      mirrored: refs.mirrorPreview.checked,
      inferenceMs: payload.inferenceMs,
    },
  );
}

function getSelectedMotionGuardJoint() {
  const joint = refs.motionGuardTraceJoint?.value;
  return Object.hasOwn(MOTION_GUARD_JOINTS, joint) ? joint : "knee";
}

function drawMotionGuardTrace() {
  const canvas = refs.motionGuardTraceCanvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(260, Math.round(rect.width || canvas.clientWidth || 600));
  const cssHeight = Math.max(68, Math.round(rect.height || canvas.clientHeight || 92));
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(cssWidth * pixelRatio);
  const targetHeight = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = "#061116";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const plot = {
    left: 8,
    right: cssWidth - 8,
    top: 8,
    bottom: cssHeight - 8,
  };
  context.lineWidth = 1;
  context.strokeStyle = "rgba(140, 183, 178, 0.15)";
  for (let index = 0; index <= 3; index += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * index) / 3;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
  }

  const samples = motionGuardTrace.samples;
  const selectedJoint = getSelectedMotionGuardJoint();
  const drawSide = (side, color) => {
    if (!samples.length) return;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.strokeStyle = color;
    context.beginPath();
    let hasPoint = false;
    samples.forEach((sample, index) => {
      const x = samples.length === 1
        ? plot.right
        : plot.left + ((plot.right - plot.left) * index) / (samples.length - 1);
      const rawValue = sample[side]?.[selectedJoint];
      if (!Number.isFinite(rawValue)) {
        hasPoint = false;
        return;
      }
      const value = Math.max(0, Math.min(180, rawValue));
      const y = plot.bottom - (value / 180) * (plot.bottom - plot.top);
      if (!hasPoint) context.moveTo(x, y);
      else context.lineTo(x, y);
      hasPoint = true;
    });
    context.stroke();
  };
  drawSide("left", "#f2a642");
  drawSide("right", "#4fd9ef");
}

function updateMotionGuardTwinTelemetry(snapshot) {
  const live = snapshot.status === "tracking";
  const selectedJoint = getSelectedMotionGuardJoint();
  const jointMeta = MOTION_GUARD_JOINTS[selectedJoint];
  if (!live && snapshot.sampleCount === 0 && motionGuardTrace.samples.length) {
    motionGuardTrace.samples = [];
    motionGuardTrace.lastTimestamp = null;
  }
  if (live
    && Number.isFinite(snapshot.timestamp)
    && snapshot.timestamp !== motionGuardTrace.lastTimestamp
    && snapshot.jointMotionDegrees) {
    motionGuardTrace.lastTimestamp = snapshot.timestamp;
    motionGuardTrace.samples.push({
      left: { ...snapshot.jointMotionDegrees.left },
      right: { ...snapshot.jointMotionDegrees.right },
    });
    if (motionGuardTrace.samples.length > motionGuardTrace.maxSamples) {
      motionGuardTrace.samples.shift();
    }
  }

  const left = live ? snapshot.jointMotionDegrees?.left?.[selectedJoint] : null;
  const right = live ? snapshot.jointMotionDegrees?.right?.[selectedJoint] : null;
  const difference = live ? snapshot.jointDifferenceDegrees?.[selectedJoint] : null;
  refs.twinLeftJointLabel.textContent = jointMeta.label;
  refs.twinRightJointLabel.textContent = jointMeta.label;
  refs.twinLeftKnee.textContent = Number.isFinite(left) ? `${left.toFixed(1)} deg` : "--";
  refs.twinRightKnee.textContent = Number.isFinite(right) ? `${right.toFixed(1)} deg` : "--";
  refs.twinLeftKneeBar.style.width = Number.isFinite(left)
    ? `${Math.min(100, left / 1.8)}%` : "0%";
  refs.twinRightKneeBar.style.width = Number.isFinite(right)
    ? `${Math.min(100, right / 1.8)}%` : "0%";
  refs.twinKneeDifference.textContent = Number.isFinite(difference)
    ? `L/R ${jointMeta.shortLabel.toLowerCase()} difference ${difference.toFixed(1)} deg`
    : "L/R difference --";
  refs.twinMotionState.textContent = live ? snapshot.stateLabel : "Waiting for full body";
  refs.motionGuardTraceCanvas.setAttribute(
    "aria-label",
    `Live left and right ${jointMeta.label.toLowerCase()} history`,
  );
  drawMotionGuardTrace();
}

function updateMotionGuardUi(snapshot) {
  const live = snapshot.status === "tracking";
  const selectedJoint = getSelectedMotionGuardJoint();
  const jointMeta = MOTION_GUARD_JOINTS[selectedJoint];
  const degrees = (value) => Number.isFinite(value) ? `${value.toFixed(1)} deg` : "--";
  const partialReach = live && snapshot.mode === "reach" && !snapshot.reachTrackingReady;
  refs.motionGuardStatus.dataset.state = live
    ? partialReach ? "waiting" : snapshot.reviewCue ? "review" : "tracking"
    : "waiting";
  refs.motionGuardStatus.textContent = live
    ? partialReach ? "Partial" : snapshot.reviewCue ? "Observation" : "Tracking"
    : "Waiting";
  const selectedLeft = snapshot.jointMotionDegrees?.left?.[selectedJoint];
  const selectedRight = snapshot.jointMotionDegrees?.right?.[selectedJoint];
  const selectedDifference = snapshot.jointDifferenceDegrees?.[selectedJoint];
  refs.motionGuardFlexionLabel.textContent = `${jointMeta.label} L / R`;
  refs.motionGuardDifferenceLabel.textContent = `${jointMeta.shortLabel} L/R difference`;
  refs.motionGuardSpeedLabel.textContent = `${jointMeta.shortLabel} angular speed`;
  refs.motionGuardFlexion.textContent = live
    ? `${degrees(selectedLeft)} / ${degrees(selectedRight)}`
    : "--";
  refs.motionGuardDifference.textContent = degrees(selectedDifference);
  refs.motionGuardTrunk.textContent = degrees(snapshot.trunkAxisDeviationDegrees);
  const selectedSpeed = snapshot.jointAngularSpeedDegreesPerSecond?.[selectedJoint];
  refs.motionGuardSpeed.textContent = Number.isFinite(selectedSpeed)
    ? `${selectedSpeed.toFixed(1)} deg/s` : "--";
  refs.motionGuardJointRows.forEach((row) => {
    const joint = row.dataset.joint;
    const left = snapshot.jointMotionDegrees?.left?.[joint];
    const right = snapshot.jointMotionDegrees?.right?.[joint];
    const difference = snapshot.jointDifferenceDegrees?.[joint];
    row.querySelector('[data-side="left"]').textContent = degrees(left);
    row.querySelector('[data-side="right"]').textContent = degrees(right);
    row.querySelector('[data-side="difference"]').textContent = degrees(difference);
    row.classList.toggle("is-selected", joint === selectedJoint);
    row.classList.toggle("is-unavailable", !Number.isFinite(left) && !Number.isFinite(right));
  });
  refs.motionGuardState.textContent = snapshot.stateLabel;
  refs.motionGuardRecommendation.textContent = snapshot.recommendation;
  refs.motionGuardTwinState.textContent = live
    ? `MotionGuard linked / ${snapshot.sampleCount} fresh samples${partialReach ? " / arms partial" : ""}`
    : "MotionGuard waiting for fresh pose";
  refs.motionGuardCountLabel.textContent = snapshot.mode === "squat" ? "Completed repetitions"
    : snapshot.mode === "gait" ? "Knee cycles L / R"
      : snapshot.mode === "reach" ? "Reach cycles L / R" : "Fresh samples";
  refs.motionGuardCount.textContent = snapshot.mode === "squat" ? String(snapshot.repetitions)
    : snapshot.mode === "gait" ? `${snapshot.kneeCycles.left} / ${snapshot.kneeCycles.right}`
      : snapshot.mode === "reach" ? `${snapshot.reachCycles.left} / ${snapshot.reachCycles.right}`
      : String(snapshot.sampleCount);
  refs.motionGuardTimingLabel.textContent = snapshot.mode === "gait" ? "Cycle timing variation"
    : snapshot.mode === "squat" ? "Flexed phase"
      : snapshot.mode === "reach" ? "Arm tracking" : "Protocol state";
  refs.motionGuardTiming.textContent = snapshot.mode === "gait"
    ? Number.isFinite(snapshot.cycleTimingVariationPercent) ? `${snapshot.cycleTimingVariationPercent.toFixed(1)}% CV` : "Collecting cycles"
    : snapshot.mode === "squat" ? snapshot.lastRepetition ? `${snapshot.lastRepetition.flexedPhaseSeconds} s` : "No complete repetition"
      : snapshot.mode === "reach" ? snapshot.reachTrackingReady ? "Both arms linked" : "Shoulders to wrists required"
      : live ? "Observing" : "Waiting";
  refs.motionGuardDetail.textContent = snapshot.mode === "gait"
    ? Number.isFinite(snapshot.cycleRatePerMinute)
      ? `${snapshot.cycleRatePerMinute} knee cycles/min. Not verified foot contacts or gait stability.`
      : snapshot.timingStatus
    : snapshot.mode === "squat" && snapshot.lastRepetition
      ? `Last rep: peak mean knee flexion ${snapshot.lastRepetition.peakKneeFlexionDegrees.toFixed(1)} deg; maximum L/R difference ${snapshot.lastRepetition.maximumKneeDifferenceDegrees.toFixed(1)} deg.`
      : snapshot.mode === "reach"
        ? `${snapshot.reachCycles.left + snapshot.reachCycles.right} controlled arm cycles recorded. Camera thresholds count motion only; they do not grade strength or technique.`
      : "Trunk deviation is relative to the pose coordinate axis, not a measured gravity vector.";
  updateMotionGuardTwinTelemetry(snapshot);
}

function updateSafetyMonitorUi(snapshot) {
  const approaching = snapshot.objects.approaching[0] ?? null;
  const monitorAlert = Boolean(snapshot.posture.alert || approaching);
  refs.safetyMonitorStatus.dataset.state = !poseController.active
    ? "off"
    : monitorAlert
      ? "alert"
      : "monitoring";
  refs.safetyMonitorStatus.textContent = !poseController.active
    ? "Monitor off"
    : monitorAlert
      ? "Review cue"
      : "Monitoring";

  refs.postureStatus.textContent = snapshot.posture.visible
    ? snapshot.posture.label
    : "Waiting for body";
  refs.postureTimer.textContent = snapshot.posture.visible
    ? `${snapshot.posture.heldSeconds} s held / ${Math.round(safetyMonitor.postureHoldMs / 1_000)} s reminder`
    : "Full body required";
  refs.objectCount.textContent = `${snapshot.objects.count} supported`;
  if (Number.isFinite(snapshot.objects.inferenceMs)) {
    refs.objectInference.dataset.state = "ready";
    refs.objectInference.textContent = `${Math.round(snapshot.objects.inferenceMs)} ms object pass`;
  }
  refs.approachStatus.textContent = approaching
    ? `${capitalize(approaching.label)} / ${approaching.direction}`
    : "No approach signal";

  refs.detectedObjects.replaceChildren();
  if (!snapshot.objects.items.length) {
    const empty = document.createElement("span");
    empty.textContent = refs.objectAwareness.checked
      ? "No supported objects in view"
      : "Object awareness paused";
    refs.detectedObjects.appendChild(empty);
  } else {
    snapshot.objects.items.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "detected-object";
      chip.dataset.motion = item.motion;
      chip.textContent = `${capitalize(item.label)} / ${item.direction} / ${item.motion}`;
      refs.detectedObjects.appendChild(chip);
    });
  }
}

function handleSafetyAlert(alert) {
  if (poseController.sourceKind === "video") return;
  safetyEventLog.unshift(alert);
  if (safetyEventLog.length > 4) safetyEventLog.length = 4;
  renderSafetyEventLog();

  refs.safetyAlert.dataset.severity = alert.severity;
  refs.safetyAlertTitle.textContent = alert.title;
  refs.safetyAlertMessage.textContent = alert.message;
  refs.safetyAlert.hidden = false;
  clearTimeout(safetyAlertTimer);
  safetyAlertTimer = window.setTimeout(() => {
    refs.safetyAlert.hidden = true;
  }, alert.type === "object" ? 9_000 : 7_000);

  void voiceAssistant.speak(alert.voice, {
    key: alert.key,
    cooldownMs: alert.cooldownMs,
    interrupt: alert.severity === "caution",
  });
}

function renderSafetyEventLog() {
  refs.safetyEventLog.replaceChildren();
  if (!safetyEventLog.length) {
    const empty = document.createElement("li");
    empty.textContent = "No safety cues in this session";
    refs.safetyEventLog.appendChild(empty);
    return;
  }
  safetyEventLog.forEach((event) => {
    const item = document.createElement("li");
    const time = new Date(event.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    item.textContent = `${time} / ${event.title}: ${event.message}`;
    refs.safetyEventLog.appendChild(item);
  });
}

function updateCameraFacingUi(facingMode) {
  selectedCameraFacing = facingMode === "environment" ? "environment" : "user";
  refs.cameraFacingButtons.forEach((button) => {
    const active = button.dataset.facing === selectedCameraFacing;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  refs.mirrorPreview.checked = selectedCameraFacing === "user";
  refs.poseViewport.dataset.mirrored = String(refs.mirrorPreview.checked);
  updateCameraSourceLabel();
}

function updateCameraSourceLabel() {
  if (poseController.sourceKind === "video") {
    refs.twinFeedLabel.textContent = "Local exercise video";
    return;
  }
  const selectedOption = refs.cameraDevice?.selectedOptions?.[0];
  refs.twinFeedLabel.textContent = selectedCameraDeviceId
    ? selectedOption?.textContent || "Selected webcam feed"
    : selectedCameraFacing === "environment"
      ? "Environment feed"
      : "Live crew feed";
}

function setCameraChoiceBusy(busy) {
  refs.cameraFacingButtons.forEach((button) => {
    button.disabled = busy;
  });
  refs.cameraDevice.disabled = busy;
  refs.refreshCameras.disabled = busy;
}

async function refreshCameraDevices({ preferActiveDevice = true } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    refs.cameraDeviceStatus.textContent = "Camera listing is unavailable; system default can still be requested";
    refs.refreshCameras.disabled = true;
    return [];
  }
  refs.refreshCameras.disabled = true;
  try {
    const cameras = normalizeVideoInputs(await navigator.mediaDevices.enumerateDevices());
    const activeDeviceId = preferActiveDevice ? poseController.getActiveCameraDeviceId() : "";
    refs.cameraDevice.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "System default camera";
    refs.cameraDevice.appendChild(defaultOption);
    cameras.forEach((cameraInput) => {
      const option = document.createElement("option");
      option.value = cameraInput.deviceId;
      option.textContent = cameraInput.label;
      refs.cameraDevice.appendChild(option);
    });
    const activeExists = activeDeviceId
      && cameras.some((cameraInput) => cameraInput.deviceId === activeDeviceId);
    const selectedExists = selectedCameraDeviceId
      && cameras.some((cameraInput) => cameraInput.deviceId === selectedCameraDeviceId);
    selectedCameraDeviceId = activeExists
      ? activeDeviceId
      : selectedExists
        ? selectedCameraDeviceId
        : "";
    refs.cameraDevice.value = selectedCameraDeviceId;
    refs.cameraDeviceStatus.textContent = cameras.length
      ? `${cameras.length} video input${cameras.length === 1 ? "" : "s"} available${poseController.active ? " / live source selected" : ""}`
      : "No camera input is currently reported by the browser";
    updateCameraSourceLabel();
    return cameras;
  } catch (error) {
    refs.cameraDeviceStatus.textContent = `Camera list unavailable: ${error.message}`;
    return [];
  } finally {
    refs.refreshCameras.disabled = false;
  }
}

function handleCameraDeviceChange() {
  void refreshCameraDevices();
}

async function switchCameraDevice(deviceId) {
  const nextDeviceId = typeof deviceId === "string" ? deviceId : "";
  if (nextDeviceId === selectedCameraDeviceId) return;
  selectedCameraDeviceId = nextDeviceId;
  updateCameraSourceLabel();
  if (!poseController.active) return;

  setCameraChoiceBusy(true);
  safetyMonitor.reset();
  motionGuard.reset();
  refs.safetyAlert.hidden = true;
  try {
    await poseController.switchVideoInput({
      facingMode: selectedCameraFacing,
      deviceId: selectedCameraDeviceId,
    });
    refs.toggleCamera.textContent = "Stop camera";
    await refreshCameraDevices();
    void voiceAssistant.speak(
      "Webcam source changed. MotionGuard resumes when the full body is visible.",
      {
        key: "camera:device",
        cooldownMs: 2_000,
        interrupt: true,
      },
    );
  } catch (error) {
    updateCameraStatus({ key: "error", label: "Webcam unavailable" });
    refs.functionalWarning.textContent = `${error.message} Refresh the webcam list or choose System default camera.`;
  } finally {
    setCameraChoiceBusy(false);
  }
}

async function switchCameraFacing(facingMode) {
  const next = facingMode === "environment" ? "environment" : "user";
  if (next === selectedCameraFacing && !selectedCameraDeviceId) return;
  setCameraChoiceBusy(true);
  safetyMonitor.reset();
  motionGuard.reset();
  refs.safetyAlert.hidden = true;
  selectedCameraDeviceId = "";
  refs.cameraDevice.value = "";
  updateCameraFacingUi(next);
  try {
    await poseController.switchVideoInput({ facingMode: next, deviceId: "" });
    if (poseController.active) {
      refs.toggleCamera.textContent = "Stop camera";
      await refreshCameraDevices();
      void voiceAssistant.speak(
        next === "environment"
          ? "Environment camera active. Object direction cues are enabled within the visible field."
          : "Crew camera active. Full body posture tracking resumes when the crew member is visible.",
        {
          key: `camera:${next}`,
          cooldownMs: 2_000,
          interrupt: true,
        },
      );
    }
  } catch (error) {
    updateCameraStatus({ key: "error", label: "Camera switch failed" });
    refs.functionalWarning.textContent = error.message;
  } finally {
    setCameraChoiceBusy(false);
  }
}

function updateCameraStatus(status) {
  refs.cameraStatus.dataset.state = status.key;
  refs.cameraStatus.textContent = status.label;
  refs.poseEmpty.classList.toggle("hidden", poseController.active);
  refs.toggleCamera.textContent = poseController.starting
    ? "Cancel startup"
    : poseController.sourceKind === "video" ? "Close video"
      : poseController.active ? "Stop camera" : "Start camera";
  // A newly selected video can replace even a pending camera/model startup.
  refs.uploadVideo.disabled = false;
  refs.replayVideo.hidden = poseController.sourceKind !== "video";
  refs.replayVideo.disabled = poseController.starting || status.key === "recording";
  const recording = status.key === "recording";
  refs.motionGuardMode.disabled = recording;
  refs.motionGuardReset.disabled = recording;
  refs.assessmentProgress.hidden = !recording && status.key !== "preparing-video";
  refs.assessmentProgress.querySelector("span").style.width = `${(status.progress ?? 0) * 100}%`;
  refs.recordBaseline.disabled = !poseController.active || !poseController.poseWorkerReady || recording || poseController.sourceKind === "video";
  refs.recordAssessment.disabled = !poseController.active || !poseController.poseWorkerReady || recording || poseController.sourceKind === "video";
  refs.centerPose.disabled = !hasLiveSegments(functionalState.currentPose, performance.now()) || recording;
  if (poseController.active && state.motionMode !== "camera") {
    state.motionMode = "camera";
    syncInputs();
  }
  if (document.querySelector("#mission-review-dialog").open) updateMissionReview();
}

function updateLivePose(frame) {
  if (frame && functionalState.currentDetails
    && Math.abs(frame.timestamp - functionalState.currentDetails.timestamp) < 900) {
    frame.detailHands = functionalState.currentDetails.hands;
    frame.detailFace = functionalState.currentDetails.face;
    frame.detailTimestamp = functionalState.currentDetails.timestamp;
  }
  functionalState.currentPose = frame;
  if (!frame) motionGuard.reset({ emit: false });
  const movementTime = poseController.sourceKind === "video" && Number.isFinite(frame?.mediaTime) ? frame.mediaTime * 1000 : frame?.timestamp ?? performance.now();
  const motionSnapshot = motionGuard.update(frame, movementTime);
  if (frame) frame.motionGuard = motionSnapshot;
  if (poseController.sourceKind !== "video") safetyMonitor.updatePose(frame, frame?.timestamp ?? performance.now());
  refs.poseEmpty.classList.toggle("hidden", poseController.active);
  const rigLinked = Boolean(hasLiveSegments(frame, performance.now()) && externalSkeleton.loaded);
  refs.cameraMotion.disabled = !poseController.active || !externalSkeleton.loaded;
  refs.centerPose.disabled = !rigLinked;
  refs.trackingQuality.textContent = frame
    ? `${Math.round(frame.visibility * 100)}%`
    : "--";
  refs.rigCoverage.textContent = frame
    ? `${frame.trackedSegmentCount}/${frame.totalSegmentCount}`
    : "--";
  refs.poseLatency.textContent = frame?.cached ? "Cached / 12 Hz source" : Number.isFinite(frame?.pipelineLatencyMs ?? frame?.inferenceMs)
    ? `${Math.round(frame.pipelineLatencyMs ?? frame.inferenceMs)} ms`
    : "--";
  refs.poseLiveFps.textContent = Number.isFinite(frame?.frameRate)
    ? `${Math.round(frame.frameRate)} fps`
    : "-- fps";

  if (rigLinked) {
    refs.poseLinkState.dataset.state = "linked";
    refs.poseLinkState.textContent = `${frame.usable ? "Live pose" : "Partial body"} - ${frame.trackedSegmentCount}/${frame.totalSegmentCount} segments`;
  } else if (frame) {
    refs.poseLinkState.dataset.state = "partial";
    refs.poseLinkState.textContent = "Tracking lost - holding last pose";
  } else {
    refs.poseLinkState.dataset.state = "waiting";
    refs.poseLinkState.textContent = poseController.active
      ? "Searching for body - pose held"
      : "Camera off";
  }

  if (rigLinked && !functionalState.calibration) {
    centerCameraPose({ announce: false });
  }
  if (rigLinked && state.motionMode !== "camera") {
    state.motionMode = "camera";
    syncInputs();
  }
}

function centerCameraPose({ announce = true } = {}) {
  const frame = functionalState.currentPose;
  if (!hasLiveSegments(frame, performance.now()) || !frame.imageCenter || !Number.isFinite(frame.bodyScale)) return;
  functionalState.calibration = {
    imageCenter: { ...frame.imageCenter },
    bodyScale: Math.max(frame.bodyScale, 0.001),
    hipsVisible: frame.points.hipCenter.visibility >= 0.56,
  };
  camera.updateMatrixWorld();
  liveRetargeter.viewRotation.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
  liveRootOffset.set(0, 0, 0);
  refs.centerPose.textContent = "Recenter pose";
  if (announce) {
    appendAssistantMessage(
      "Live pose centered. Body translation is now measured from this position while all visible limb segments continue to drive the skeleton directly.",
    );
  }
}

function completeFunctionalAssessment(result) {
  if (result.asBaseline && result.status === "complete") {
    functionalState.baseline = result;
  } else if (!result.asBaseline) {
    functionalState.result = result;
  }

  if (result.status !== "complete") {
    refs.functionalWarning.textContent = result.reason;
    appendAssistantMessage(
      result.sourceKind === "video"
        ? `The local video assessment was incomplete: ${result.reason}`
        : "The movement assessment did not collect enough visible full-body samples. Keep both legs in frame and repeat the movement.",
    );
    return;
  }

  functionalState.latestResult = result;
  window.dispatchEvent(new Event("astrobone-assessment-ready"));
  updateMissionReview();
  refs.exportMovementEvidence.disabled = false;

  const kneeDelta = result.baselineDelta?.knee;
  const usableFrameRate = result.captureQuality?.usableFrameRate;
  const medianInferenceMs = result.captureQuality?.medianInferenceMs;
  refs.trackingQuality.textContent = `${Math.round(result.trackingQuality * 100)}%`;
  refs.kneeAsymmetry.textContent = `${result.asymmetry.knee.toFixed(1)} deg`;
  refs.kneeRange.textContent = `${result.rangeOfMotion.left.knee.toFixed(1)} / ${result.rangeOfMotion.right.knee.toFixed(1)} deg`;
  refs.baselineChange.textContent = Number.isFinite(kneeDelta)
    ? `${kneeDelta >= 0 ? "+" : ""}${kneeDelta.toFixed(1)} deg`
    : result.asBaseline
      ? "Baseline saved"
      : "No baseline";
  refs.functionalWarning.textContent = Number.isFinite(usableFrameRate)
    ? `Evidence ready: ${Math.round(usableFrameRate * 100)}% usable frames${Number.isFinite(medianInferenceMs) ? ` and ${Math.round(medianInferenceMs)} ms median inference` : ""}. Functional evidence only.`
    : result.interpretation;
  appendAssistantMessage(
    result.asBaseline
      ? "A local movement baseline was recorded. It stays in this browser session and can be exported as aggregate evidence without video or raw landmarks."
      : `${result.sourceKind === "video" ? "Local video" : "Live camera"} assessment recorded with <strong>${Math.round(result.trackingQuality * 100)}% tracking quality</strong>, <strong>${Number.isFinite(usableFrameRate) ? Math.round(usableFrameRate * 100) : 0}% usable frames</strong>, and <strong>${result.asymmetry.knee.toFixed(1)} degrees</strong> of knee range asymmetry. This informs follow-up, not the X-ray or mechanics score.`,
  );
}

function restoreCameraMirror() {
  if (mirrorBeforeVideo === null) return;
  refs.mirrorPreview.checked = mirrorBeforeVideo;
  refs.poseViewport.dataset.mirrored = String(mirrorBeforeVideo);
  mirrorBeforeVideo = null;
}

function clearCurrentMovementAssessment() {
  functionalState.latestResult = null;
  functionalState.result = null;
  refs.exportMovementEvidence.disabled = true;
  refs.kneeAsymmetry.textContent = "--";
  refs.kneeRange.textContent = "--";
  refs.baselineChange.textContent = "--";
  refs.functionalWarning.textContent = "New capture pending. The previous assessment is no longer exportable.";
  window.dispatchEvent(new Event("astrobone-assessment-ready"));
}

async function analyzeExerciseVideo(file) {
  refs.videoUploadFeedback.hidden = true;
  try {
    validateExerciseVideo(file);
  } catch (error) {
    showVideoUploadError(error);
    return;
  }
  safetyMonitor.reset();
  motionGuard.reset();
  voiceAssistant.stop();
  refs.safetyAlert.hidden = true;
  functionalState.calibration = null;
  clearCurrentMovementAssessment();
  if (mirrorBeforeVideo === null) mirrorBeforeVideo = refs.mirrorPreview.checked;
  refs.mirrorPreview.checked = false;
  refs.poseViewport.dataset.mirrored = "false";
  try {
    const started = await poseController.startVideo(file, { precompute: document.querySelector("#video-precompute").checked });
    if (!started) return;
    updateCameraSourceLabel();
    refs.functionalWarning.textContent = poseController.videoWindow?.assessmentEligible === false
      ? "Short clip: motion preview only. An assessment needs at least 7 seconds of footage."
      : "Local MP4/WebM analysis is running. The rig follows pose estimates; this is not recovered body mesh or clinical measurement.";
  } catch (error) {
    restoreCameraMirror();
    updateCameraStatus({ key: "error", label: "Video unavailable" });
    showVideoUploadError(error);
  }
}

function showVideoUploadError(error) {
  refs.videoUploadFeedback.textContent = error.message;
  refs.videoUploadFeedback.hidden = false;
  refs.functionalWarning.textContent = error.message;
}

async function toggleCamera() {
  if (poseController.active || poseController.starting) {
    poseController.stopCamera();
    restoreCameraMirror();
    updateCameraSourceLabel();
    safetyMonitor.reset();
    motionGuard.reset();
    voiceAssistant.stop();
    state.motionMode = "stand";
    functionalState.calibration = null;
    refs.safetyAlert.hidden = true;
    refs.toggleCamera.textContent = "Start camera";
    refs.centerPose.textContent = "Center pose";
    refs.centerPose.disabled = true;
    refs.recordBaseline.disabled = true;
    refs.recordAssessment.disabled = true;
    refs.cameraMotion.disabled = true;
    refs.rigCoverage.textContent = "--";
    refs.poseLatency.textContent = "--";
    refs.poseLiveFps.textContent = "-- fps";
    syncInputs();
    return;
  }

  restoreCameraMirror();
  functionalState.calibration = null;
  try {
    poseController.setObjectDetectionEnabled(refs.objectAwareness.checked);
    const started = await poseController.startCamera({
      facingMode: selectedCameraFacing,
      deviceId: selectedCameraDeviceId,
    });
    if (!started) return;
    refs.toggleCamera.textContent = "Stop camera";
    refs.recordBaseline.disabled = false;
    refs.recordAssessment.disabled = false;
    await refreshCameraDevices();
    void voiceAssistant.speak(
      "MotionGuard active. Movement observations and camera cues remain advisory.",
      {
        key: "monitor-start",
        cooldownMs: 3_000,
        interrupt: true,
      },
    );
  } catch (error) {
    updateCameraStatus({ key: "error", label: "Camera unavailable" });
    refs.functionalWarning.textContent = error.message;
    appendAssistantMessage(`Camera assessment could not start: ${error.message}`);
  } finally {
    refs.toggleCamera.disabled = false;
  }
}

function updateDecisionUi() {
  const { band } = latestDecision;
  const gaugeColor = band.key === "high"
    ? "#b7372f"
    : band.key === "watch"
      ? "#bd7b13"
      : "#2f8f46";

  refs.decisionSummary.dataset.band = aiState.loaded ? band.key : "incomplete";
  refs.decisionGauge.style.setProperty(
    "--score-angle",
    `${latestDecision.completeness * 360}deg`,
  );
  refs.decisionGauge.style.setProperty("--gauge-color", aiState.loaded ? gaugeColor : "#9eaaa4");
  refs.decisionScore.textContent = `${latestDecision.sourceCount}/3`;
  refs.decisionBand.textContent = latestDecision.concordance.label;
  refs.decisionTitle.textContent = aiState.loaded
    ? band.title
    : "Connect all three evidence sources";
  refs.decisionRecommendation.textContent = latestDecision.recommendation;
  refs.decisionCoverage.textContent = `${latestDecision.sourceCount} of 3 sources`;
  refs.decisionUncertainty.textContent = latestDecision.uncertainty;
  refs.decisionRationale.textContent = latestDecision.rationale;

  refs.sourceImagingValue.textContent = latestDecision.imagingScore === null
    ? "Missing"
    : `${latestDecision.imagingScore.toFixed(1)}/100 model score`;
  refs.sourceImpactValue.textContent = `${latestDecision.mechanicalIndex.toFixed(2)}x DCR`;
  refs.sourceFragilityValue.textContent = `${latestDecision.capacityReductionPercent.toFixed(0)}% modeled reduction`;
  refs.sourceImagingBar.style.width = `${latestDecision.imagingScore ?? 0}%`;
  refs.sourceImpactBar.style.width = `${latestDecision.mechanicalDisplayPercent}%`;
  refs.sourceFragilityBar.style.width = `${latestDecision.capacityReductionPercent}%`;
}

function updateCarePlanUi() {
  refs.carePriority.textContent = latestCarePlan.priority.label;
  refs.carePriority.dataset.priority = latestCarePlan.priority.key;
  refs.careSummary.textContent = latestCarePlan.summary;
  refs.protocolNote.textContent = latestCarePlan.protocolNote;
  refs.careActions.replaceChildren();

  latestCarePlan.actions.forEach((action, index) => {
    const label = document.createElement("label");
    label.className = "care-action";
    label.classList.toggle("completed", completedCareActions.has(action.id));

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = completedCareActions.has(action.id);
    checkbox.setAttribute("aria-label", `Complete action: ${action.label}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        completedCareActions.add(action.id);
      } else {
        completedCareActions.delete(action.id);
      }
      label.classList.toggle("completed", checkbox.checked);
    });

    const number = document.createElement("span");
    number.className = "care-action-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const content = document.createElement("span");
    content.className = "care-action-content";
    const phase = document.createElement("small");
    phase.textContent = action.phase;
    const title = document.createElement("strong");
    title.textContent = action.label;
    const detail = document.createElement("span");
    detail.textContent = action.detail;
    content.append(phase, title, detail);

    label.append(checkbox, number, content);
    refs.careActions.appendChild(label);
  });

  updateObservationCount();
}

function updateObservationCount() {
  const count = incidentLog.length;
  refs.observationCount.textContent = `${count} observation${count === 1 ? "" : "s"}`;
}

function updateScene(
  displaySeverity = latestModel.displaySeverity,
  displayDcr = latestModel.demandCapacityRatio,
) {
  setActiveProjectile(state.objectType);
  const flex = 0.08;
  rig.femurPivot.rotation.x = THREE.MathUtils.degToRad(3);
  rig.shinPivot.rotation.x = flex + displaySeverity * 0.0018;
  rig.anklePivot.rotation.x = -0.12 - displaySeverity * 0.0009;
  rig.kneeBone.rotation.x = rig.shinPivot.rotation.x;
  rig.ankleBone.rotation.x = rig.anklePivot.rotation.x;
  rig.envelope.material.opacity = 0.11;

  const riskColor = getRiskColor(displaySeverity);
  [rig.femur, rig.tibia, rig.fibula].forEach((mesh) => {
    mesh.material.color.set(0xf3ead8);
    mesh.material.emissive = new THREE.Color(0x000000);
    mesh.material.emissiveIntensity = 0;
  });
  const targetMesh = state.target === "femur" ? rig.femur : rig.tibia;
  targetMesh.material.color.set(riskColor.hex);
  targetMesh.material.emissive = new THREE.Color(riskColor.hex);
  targetMesh.material.emissiveIntensity = displaySeverity / 220;

  const impactPoint = getImpactPoint();
  const direction = getImpactDirection();
  stressMaterial.color.set(riskColor.hex);
  stressMaterial.emissive.set(riskColor.hex);
  stressMaterial.opacity = 0.12 + displaySeverity / 140;

  updateImpactVisuals({
    impactPoint,
    direction,
    viewCamera: camera,
    marker: impactMarker,
    ring: stressRing,
    fracture: crackLine,
    loadArrow: arrow,
    surfaceNormalArrow: normalArrow,
    projectileGroup: projectile,
    displaySeverity,
    displayDcr,
  });
  const simulated = state.motionMode !== "camera" && !document.body.classList.contains("health-active");
  [impactMarker, stressRing, arrow, normalArrow, projectile].forEach((object) => {
    object.visible = simulated;
  });
  crackLine.visible = simulated && displayDcr >= 0.5;
}

function updateImpactVisuals({
  impactPoint,
  direction,
  viewCamera,
  marker,
  ring,
  fracture,
  loadArrow,
  surfaceNormalArrow,
  projectileGroup,
  displaySeverity,
  displayDcr,
}) {
  marker.position.copy(impactPoint);
  ring.position.copy(impactPoint);
  ring.lookAt(viewCamera.position);
  ring.scale.setScalar(0.42 + displaySeverity / 180);

  fracture.position.copy(impactPoint);
  fracture.lookAt(viewCamera.position);
  fracture.scale.setScalar(0.4 + displaySeverity / 70);
  fracture.visible = displayDcr >= 0.5;

  const start = impactPoint.clone().sub(direction.clone().multiplyScalar(3.1));
  loadArrow.position.copy(start);
  loadArrow.setDirection(direction);
  loadArrow.setLength(3.1, 0.28, 0.12);
  loadArrow.setColor(0x5fe0c8);

  surfaceNormalArrow.position.copy(impactPoint);
  surfaceNormalArrow.setDirection(new THREE.Vector3(1, 0.08, 0.04).normalize());
  surfaceNormalArrow.setLength(
    0.55 + latestModel.normalComponent * 0.65,
    0.16,
    0.08,
  );

  orientProjectile(projectileGroup, direction, viewCamera);
}

function setActiveProjectile(objectType) {
  projectile.children.forEach((model) => {
    model.visible = model.userData.objectType === objectType;
  });
}

function orientProjectile(projectileGroup, direction) {
  projectileGroup.quaternion.setFromUnitVectors(
    new THREE.Vector3(1, 0, 0),
    direction.clone().normalize(),
  );
  projectileGroup.rotateX(0.16);
}

function getProjectileScale() {
  return 0.92 + latestModel.displaySeverity / 340;
}

function getImpactPoint() {
  const externalPoint = getExternalSkeletonImpactPoint();
  if (externalPoint) return externalPoint;

  const points = {
    femur: new THREE.Vector3(0.02, -0.96, 0.25),
    tibia: new THREE.Vector3(0.08, -0.92, 0.25),
    knee: new THREE.Vector3(0.02, -0.05, 0.28),
    ankle: new THREE.Vector3(0.04, 0.02, 0.24),
  };
  const carriers = {
    femur: rig.femurPivot,
    tibia: rig.shinPivot,
    knee: rig.shinPivot,
    ankle: rig.anklePivot,
  };
  return carriers[state.target].localToWorld(points[state.target].clone());
}

function getExternalSkeletonImpactPoint() {
  if (!externalSkeleton.loaded) return null;

  const { leftUpLeg, leftLeg, leftFoot } = externalSkeleton.bones;
  if (!leftUpLeg || !leftLeg || !leftFoot) return null;

  const hip = getWorldPoint(leftUpLeg);
  const knee = getWorldPoint(leftLeg);
  const ankle = getWorldPoint(leftFoot);
  const point = new THREE.Vector3();

  if (state.target === "femur") {
    point.lerpVectors(hip, knee, 0.54);
  } else if (state.target === "knee") {
    point.copy(knee);
  } else if (state.target === "ankle") {
    point.copy(ankle);
  } else {
    point.lerpVectors(knee, ankle, 0.48);
  }

  const lateralOffset = new THREE.Vector3(0.11, 0.02, 0.08);
  return point.add(lateralOffset);
}

function getWorldPoint(object) {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

function getImpactDirection() {
  const angle = THREE.MathUtils.degToRad(state.angle);
  return new THREE.Vector3(Math.sin(angle), -0.13, Math.cos(angle) * 0.56).normalize();
}

function updateLinkedMotion(elapsed) {
  const cameraLinked = state.motionMode === "camera";
  controls.enableRotate = !cameraLinked;
  controls.enablePan = !cameraLinked;
  controls.enableDamping = !cameraLinked;
  controls.maxDistance = cameraLinked ? 30 : 10;
  refs.canvas.dataset.mirrored = String(cameraLinked && refs.mirrorPreview.checked);
  refs.canvas.style.transform = cameraLinked && refs.mirrorPreview.checked ? "scaleX(-1)" : "";
  if (cameraLinked) {
    if (!externalSkeleton.loaded) return;
    if (!liveRetargeter.active) {
      controls.update();
      externalSkeleton.group.position.set(-0.1, 0.45, -0.1);
      externalSkeleton.group.rotation.set(0, 0, 0);
      // Use one fixed camera-facing basis for both feeds; orbiting behind a live
      // avatar reverses apparent left/right even when the anatomical binding is correct.
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 7.6);
      controls.update();
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      liveRetargeter.begin(camera.getWorldQuaternion(new THREE.Quaternion()));
      liveRootOffset.set(0, 0, 0);
    }
    const observedFrame = functionalState.currentPose;
    const now = performance.now();
    const pausedPose = poseController.active && !poseController.starting
      && poseController.sourceKind === "video" && isPausedVideoPose(observedFrame, refs.poseVideo);
    // Refresh the display copy only. A held video pose is not a new observation.
    const frame = pausedPose ? { ...observedFrame, timestamp: now } : observedFrame;
    if (hasLiveSegments(frame, now)) {
      if (!functionalState.calibration?.hipsVisible && frame.points.hipCenter.visibility >= 0.56) {
        centerCameraPose({ announce: false });
      }
      const motion = getCameraRootMotion(frame);
      if (motion) liveRootOffset.lerp(motion, 0.35);
    }
    externalSkeleton.group.position.set(-0.1, 0.45, -0.1).add(liveRootOffset);
    const tracking = liveRetargeter.update(frame, now);
    fitTrackedRigInView(camera, controls.target, externalSkeleton.boundsBones);
    refs.canvas.dataset.tracking = pausedPose && tracking.state !== "lost" ? "paused" : tracking.state;
    refs.canvas.dataset.trackedBones = String(tracking.trackedBones);
    refs.canvas.dataset.bodyHeadingYaw = Number.isFinite(tracking.bodyHeadingRadians)
      ? THREE.MathUtils.radToDeg(tracking.bodyHeadingRadians).toFixed(1) : "";
    for (const side of ["left", "right"]) {
      const angle = tracking.kneeFlexion?.[side];
      refs.canvas.dataset[`${side}KneeFlexion`] = Number.isFinite(angle) ? angle.toFixed(1) : "";
    }
    if (tracking.state === "lost") {
      refs.poseLinkState.dataset.state = "waiting";
      refs.poseLinkState.textContent = "Tracking lost - holding last pose";
    } else if (pausedPose) {
      refs.poseLinkState.dataset.state = "paused";
      refs.poseLinkState.textContent = "Paused video - matched pose";
    }
    return;
  }
  if (liveRetargeter.active && externalSkeleton.anatomical) {
    for (const [key, pose] of Object.entries(externalSkeleton.neutralPose)) {
      const bone = externalSkeleton.bones[key];
      if (bone) { bone.quaternion.copy(pose.quaternion); bone.position.copy(pose.position); }
    }
  }
  liveRetargeter.end();
  refs.canvas.dataset.tracking = "animation";
  refs.canvas.dataset.trackedBones = "0";
  refs.canvas.dataset.bodyHeadingYaw = "";
  refs.canvas.dataset.leftKneeFlexion = "";
  refs.canvas.dataset.rightKneeFlexion = "";
  let skeletonPhase = 0.25;
  let lateralOffset = 0;
  let verticalOffset = 0;
  let depthOffset = 0;
  let roll = 0;
  let pitch = 0;

  if (state.motionMode === "walk") {
    const cycle = (elapsed * 0.58) % 1;
    skeletonPhase = cycle;
    verticalOffset = Math.abs(Math.sin(cycle * Math.PI * 2)) * 0.012;
  } else if (state.motionMode === "space") {
    const wave = elapsed * 0.55;
    skeletonPhase = 0.23 + Math.sin(wave) * 0.06;
    lateralOffset = Math.sin(wave * 0.72) * 0.08;
    verticalOffset = 0.22 + Math.sin(wave) * 0.11;
    depthOffset = Math.cos(wave * 0.64) * 0.02;
    roll = Math.sin(wave * 0.7) * 0.05;
    pitch = -0.06 + Math.cos(wave * 0.58) * 0.022;
  }

  externalSkeleton.group.position.set(
    -0.1 + lateralOffset,
    0.45 + verticalOffset,
    -0.1 + depthOffset,
  );
  externalSkeleton.group.rotation.set(pitch, -0.32, roll);
  setRigAnimationPhase(externalSkeleton, skeletonPhase);
  lockRigRootTransform(externalSkeleton);
  if (state.motionMode === "walk") {
    blendRigTowardNeutral(externalSkeleton, {
      torso: 0.7,
      head: 0.7,
      upperArm: 0.52,
      foreArm: 0.55,
      hand: 0.6,
      thigh: 0.78,
      shin: 0.8,
      foot: 0.85,
    });
  } else if (state.motionMode === "space") {
    blendRigTowardNeutral(externalSkeleton, {
      torso: 0.82,
      head: 0.86,
      upperArm: 0.88,
      foreArm: 0.9,
      hand: 0.92,
      thigh: 0.9,
      shin: 0.92,
      foot: 0.94,
    });
  }
}

function getCameraRootMotion(frame) {
  const calibration = functionalState.calibration;
  if (!frame?.imageCenter || !calibration?.hipsVisible || frame.points.hipCenter.visibility < 0.56) return null;
  const scaleRatio = frame.bodyScale / calibration.bodyScale;
  return new THREE.Vector3(
    THREE.MathUtils.clamp(
      (frame.imageCenter.x - calibration.imageCenter.x) * 2.4,
      -0.7,
      0.7,
    ),
    THREE.MathUtils.clamp(
      (calibration.imageCenter.y - frame.imageCenter.y) * 2.4,
      -0.55,
      0.55,
    ),
    THREE.MathUtils.clamp((scaleRatio - 1) * 0.72, -0.4, 0.55),
  ).applyQuaternion(liveRetargeter.viewRotation);
}

function setRigAnimationPhase(rigState, normalizedPhase) {
  if (!rigState.mixer || !rigState.clip) return;
  const duration = Math.max(rigState.clip.duration, 0.001);
  const phase = THREE.MathUtils.euclideanModulo(normalizedPhase, 1);
  rigState.mixer.setTime(phase * duration);
}

function lockRigRootTransform(rigState) {
  const root = rigState.bones.root;
  const neutralRoot = rigState.neutralPose.root;
  if (!root || !neutralRoot) return;
  root.position.copy(neutralRoot.position);
  root.quaternion.copy(neutralRoot.quaternion);
}

function blendRigTowardNeutral(rigState, retention) {
  const pose = rigState.neutralPose;
  if (!pose) return;

  const retentionByBone = {
    spine: retention.torso,
    spine1: retention.torso,
    torso: retention.torso,
    neck: retention.head ?? retention.torso,
    head: retention.head ?? retention.torso,
    leftShoulder: retention.upperArm,
    rightShoulder: retention.upperArm,
    leftArm: retention.upperArm,
    rightArm: retention.upperArm,
    leftForeArm: retention.foreArm,
    rightForeArm: retention.foreArm,
    leftHand: retention.hand ?? retention.foreArm,
    rightHand: retention.hand ?? retention.foreArm,
    leftUpLeg: retention.thigh,
    rightUpLeg: retention.thigh,
    leftLeg: retention.shin,
    rightLeg: retention.shin,
    leftFoot: retention.foot,
    rightFoot: retention.foot,
  };

  Object.entries(retentionByBone).forEach(([key, animationRetention]) => {
    blendBoneToNeutral(
      rigState.bones[key],
      pose[key],
      animationRetention,
    );
  });
}

function blendBoneToNeutral(bone, neutralPose, animationRetention) {
  if (!bone || !neutralPose) return;
  const retention = THREE.MathUtils.clamp(animationRetention, 0, 1);
  const animatedQuaternion = bone.quaternion.clone();
  bone.quaternion
    .copy(neutralPose.quaternion)
    .slerp(animatedQuaternion, retention);
}

function setMotionMode(mode) {
  if (!["stand", "walk", "space", "camera"].includes(mode)) return;
  if (mode === "camera" && !poseController.active) return;
  state.motionMode = mode;
  syncInputs();

  const messages = {
    stand: "Stand selected. The human holds a stable upright pose for movement inspection.",
    walk: "Idle selected. The human plays its breathing animation.",
    space: "Space movement selected. The human floats with gentle translation and body rotation.",
    camera: "Live pose selected. Body landmarks drive the human rig; visible hands add finger movement and face landmarks add jaw movement. Monocular motion remains an estimate.",
  };
  appendAssistantMessage(messages[mode]);
}

function getRiskColor(score) {
  if (score >= 72) return { css: "#ff756d", hex: 0xff5e56 };
  if (score >= 42) return { css: "#f2b44b", hex: 0xf2b44b };
  return { css: "#65d479", hex: 0x65d479 };
}

async function loadDemoPrediction(targetRegion = state.target) {
  const response = await fetch(appAssetUrl("inference/demo/IMG0001739_prediction.json"));
  if (!response.ok) {
    throw new Error(`Prediction JSON failed to load: ${response.status}`);
  }
  const payload = await response.json();
  applyAiPrediction(payload, appAssetUrl("inference/demo/IMG0001739_overlay.png"), targetRegion);
}

function applyAiPrediction(payload, overlaySrc = "", targetRegion = "") {
  aiState.loaded = true;
  aiState.fractureScore = Number(
    payload.fractureScore ?? payload.fractureProbability ?? 0,
  );
  aiState.fractureDetected = Boolean(payload.fractureDetected);
  aiState.maskAreaFraction = Number(payload.maskAreaFraction ?? 0);
  aiState.overlaySrc = overlaySrc
    || payload.overlayDataUrl
    || normalizeOverlayPath(payload.overlayPath || "");
  aiState.warning =
    payload.modelWarning
    || "Research model score. Not a calibrated probability or diagnosis.";
  aiState.provenance = payload.model?.classifier
    ? `${payload.model.classifier} + ${payload.model.segmenter}`
    : `${payload.classifier || "DenseNet121"} + ${payload.segmenter || "U-Net++"} | verified held-out case`;

  if (targetRegion) {
    state.target = targetRegion;
    syncInputs();
  }

  latestModel = calculateRisk(state);
  updateUi();
  updateScene();
  appendAssistantMessage(
    aiState.fractureDetected
      ? `AI X-ray result loaded: fracture-screening model score <strong>${(aiState.fractureScore * 100).toFixed(1)}/100</strong>. Evidence status is <strong>${latestDecision.concordance.label.toLowerCase()}</strong>, with the ${TARGET_META[state.target].label.toLowerCase()} used as the 3D hotspot. No weighted medical score is calculated.`
      : `AI X-ray result loaded: fracture-screening model score <strong>${(aiState.fractureScore * 100).toFixed(1)}/100</strong>. The score is below the provisional screening threshold; it does not exclude an occult injury.`,
  );
}

function clearAiPrediction({ announce = true } = {}) {
  aiState.loaded = false;
  aiState.fractureScore = null;
  aiState.fractureDetected = false;
  aiState.maskAreaFraction = null;
  aiState.overlaySrc = "";
  aiState.warning = "Research model score. Not a calibrated probability or diagnosis.";
  aiState.provenance = "DenseNet121 + U-Net++ | FracAtlas held-out evaluation";
  updateUi();
  if (announce) {
    appendAssistantMessage(
      "AI X-ray result cleared. The decision is marked incomplete until structural image evidence is connected again.",
    );
  }
}

function normalizeOverlayPath(path) {
  if (!path) return "";
  if (path.startsWith("/") || path.startsWith("http")) return path;
  return "";
}

async function initializeNasaEvidence() {
  try {
    const response = await fetch(appAssetUrl("data/osdr-804-summary.json"));
    if (!response.ok) throw new Error(`NASA data failed to load: ${response.status}`);
    const summary = await response.json();
    if (summary.schemaVersion !== "astrobone-osdr-summary-v1") {
      throw new Error("Unsupported NASA evidence schema");
    }
    nasaEvidenceState.available = true;
    nasaEvidenceState.summary = summary;
    refs.nasaEvidenceStatus.textContent = `CC0 / ${summary.study.sampleRecords} records`;
    refs.nasaEvidenceStatus.dataset.state = "ready";
    refs.nasaStudySummary.textContent = `${summary.study.spaceflightDurationDays}-day ISS mouse microCT`;
    refs.nasaDistalChange.textContent = formatNasaComparison(
      summary,
      "DistalFemur",
      "bone_volume_total_volume_millimeter_cubed",
    );
    refs.nasaCorticalChange.textContent = formatNasaComparison(
      summary,
      "CorticalFemur",
      "cortical_thickness_millimeter",
    );
    refs.nasaVertebraChange.textContent = formatNasaComparison(
      summary,
      "Vertebrae",
      "bone_volume_total_volume_millimeter_cubed",
    );
    refs.nasaEvidenceBoundary.textContent = summary.useBoundary;
  } catch (error) {
    refs.nasaEvidenceStatus.textContent = "Unavailable";
    refs.nasaEvidenceStatus.dataset.state = "error";
    refs.nasaEvidenceBoundary.textContent = error.message;
  }
  updateMissionReview();
}

function formatNasaComparison(summary, site, measure) {
  const comparison = summary.flightVsGroundControl.find(
    (item) => item.site === site && item.measure === measure,
  );
  if (!comparison) return "--";
  const difference = comparison.percentDifference;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(1)}% vs ground`;
}

async function initializeSimulationEvidence() {
  try {
    const response = await fetch(
      appAssetUrl("simulations/astrobone-level-a-v1.json"),
    );
    if (!response.ok) {
      throw new Error(`simulation evidence failed to load: ${response.status}`);
    }
    simulationEvidenceState.evidence = validateSimulationEvidence(
      await response.json(),
    );
    simulationEvidenceState.available = true;
    simulationEvidenceState.error = "";
  } catch (error) {
    simulationEvidenceState.available = false;
    simulationEvidenceState.error = error.message;
  }
  updateSimulationEvidenceUi();
  updateMissionReview();
}

function applySimulationEvidence() {
  const evidence = simulationEvidenceState.evidence;
  if (!evidence) {
    appendAssistantMessage(
      "The Simulink evidence package is not available in this build.",
    );
    return;
  }

  Object.assign(state, simulationScenarioToUiState(evidence));
  resetResponseRecord();
  clearAiPrediction({ announce: false });
  syncInputs();
  latestModel = calculateRisk(state);

  const comparison = compareRiskToSimulation(latestModel, evidence);
  if (!comparison.matches) {
    simulationEvidenceState.active = false;
    simulationEvidenceState.comparison = comparison;
    updateSimulationEvidenceUi();
    appendAssistantMessage(
      "The evidence case was rejected because the browser calculation did not match the exported Simulink baseline.",
    );
    return;
  }

  simulationEvidenceState.active = true;
  simulationEvidenceState.comparison = comparison;
  updateUi();
  updateSimulationEvidenceUi();
  updateScene();
  setWorkflowStage(1);
  appendAssistantMessage(
    `Verified EVA case loaded. The browser reproduces the Simulink baseline: <strong>${latestModel.demandCapacityRatio.toFixed(3)}x DCR</strong>, ${(latestModel.contactStressPa / 1e6).toFixed(1)} MPa nominal stress, and ${(latestModel.adjustedCapacity / 1e6).toFixed(1)} MPa assumed adjusted capacity. This confirms implementation consistency, not biological validity.`,
  );
}

function updateSimulationEvidenceUi() {
  const evidence = simulationEvidenceState.evidence;
  refs.loadSimulationCase.disabled = !evidence;

  if (!evidence) {
    refs.simulationEvidenceStatus.textContent = simulationEvidenceState.error
      ? "Unavailable"
      : "Loading";
    refs.simulationEvidenceStatus.dataset.state = simulationEvidenceState.error
      ? "error"
      : "loading";
    refs.simulationInterpretation.textContent = simulationEvidenceState.error
      ? "The simulation evidence file could not be validated in this build."
      : "Internal implementation evidence is loading.";
    return;
  }

  const verification = evidence.internalVerification;
  const exceeded = evidence.monteCarlo.scenarioFractions.capacityExceeded;
  refs.simulationEvidenceStatus.textContent = simulationEvidenceState.active
    ? "Case active"
    : "Verified source";
  refs.simulationEvidenceStatus.dataset.state = simulationEvidenceState.active
    ? "active"
    : "available";
  refs.simulationDcr.textContent = `${evidence.outputs.demandCapacityRatio.toFixed(3)}x`;
  refs.simulationBand.textContent = evidence.outputs.bandLabel;
  refs.simulationStress.textContent =
    `${evidence.outputs.peakContactStressMPa.toFixed(1)} MPa`;
  refs.simulationVerification.textContent =
    `${verification.comparisonRuns} / ${Math.round(verification.riskBandAgreementFraction * 100)}%`;
  refs.simulationExceeded.textContent = `${(exceeded * 100).toFixed(2)}%`;
  refs.simulationInterpretation.textContent =
    `${evidence.monteCarlo.runs.toLocaleString()} runs describe fractions of assumed research-envelope scenarios, not mission-occurrence or clinical probabilities.`;
  refs.simulationProof.textContent =
    `${verification.proves} It does not prove ${verification.doesNotProve.toLowerCase()}`;

  refs.simulationSensitivity.replaceChildren();
  evidence.sensitivity.slice(0, 5).forEach((item) => {
    const row = document.createElement("li");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    const track = document.createElement("div");
    const bar = document.createElement("i");

    label.textContent = `${item.rank}. ${item.input}`;
    value.textContent = `rho ${item.spearmanRho.toFixed(2)}`;
    bar.style.width = `${Math.abs(item.spearmanRho) * 100}%`;
    track.className = "sensitivity-track";
    track.appendChild(bar);
    heading.append(label, value);
    row.append(heading, track);
    refs.simulationSensitivity.appendChild(row);
  });
}

function logObservation() {
  incidentLog.push({
    recordedAt: new Date().toISOString(),
    crewCondition: {
      painScore: state.painScore,
      swelling: state.swelling,
      mobility: state.mobility,
      sensationChange: state.sensationChange,
    },
    evidenceConcordance: latestDecision.concordance,
    mechanicalDemandIndex: Math.round(latestModel.mechanicalDemandScore),
    demandCapacityRatio: Number(latestModel.demandCapacityRatio.toFixed(4)),
    relativeConcernBand: latestModel.riskBand.label,
    carePriority: latestCarePlan.priority.label,
    completedActions: [...completedCareActions],
  });
  updateObservationCount();
  appendAssistantMessage(
    `Observation ${incidentLog.length} recorded with pain <strong>${state.painScore}/10</strong>, ${state.swelling} swelling, and ${state.mobility} limb use.`,
  );
}

function getSimulationEvidenceSummary() {
  const evidence = simulationEvidenceState.evidence;
  if (!evidence) {
    return {
      available: false,
      activeForCurrentScenario: false,
      status: simulationEvidenceState.error || "Evidence package not loaded.",
    };
  }

  return {
    available: true,
    activeForCurrentScenario: simulationEvidenceState.active,
    schemaVersion: evidence.schemaVersion,
    modelClass: evidence.provenance.modelClass,
    simscapeUsed: evidence.provenance.simscapeUsed,
    sourceArchiveSha256: evidence.provenance.sourceArchiveSha256,
    verificationLevel: evidence.provenance.verificationLevel,
    comparisonRuns: evidence.internalVerification.comparisonRuns,
    riskBandAgreementFraction:
      evidence.internalVerification.riskBandAgreementFraction,
    maximumAbsoluteDcrErrorPercent:
      evidence.internalVerification.maximumAbsoluteDcrErrorPercent,
    baselineDemandCapacityRatio: evidence.outputs.demandCapacityRatio,
    monteCarloRuns: evidence.monteCarlo.runs,
    assumedScenarioFractions: evidence.monteCarlo.scenarioFractions,
    mitigationWhatIf: evidence.mitigationWhatIf,
    interpretation: evidence.monteCarlo.interpretation,
    externalBiomechanicalValidation:
      evidence.scope.externalBiomechanicalValidation,
  };
}

function getMovementEvidenceSummary() {
  const assessment = functionalState.latestResult;
  if (assessment?.status !== "complete") {
    return {
      available: false,
      schemaVersion: MOVEMENT_EVIDENCE_SCHEMA_VERSION,
      status: "No completed movement assessment in this browser session.",
    };
  }

  return {
    available: true,
    ...createMovementEvidencePacket({
      assessment,
      baseline: assessment.sourceKind === "video" ? null : functionalState.baseline,
    }),
  };
}

async function exportMovementEvidence() {
  const assessment = functionalState.latestResult;
  if (assessment?.status !== "complete") return;
  const packet = createMovementEvidencePacket({
    assessment,
    baseline: assessment.sourceKind === "video" ? null : functionalState.baseline,
  });
  if (!await downloadJson("astrobone-movement-evidence", packet)) return;
  appendAssistantMessage(
    "Movement evidence exported with MotionGuard kinematics, capture quality, range, asymmetry, and baseline comparison. It contains no video, images, or raw landmarks. MotionGuard does not alter the fracture model or mechanical DCR.",
  );
}

async function exportHandoffPacket() {
  const packet = {
    schemaVersion: "astrobone-handoff-v3",
    generatedAt: new Date().toISOString(),
    purpose:
      "Research prototype handoff packet for qualified medical or mission review.",
    mode: state.mode,
    scenario: {
      objectType: state.objectType,
      objectLabel: OBJECT_META[state.objectType].label,
      targetRegion: state.target,
      massGrams: state.mass,
      speedMetersPerSecond: state.speed,
      impactAngleFromSurfacePlaneDegrees: state.angle,
      contactAreaSquareMillimeters: state.contactArea,
      impactDurationMilliseconds: latestModel.inputs.impactDurationMs,
      baselineCapacityMegapascals: latestModel.inputs.baselineCapacityMPa,
      capacityDefinition:
        "Tissue-level or research-envelope stress proxy according to the loaded scenario; not whole-bone fracture strength.",
      boneStrengthIndex: state.boneIndex,
      microgravityDays: state.microgravityDays,
    },
    condition: {
      painScore: state.painScore,
      swelling: state.swelling,
      mobility: state.mobility,
      sensationChange: state.sensationChange,
    },
    imageEvidence: {
      loaded: aiState.loaded,
      fractureScore: aiState.fractureScore,
      calibratedProbability: false,
      fractureDetected: aiState.fractureDetected,
      maskAreaFraction: aiState.maskAreaFraction,
      modelWarning: aiState.warning,
    },
    impactModel: latestModel,
    movementEvidence: getMovementEvidenceSummary(),
    scenarioComparison: compareMissionScenarios(scenarioReference, currentScenarioSnapshot()),
    missionReview: currentMissionReview(),
    simulationEvidence: getSimulationEvidenceSummary(),
    decisionAssessment: latestDecision,
    responsePlan: {
      priority: latestCarePlan.priority,
      redFlags: latestCarePlan.redFlags,
      summary: latestCarePlan.summary,
      actions: latestCarePlan.actions,
      completedActions: [...completedCareActions],
      protocolNote: latestCarePlan.protocolNote,
    },
    observations: incidentLog,
    limitations: [
      "Not a diagnosis or autonomous treatment system.",
      "Requires an approved medical protocol and qualified oversight.",
      "Impact mechanics and evidence fusion remain research models requiring external validation.",
      "Camera movement evidence is monocular and requires external reliability comparison.",
    ],
  };

  if (!await downloadJson("astrobone-handoff", packet)) return;

  appendAssistantMessage(
    "Medical handoff packet exported with the scenario, image evidence, crew condition, model uncertainty, response plan, and observation trend.",
  );
}

async function exportCompetitionBrief() {
  const brief = {
    schemaVersion: "astrobone-competition-brief-v4",
    missionReview: currentMissionReview(),
    scenarioComparison: compareMissionScenarios(scenarioReference, currentScenarioSnapshot()),
    generatedAt: new Date().toISOString(),
    projectName: "AstroBone Twin",
    tagline:
      "Explainable musculoskeletal decision support for exploration crews when care is delayed.",
    problem:
      "A modest impact may exceed reduced skeletal capacity while specialist support and evacuation are delayed.",
    solution:
      "A prototype mission-adaptive skeletal digital twin framework keeps 3D event reconstruction, X-ray screening, mechanics, skeletal state, crew condition, and response handoff in one traceable workflow.",
    currentPrototype: {
      mode: state.mode,
      scenario: OBJECT_META[state.objectType].label,
      targetRegion: TARGET_META[state.target].label,
      demandCapacityRatio: Number(latestModel.demandCapacityRatio.toFixed(3)),
      relativeConcernBand: latestModel.riskBand.label,
      sourceCoverage: `${latestDecision.sourceCount} of 3`,
      uncertainty: latestDecision.uncertainty,
      carePriority: latestCarePlan.priority.label,
    },
    modelEvidence: {
      classifier: {
        architecture: "DenseNet121 fracture classifier",
        dataset: "FracAtlas prototype split",
        servedCheckpointEvaluation: "pending",
      },
      segmenter: {
        architecture: "U-Net++ with DenseNet121 encoder",
        dataset: "FracAtlas mask prototype split",
        servedCheckpointEvaluation: "pending",
      },
      priorFinalEpochExperiment: {
        checkpointAligned: false,
        classifierAuc: 0.899,
        classifierFractureRecall: 0.656,
        segmenterDice: 0.394,
      },
      simulation: getSimulationEvidenceSummary(),
      functionalVision: getMovementEvidenceSummary(),
      limitations: [
        "Research prototype only, not a diagnosis.",
        "External clinical validation is still required.",
        "External lab contact validation is still required for impact mechanics.",
        "OSD-804 is integrated as animal biological context, not human risk calibration.",
      ],
    },
    judgingAlignment: [
      {
        criterion: "Impact",
        currentStatus:
          "Strong problem framing for exploration crews, delayed care, and prevention-to-handoff workflow.",
      },
      {
        criterion: "Creativity",
        currentStatus:
          "Connects a rigged skeletal twin, supporting fracture-screening AI, mechanics, skeletal state, and crew response without hiding channel disagreement.",
      },
      {
        criterion: "Validity",
        currentStatus:
          "Level-A equations have internal Simulink implementation verification; external biomechanical calibration and validation remain open.",
      },
      {
        criterion: "Relevance",
        currentStatus:
          "Must be mapped to an official competition challenge and supported with NASA/open data citations.",
      },
      {
        criterion: "Presentation",
        currentStatus:
          "Prepare a concise demo and deck; confirm the 2026 submission format before submission.",
      },
    ],
    nextUpgrades: [
      "Calibrate the effective capacity and contact assumptions against published or benchtop biomechanics.",
      "Run an independent external validation set rather than equation-equivalence cases.",
      "Map the prototype to the selected official competition challenge and judging rubric.",
      "Prepare a narrated demo and deck within the confirmed 2026 rules.",
    ],
    sourceLinks: getValidationSourceLinks(),
  };

  if (!await downloadJson("astrobone-competition-brief", brief)) return;
  appendAssistantMessage(
    "Competition brief exported with the problem, solution, model evidence, judging alignment, and next validation gaps.",
  );
}

async function exportValidationReport() {
  const report = {
    schemaVersion: "astrobone-validation-report-v3",
    generatedAt: new Date().toISOString(),
    purpose:
      "Transparent validation report for judges, reviewers, and future scientific calibration.",
    currentScenario: {
      mode: state.mode,
      objectType: state.objectType,
      objectLabel: OBJECT_META[state.objectType].label,
      targetRegion: TARGET_META[state.target].label,
      massGrams: state.mass,
      speedMetersPerSecond: state.speed,
      impactAngleFromSurfacePlaneDegrees: state.angle,
      contactAreaSquareMillimeters: state.contactArea,
      impactDurationMilliseconds: latestModel.inputs.impactDurationMs,
      boneElasticModulusGigapascals: latestModel.inputs.boneModulusGPa,
      baselineCapacityMegapascals: latestModel.inputs.baselineCapacityMPa,
      boneStrengthIndex: state.boneIndex,
      microgravityDays: state.microgravityDays,
    },
    mechanicsModel: {
      kineticEnergy: {
        formula: "0.5 * massKg * speedMetersPerSecond^2",
        currentJoules: Number(latestModel.kineticEnergyJ.toFixed(4)),
      },
      normalImpactEnergy: {
        formula: "0.5 * massKg * (speedMetersPerSecond * sin(angle))^2",
        currentJoules: Number(latestModel.normalImpactEnergyJ.toFixed(4)),
      },
      estimatedImpulse: {
        formula: "massKg * normalImpactSpeed",
        currentNewtonSeconds: Number(latestModel.estimatedImpulseNs.toFixed(4)),
      },
      averageForce: {
        formula: "estimatedImpulse / impactDurationSeconds",
        currentNewtons: Number(latestModel.averageForceN.toFixed(4)),
      },
      contactStress: {
        formula: "averageForce / contactAreaSquareMeters",
        currentMegapascals: Number((latestModel.contactStressPa / 1e6).toFixed(4)),
      },
      estimatedStrain: {
        formula: "contactStressPa / boneModulusPa",
        currentMicrostrain: Number((latestModel.estimatedStrain * 1e6).toFixed(2)),
      },
      capacity: {
        formula: "baselineCapacity * microgravity * site * person factors",
        baselineMegapascals: Number((latestModel.baselineCapacity / 1e6).toFixed(4)),
        adjustedMegapascals: Number((latestModel.adjustedCapacity / 1e6).toFixed(4)),
      },
      demandCapacityRatio: {
        formula: "contactStressPa / adjustedCapacityPa",
        currentValue: Number(latestModel.demandCapacityRatio.toFixed(4)),
        researchBand: latestModel.riskBand,
        clinicalCutoff: false,
      },
      validationStatus: latestModel.confidence,
      assumptions: latestModel.assumptions,
      warnings: latestModel.warnings,
    },
    simulationModelCard: getSimulationEvidenceSummary(),
    functionalVisionModelCard: {
      intendedUse:
        "Local aggregate movement evidence for trend review and functional camera reliability studies.",
      nonUse:
        "Not a fracture detector, clinical motion-capture system, or input that rewrites image or mechanics scores.",
      currentSessionEvidence: getMovementEvidenceSummary(),
      requiredNextValidation: [
        "Compare camera-derived joint angles with a goniometer or motion-capture reference.",
        "Report usable-frame rate and error across lighting, clothing, distance, occlusion, and left-right orientation conditions.",
        "Repeat captures to estimate test-retest reliability and failure frequency.",
      ],
    },
    imageModelCard: {
      intendedUse:
        "Research triage layer for fracture image evidence within an explainable workflow.",
      nonUse:
        "Not a diagnostic model, not a treatment tool, and not validated for astronaut-specific fracture imaging.",
      classifier: {
        architecture: "DenseNet121",
        dataset: "FracAtlas prototype split",
        servedCheckpointEvaluation: "pending",
      },
      segmenter: {
        architecture: "U-Net++ with DenseNet121 encoder",
        dataset: "FracAtlas mask prototype split",
        servedCheckpointEvaluation: "pending",
      },
      priorFinalEpochExperiment: {
        checkpointAligned: false,
        classifierAuc: 0.899,
        classifierFractureRecall: 0.656,
        segmenterDice: 0.394,
      },
      failureModes: [
        "Subtle or occult fractures may be missed.",
        "Mask area can be inaccurate with weak boundaries.",
        "Clinical X-ray data does not equal astronaut-specific data.",
        "Image prediction should be reviewed with event mechanics and symptoms.",
      ],
    },
    datasetCard: {
      fractureImaging: {
        dataset: "FracAtlas",
        role: "Prototype fracture classification and segmentation training.",
        limitation:
          "Public musculoskeletal radiographs are a proxy for image evidence, not a spaceflight dataset.",
      },
      spaceflightEvidence: {
        role: "NASA bone-health evidence motivates microgravity fragility inputs.",
        limitation:
          "Astronaut skeletal health data is sensitive and often aggregated or controlled.",
      },
    },
    requiredNextValidation: [
      "Physics sanity checks against hand calculations.",
      "Biomechanics comparison with published bone-strength and contact-loading literature.",
      "An independent reduced-order biomechanics or benchtop benchmark for contact and load-transfer assumptions.",
      "External image validation on an independent fracture dataset.",
      "Clinician or mission-medical expert review of response actions.",
    ],
    sourceLinks: getValidationSourceLinks(),
  };

  if (!await downloadJson("astrobone-validation-report", report)) return;
  appendAssistantMessage(
    "Validation report exported with formulas, current mechanics values, model-card limits, dataset-card notes, and source links.",
  );
}

function getValidationSourceLinks() {
  return [
    {
      label: "NASA 2024 Evidence Report: Risk of Bone Fracture due to Spaceflight-induced Changes to Bone",
      url: "https://ntrs.nasa.gov/citations/20240005190",
      role: "Current NASA framing for applied load, skeletal competence, fracture risk, and remaining research gaps.",
    },
    {
      label: "NASA Risk of Bone Fracture due to Spaceflight-induced Changes to Bone",
      url: "https://www.nasa.gov/directorates/esdmd/hhp/risk-of-bone-fracture-due-to-spaceflight-induced-changes-to-bone/",
      role: "Spaceflight fracture risk depends on expected loads and skeletal fragility.",
    },
    {
      label: "NASA Risk of Spaceflight-Induced Bone Changes",
      url: "https://www.nasa.gov/reference/risk-of-spaceflight-induced-bone-changes/",
      role: "NASA summarizes microgravity-linked bone density loss and fracture susceptibility.",
    },
    {
      label: "NASA Extravehicular Suit Impact Load Attenuation Study",
      url: "https://ntrs.nasa.gov/citations/20110011355",
      role: "Shows why suit attenuation and contact conditions remain uncertainty terms for fracture prediction.",
    },
    {
      label: "Pre-flight exercise and bone metabolism predict unloading-induced bone loss",
      url: "https://pubmed.ncbi.nlm.nih.gov/33597120/",
      role: "Human spaceflight evidence for tibial microarchitecture, density, and estimated strength changes.",
    },
    {
      label: "FracAtlas Scientific Data paper",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10404222/",
      role: "Public fracture X-ray dataset used for prototype imaging models.",
    },
  ];
}

async function downloadJson(filenameBase, payload) {
  const filename = buildTimestampedJsonFilename(filenameBase);
  if (nativeRuntime.isNative) {
    try {
      await shareJsonEvidence(filename, payload);
      return true;
    } catch (error) {
      appendAssistantMessage(`Android could not prepare the evidence file: ${error.message}`);
      return false;
    }
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

function initializePlatformRuntime() {
  document.documentElement.dataset.platform = nativeRuntime.platform;
  if (!nativeRuntime.isNative) return;
  refs.platformStatus.textContent = "Android research app";
  refs.nativeApiConfig.hidden = false;
  refs.apiBaseUrl.value = xrayApi.baseUrl;
  refs.apiBaseStatus.textContent = xrayApi.baseUrl
    ? `Configured: ${xrayApi.baseUrl}`
    : "No external service configured. Offline evidence remains available.";
}

function saveNativeApiBase() {
  try {
    const baseUrl = xrayApi.setBaseUrl(refs.apiBaseUrl.value, { persist: true });
    refs.apiBaseStatus.textContent = baseUrl
      ? `Configured: ${baseUrl}`
      : "No external service configured. Offline evidence remains available.";
    initializeXrayAvailability();
  } catch (error) {
    refs.apiBaseStatus.textContent = error.message;
  }
}

function clearNativeApiBase() {
  xrayApi.clearBaseUrl({ persist: true });
  refs.apiBaseUrl.value = "";
  refs.apiBaseStatus.textContent =
    "No external service configured. Offline evidence remains available.";
  initializeXrayAvailability();
}

function resetResponseRecord() {
  incidentLog.length = 0;
  completedCareActions.clear();
  updateObservationCount();
}

function setWorkflowStage(stage, { announce = false } = {}) {
  const nextStage = Math.max(0, Math.min(workflowStages.length - 1, Number(stage) || 0));
  workflowStage = nextStage;
  const meta = workflowStages[workflowStage];

  refs.workflowTabs.forEach((button, index) => {
    const isActive = index === workflowStage;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  refs.stagePanels.forEach((panel, index) => {
    panel.hidden = index !== workflowStage;
  });

  refs.stageKicker.textContent = `Step ${workflowStage + 1} of ${workflowStages.length}`;
  refs.stageTitle.textContent = getStageTitle(workflowStage);
  refs.stageDescription.textContent = getStageDescription(workflowStage);
  refs.workflowProgress.textContent = `${workflowStage + 1} / ${workflowStages.length}`;
  refs.workflowBack.disabled = workflowStage === 0;
  refs.workflowNext.textContent = getNextLabel(workflowStage, meta.nextLabel);

  if (announce) {
    appendAssistantMessage(
      workflowStage === 3
        ? `Decision review opened. Current evidence coverage is <strong>${latestDecision.sourceCount} of 3 sources</strong>, with ${latestDecision.uncertainty.toLowerCase()}.`
        : `${meta.title} selected. Changes here update the same 3D case and decision signal.`,
    );
  }
}

function getStageTitle(stage) {
  if (stage === 2) return "Assess crew reserve and condition";
  if (stage === 3) return "Build the onboard response";
  return workflowStages[stage].title;
}

function getStageDescription(stage) {
  if (stage === 2) {
    return "Combine bone strength, microgravity exposure, movement evidence, reported pain, swelling, limb use, and sensation. Condition flags affect response urgency, not the image score.";
  }
  if (stage === 3) {
    return "Use the same record to protect the crew member, follow an approved protocol, monitor change, and prepare a flight-surgeon handoff.";
  }
  return workflowStages[stage].description;
}

function getNextLabel(stage, fallback) {
  if (stage === 1) return "Next: crew";
  return fallback;
}

async function runGuidedDemo() {
  applyPreset("eva", { announce: false });
  setWorkflowStage(0);
  refs.guidedDemo.disabled = true;
  refs.guidedDemo.textContent = "Loading case...";

  try {
    await loadDemoPrediction(state.target);
    appendAssistantMessage(
      "Guided exploration case loaded: a public terrestrial distal-leg X-ray result is paired with a hypothetical EVA-tool impact after 180 days of exposure. This illustrative pairing is not an astronaut record or one person's measured digital twin.",
    );
  } catch (error) {
    appendAssistantMessage(`I could not load the guided case: ${error.message}`);
  } finally {
    refs.guidedDemo.disabled = false;
    updateMissionCopy();
  }
}

function applyPreset(name, { announce = true } = {}) {
  Object.assign(state, presets[name]);
  simulationEvidenceState.active = false;
  simulationEvidenceState.comparison = null;
  resetResponseRecord();
  syncInputs();
  latestModel = calculateRisk(state);
  updateUi();
  updateSimulationEvidenceUi();
  updateScene();
  setWorkflowStage(workflowStage);
  if (announce) {
    appendAssistantMessage(getPresetMessage(name));
  }
}

function getPresetMessage(name) {
  if (name === "eva") {
    return "EVA tool preset: moderate speed and a compact contact patch can become concerning when the astronaut has months of reduced mechanical loading.";
  }
  return "Exploration case restored.";
}

function appendMessage(text, role = "assistant") {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  if (role === "user") {
    message.textContent = text;
  } else {
    message.innerHTML = text;
  }
  refs.chatLog.appendChild(message);
  refs.chatLog.scrollTop = refs.chatLog.scrollHeight;
}

function appendAssistantMessage(text) {
  appendMessage(text, "assistant");
}

function replyTo(prompt) {
  const cleaned = prompt.toLowerCase();
  if (
    cleaned.includes("voice")
    || cleaned.includes("posture")
    || cleaned.includes("object")
    || cleaned.includes("incoming")
    || cleaned.includes("direction")
  ) {
    const snapshot = safetyMonitor.getSnapshot();
    const objectSummary = snapshot.objects.items.length
      ? snapshot.objects.items
        .map((item) => `${capitalize(item.label)} ${item.motion} from ${item.direction}`)
        .join(", ")
      : "no supported objects currently visible";
    return `The onboard monitor currently reports <strong>${snapshot.posture.label.toLowerCase()}</strong> and ${objectSummary}. It speaks only sustained-posture reminders and repeated camera evidence of an approaching supported object. A single monocular camera cannot provide all-around awareness, exact distance, collision prediction, or a bone-health diagnosis.`;
  }
  if (
    cleaned.includes("help")
    || cleaned.includes("action")
    || cleaned.includes("respond")
    || cleaned.includes("monitor")
  ) {
    return `AstroBone helps at four points: screen the task before exposure, assess the event and crew condition, open a protocol-linked response plan, then log change and export a flight-surgeon handoff. The current operational priority is <strong>${latestCarePlan.priority.label}</strong>.`;
  }
  if (cleaned.includes("problem") || cleaned.includes("solution")) {
    return "The problem is not impact alone: reduced skeletal reserve and delayed access to definitive care can make an otherwise manageable event harder to judge. AstroBone keeps X-ray evidence, movement, impact mechanics, fragility, symptoms, and uncertainty in one explainable decision record.";
  }
  if (cleaned.includes("nasa") || cleaned.includes("ready")) {
    return "The Level-A equations now have internal Simulink implementation verification and an explicit uncertainty envelope. NASA-facing readiness still requires external biomechanical calibration, mission-medical review, approved response procedures, and crew-analog workflow testing.";
  }
  if (cleaned.includes("motionguard") || cleaned.includes("squat") || cleaned.includes("gait") || cleaned.includes("biomechanic")) {
    const movement = motionGuard.getSnapshot();
    return movement.status === "tracking"
      ? `MotionGuard is recording <strong>${movement.modeLabel}</strong>. Knee flexion is <strong>${movement.kneeFlexionDegrees.left.toFixed(1)} / ${movement.kneeFlexionDegrees.right.toFixed(1)} degrees</strong> and the left-right angle difference is <strong>${movement.kneeDifferenceDegrees.toFixed(1)} degrees</strong>. ${movement.recommendation} Camera coordinates alone do not establish external force, bone stress, strength, or fall risk.`
      : "MotionGuard adds observed movement to the twin using the existing on-device 33-landmark MediaPipe model. It records knee flexion, angle differences, angular speed, squat repetitions, and alternating knee-cycle timing. Missing or held frames are excluded. The mechanical-load bridge remains uncalibrated until external forces and a subject-specific model are available.";
  }
  if (cleaned.includes("camera") || cleaned.includes("movement") || cleaned.includes("webcam")) {
    const result = functionalState.result;
    return result?.status === "complete"
      ? `The camera mapped full-body motion to the skeleton and recorded lower-limb range with <strong>${Math.round(result.trackingQuality * 100)}% tracking quality</strong> and <strong>${Math.round((result.captureQuality?.usableFrameRate ?? 0) * 100)}% usable frames</strong>. Knee range asymmetry was <strong>${result.asymmetry.knee.toFixed(1)} degrees</strong>. The aggregate evidence can be exported, but it never changes the X-ray or mechanics score.`
      : "The camera channel maps 33 local pose landmarks to the full-body skeleton and can record an aggregate movement assessment. It stores no video or raw landmarks and cannot detect or exclude fracture.";
  }
  if (cleaned.includes("angle") || cleaned.includes("speed") || cleaned.includes("force")) {
    return `In this run, ${state.speed} m/s and an angle of ${state.angle} degrees from the surface plane create ${latestModel.kineticEnergyJ.toFixed(1)} J of kinetic energy. Arresting the normal velocity over ${latestModel.inputs.impactDurationMs} ms gives an estimated average force of ${latestModel.averageForceN.toFixed(0)} N and nominal contact stress of ${(latestModel.contactStressPa / 1e6).toFixed(1)} MPa.`;
  }
  if (cleaned.includes("risk") || cleaned.includes("score") || cleaned.includes("explain")) {
    return aiState.loaded
      ? `Evidence status: <strong>${latestDecision.concordance.label}</strong>. The X-ray model score is ${latestDecision.imagingScore.toFixed(1)}/100, while the separate mechanical DCR is ${latestDecision.mechanicalIndex.toFixed(2)}x. Uncertainty remains ${latestDecision.uncertainty.toLowerCase()}; no cross-domain weighted score is calculated.`
      : `The demand-capacity ratio is <strong>${latestModel.demandCapacityRatio.toFixed(2)}x</strong> (${latestModel.riskBand.label.toLowerCase()}). It compares ${(latestModel.contactStressPa / 1e6).toFixed(1)} MPa nominal contact stress with ${(latestModel.adjustedCapacity / 1e6).toFixed(1)} MPa estimated capacity. This is a relative research index, not a fracture probability.`;
  }
  if (cleaned.includes("validate") || cleaned.includes("data")) {
    return "Validation is layered. Hand calculations and 25 Simulink comparison runs now check implementation consistency; published biomechanics, independent contact tests, external image data, and qualified mission-medical review are still required. The 5,000-run envelope represents assumed scenarios, not event probabilities.";
  }
  return "Good question. For this prototype, connect the answer to measured or reconstructed load, contact assumptions, skeletal capacity, evidence completeness, and the approved response rule. Those are the parts that make the skeletal twin traceable.";
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function resizeRendererToView(viewRenderer, viewCamera, canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  viewRenderer.setSize(width, height, false);
  viewCamera.aspect = width / height;
  viewCamera.updateProjectionMatrix();
}

function resize() {
  resizeRendererToView(renderer, camera, refs.canvas);
  drawMotionGuardTrace();
}

function getSimulationReplayFrame(phase) {
  const evidence = simulationEvidenceState.active
    ? simulationEvidenceState.evidence
    : null;
  const samples = evidence?.timeSeries?.samples;
  if (!samples?.length) return null;

  const durationSeconds = samples.at(-1).timeSeconds;
  const timeSeconds = phase * durationSeconds;
  let selected = samples[0];
  for (const sample of samples) {
    if (Math.abs(sample.timeSeconds - timeSeconds)
      < Math.abs(selected.timeSeconds - timeSeconds)) {
      selected = sample;
    }
  }

  const impactStart = evidence.scenario.impactTimeSeconds;
  const impactEnd =
    impactStart + evidence.scenario.impactDurationMs / 1000;
  let timelineStep = 0;
  if (timeSeconds >= impactStart && timeSeconds < impactStart + 0.0015) {
    timelineStep = 1;
  } else if (timeSeconds >= impactStart + 0.0015 && timeSeconds <= impactEnd) {
    timelineStep = 2;
  } else if (timeSeconds > impactEnd && timeSeconds < durationSeconds * 0.72) {
    timelineStep = 3;
  } else if (timeSeconds >= durationSeconds * 0.72) {
    timelineStep = 4;
  }

  return {
    timelineStep,
    projectileTravel: Math.min(1, timeSeconds / impactStart),
    displayDcr: selected.demandCapacityRatio,
    displaySeverity: Math.min(100, selected.demandCapacityRatio * 100),
  };
}

let lastTwinFrame = 0;
let twinInView = true;
if (globalThis.IntersectionObserver) {
  new IntersectionObserver(([entry]) => { twinInView = entry.isIntersecting; }, {
    rootMargin: "150px",
  }).observe(refs.canvas);
}

function animate(now) {
  requestAnimationFrame(animate);
  const frameInterval = poseController.starting ? 100
    : window.innerWidth <= 700 ? 50 : 33;
  if (document.hidden || !twinInView || now - lastTwinFrame < frameInterval) return;
  lastTwinFrame = now;
  const elapsed = (now - animationStart) / 1000;
  const phase = (elapsed % 5) / 5;
  const replayFrame = getSimulationReplayFrame(phase);
  const activeStep = replayFrame?.timelineStep
    ?? Math.min(4, Math.floor(phase * 5));
  refs.timelineSteps.forEach((step, index) => {
    step.classList.toggle("active", index === activeStep);
  });

  controls.update();
  if (!localMesh.isShowing()) updateLinkedMotion(elapsed);
  localMesh.update(now);
  healthLayers.update(now);
  anatomicalMotion.update(now);

  const impactPoint = getImpactPoint();
  const direction = getImpactDirection();
  const travel = replayFrame?.projectileTravel
    ?? Math.abs(Math.sin(phase * Math.PI));
  projectile.position.copy(
    impactPoint.clone().sub(direction.clone().multiplyScalar(2.7 * (1 - travel))),
  );
  projectile.scale.setScalar(getProjectileScale());

  const animatedSeverity = replayFrame?.displaySeverity
    ?? latestModel.displaySeverity;
  const animatedDcr = replayFrame?.displayDcr
    ?? latestModel.demandCapacityRatio;
  updateScene(animatedSeverity, animatedDcr);
  impactMarker.scale.setScalar(
    1 + Math.sin(elapsed * 6) * 0.08 + animatedSeverity / 240,
  );
  stressRing.rotation.z += 0.012 + animatedSeverity / 9000;
  renderer.render(scene, camera);
}

function bindEvents() {
  document.querySelector("#open-mission-review").addEventListener("click", () => {
    updateMissionReview();
    document.querySelector("#mission-review-dialog").showModal();
  });
  document.querySelector("#close-mission-review").addEventListener("click", () => {
    document.querySelector("#mission-review-dialog").close();
  });
  document.querySelector("#review-export").addEventListener("click", exportCompetitionBrief);
  document.querySelector("#save-scenario-reference").addEventListener("click", () => {
    scenarioReference = currentScenarioSnapshot();
    document.querySelector("#clear-scenario-reference").disabled = false;
    document.querySelector("#save-scenario-reference").textContent = "Replace comparison reference";
    updateScenarioComparison();
  });
  document.querySelector("#clear-scenario-reference").addEventListener("click", () => {
    scenarioReference = null;
    document.querySelector("#clear-scenario-reference").disabled = true;
    document.querySelector("#save-scenario-reference").textContent = "Save comparison reference";
    updateScenarioComparison();
  });
  [
    refs.targetRegion,
    refs.mass,
    refs.speed,
    refs.angle,
    refs.contactArea,
    refs.boneIndex,
    refs.microgravityDays,
    refs.painScore,
    refs.swelling,
    refs.mobility,
    refs.sensationChange,
  ].forEach((input) => input.addEventListener("input", updateFromInputs));

  refs.motionButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setMotionMode(button.dataset.motion);
    });
  });

  refs.guidedDemo.addEventListener("click", runGuidedDemo);
  refs.logObservation.addEventListener("click", logObservation);
  refs.exportHandoff.addEventListener("click", exportHandoffPacket);
  refs.exportCompetitionBrief.addEventListener("click", exportCompetitionBrief);
  refs.exportValidationReport.addEventListener("click", exportValidationReport);
  refs.loadSimulationCase.addEventListener("click", applySimulationEvidence);

  refs.workflowTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setWorkflowStage(Number(button.dataset.workflowStage), { announce: true });
    });
  });

  refs.workflowBack.addEventListener("click", () => {
    setWorkflowStage(workflowStage - 1);
  });

  refs.workflowNext.addEventListener("click", () => {
    const nextStage = workflowStage === workflowStages.length - 1 ? 0 : workflowStage + 1;
    setWorkflowStage(nextStage);
  });

  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  refs.resetButton.addEventListener("click", () => {
    Object.assign(state, presets.eva);
    simulationEvidenceState.active = false;
    simulationEvidenceState.comparison = null;
    resetResponseRecord();
    latestModel = calculateRisk(state);
    clearAiPrediction({ announce: false });
    syncInputs();
    updateUi();
    updateSimulationEvidenceUi();
    updateScene();
    setWorkflowStage(0);
    appendAssistantMessage(
      "Investigation reset to the EVA-tool case. Image evidence is cleared so the workflow begins with a visible missing-data state.",
    );
  });

  document.querySelectorAll(".suggestions button").forEach((button) => {
    button.addEventListener("click", () => {
      refs.chatInput.value = button.dataset.prompt;
      refs.chatForm.requestSubmit();
    });
  });

  refs.loadDemoPrediction.addEventListener("click", async () => {
    try {
      await loadDemoPrediction();
    } catch (error) {
      appendAssistantMessage(`I could not load the held-out X-ray case: ${error.message}`);
    }
  });

  refs.analyzeXray.addEventListener("click", () => {
    refs.xrayFile.click();
  });

  refs.xrayFile.addEventListener("change", () => {
    const file = refs.xrayFile.files?.[0];
    if (file) analyzeSelectedXray(file);
  });
  refs.saveApiBase.addEventListener("click", saveNativeApiBase);
  refs.clearApiBase.addEventListener("click", clearNativeApiBase);

  refs.clearPrediction.addEventListener("click", clearAiPrediction);
  refs.toggleCamera.addEventListener("click", toggleCamera);
  refs.uploadVideo.addEventListener("click", () => refs.exerciseVideoFile.click());
  refs.exerciseVideoFile.addEventListener("change", () => {
    const file = refs.exerciseVideoFile.files?.[0];
    refs.exerciseVideoFile.value = "";
    if (file) void analyzeExerciseVideo(file);
  });
  refs.replayVideo.addEventListener("click", async () => {
    motionGuard.reset();
    functionalState.calibration = null;
    clearCurrentMovementAssessment();
    try {
      await poseController.replayVideo();
    } catch (error) {
      refs.functionalWarning.textContent = error.message;
    }
  });
  refs.centerPose.addEventListener("click", () => centerCameraPose());
  refs.cameraDevice.addEventListener("change", () => {
    void switchCameraDevice(refs.cameraDevice.value);
  });
  refs.refreshCameras.addEventListener("click", () => {
    void refreshCameraDevices();
  });
  refs.cameraFacingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      void switchCameraFacing(button.dataset.facing);
    });
  });
  refs.mirrorPreview.addEventListener("change", () => {
    refs.poseViewport.dataset.mirrored = String(refs.mirrorPreview.checked);
    safetyMonitor.clearObjects();
  });
  refs.objectAwareness.addEventListener("change", () => {
    poseController.setObjectDetectionEnabled(refs.objectAwareness.checked);
    if (!refs.objectAwareness.checked) {
      safetyMonitor.clearObjects();
    }
  });
  refs.detailTracking.addEventListener("change", () => {
    poseController.setDetailDetectionEnabled(refs.detailTracking.checked);
  });
  refs.voiceAlerts.addEventListener("change", () => {
    voiceAssistant.setEnabled(refs.voiceAlerts.checked);
    if (refs.voiceAlerts.checked) {
      void initializeVoiceAssistant().then(() => voiceAssistant.speak(
        "Voice alerts enabled.",
        {
          key: "voice-enabled",
          cooldownMs: 0,
          interrupt: true,
        },
      ));
    }
  });
  refs.postureThreshold.addEventListener("change", () => {
    safetyMonitor.setPostureHoldMs(Number(refs.postureThreshold.value));
  });
  refs.testVoice.addEventListener("click", async () => {
    voiceAssistant.setEnabled(true);
    refs.voiceAlerts.checked = true;
    await initializeVoiceAssistant();
    const spoken = await voiceAssistant.test();
    if (!spoken) {
      refs.voiceStatus.dataset.state = "error";
      refs.voiceStatus.textContent = "Install or enable a voice engine";
    }
  });
  refs.recordBaseline.addEventListener("click", () => {
    motionGuard.reset();
    poseController.beginAssessment({ asBaseline: true });
    clearCurrentMovementAssessment();
  });
  refs.recordAssessment.addEventListener("click", () => {
    motionGuard.reset();
    poseController.beginAssessment();
    clearCurrentMovementAssessment();
  });
  refs.motionGuardMode.addEventListener("change", () => {
    motionGuard.setMode(refs.motionGuardMode.value);
    appendAssistantMessage(`MotionGuard protocol: ${MOTION_GUARD_MODES[motionGuard.mode]}. This records camera-derived movement evidence, not force, bone strength, or fracture risk.`);
  });
  refs.motionGuardTraceJoint.addEventListener("change", () => {
    updateMotionGuardUi(motionGuard.getSnapshot());
  });
  refs.motionGuardReset.addEventListener("click", () => motionGuard.reset());
  refs.exportMovementEvidence.addEventListener("click", exportMovementEvidence);

  refs.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = refs.chatInput.value.trim();
    if (!prompt) return;
    appendMessage(prompt, "user");
    refs.chatInput.value = "";
    appendAssistantMessage(replyTo(prompt));
  });

  window.addEventListener("resize", resize);
  navigator.mediaDevices?.addEventListener?.("devicechange", handleCameraDeviceChange);
  window.addEventListener("beforeunload", () => {
    clearTimeout(safetyAlertTimer);
    navigator.mediaDevices?.removeEventListener?.("devicechange", handleCameraDeviceChange);
    voiceAssistant.dispose();
    poseController.dispose();
  });
}

bindEvents();
const healthLayers = initHealthLayers({ scene, rig: externalSkeleton, video: refs.poseVideo,
  getFace: () => functionalState.currentDetails,
  isLiveCamera: () => poseController.active && poseController.sourceKind === "camera",
});
const anatomicalMotion = initAnatomicalMotion({ rig: externalSkeleton,
  getFrame: () => functionalState.currentPose, isTracking: () => state.motionMode === "camera",
  isPaused: () => poseController.active && !poseController.starting && poseController.sourceKind === "video"
    && isPausedVideoPose(functionalState.currentPose, refs.poseVideo),
});
const localMesh = initLocalMesh({ scene, rig: externalSkeleton, video: refs.poseVideo,
  isActive: () => poseController.active, getMirror: () => refs.mirrorPreview.checked, camera, controls, renderCanvas: refs.canvas,
});
initCompanion({ getAssessment: () => functionalState.latestResult, getPulse: healthLayers.getPulse });
updateCameraFacingUi(selectedCameraFacing);
void refreshCameraDevices({ preferActiveDevice: false });
poseController.setObjectDetectionEnabled(refs.objectAwareness.checked);
poseController.setDetailDetectionEnabled(refs.detailTracking.checked);
initResearchWorkspace({ controller: poseController, video: refs.poseVideo });
const densePose = initDensePose({ video: refs.poseVideo, getMirror: () => refs.mirrorPreview.checked,
  getSource: () => ({ active: poseController.active, starting: poseController.starting, kind: poseController.sourceKind, session: poseController.cameraSessionId }),
  beforeStart: () => localMesh.stop(),
});
initAnatomyAtlas({ stopCapture: () => { densePose.stop(); poseController.stopCamera(); localMesh.stop(); }, onViewChange: () => requestAnimationFrame(resize) });
new ResizeObserver(resize).observe(refs.canvas);
renderSafetyEventLog();
updateSafetyMonitorUi(safetyMonitor.getSnapshot());
updateMotionGuardUi(motionGuard.getSnapshot());
void initializeVoiceAssistant();
initializePlatformRuntime();
syncInputs();
latestModel = calculateRisk(state);
updateUi();
updateScene();
setWorkflowStage(0);
appendAssistantMessage(
  "AstroBone frames one question: does image evidence agree with reconstructed mechanical demand and modeled skeletal capacity? The investigation preserves each channel separately and ends with an explicit next action.",
);
initializeSimulationEvidence();
initializeNasaEvidence();
initializeXrayAvailability();
updateCameraStatus({ key: "off", label: "Camera off" });
resize();
requestAnimationFrame(animate);
