export function assessmentForCompanion(assessment, missionDay, { baseline = false, consent = false, gravity = "earth" } = {}) {
  if (assessment?.status !== "complete") throw new Error("Complete a movement assessment first.");
  const metrics = {};
  for (const side of ["left", "right"]) {
    for (const joint of ["knee", "hip", "ankle"]) {
      const value = assessment.rangeOfMotion?.[side]?.[joint];
      if (Number.isFinite(value)) metrics[`${joint}_rom_${side}_deg`] = value;
    }
  }
  if (Number.isFinite(assessment.asymmetry?.knee)) metrics.knee_asymmetry_deg = assessment.asymmetry.knee;
  const features = assessment.cameraFeatures;
  if (Number.isFinite(features?.kneeExtensionP95Degrees)) metrics.knee_extension_deg = features.kneeExtensionP95Degrees;
  if (Number.isFinite(features?.shoulderAlignmentMeanDegrees)) metrics.shoulder_alignment_deg = features.shoulderAlignmentMeanDegrees;
  if (Number.isFinite(features?.hipSwayRmsBodyScale)) metrics.sway_rms_normalized = features.hipSwayRmsBodyScale;
  if (Number.isFinite(assessment.motionGuard?.meanKneeAngularSpeedDegreesPerSecond)) {
    metrics.knee_angular_speed_deg_s = assessment.motionGuard.meanKneeAngularSpeedDegreesPerSecond;
  }
  if (!Object.keys(metrics).length) throw new Error("No supported aggregate measurements are available.");
  const quality = Math.min(assessment.trackingQuality ?? 0, assessment.captureQuality?.usableFrameRate ?? 0);
  const source = assessment.sourceKind === "video" ? "video" : "camera";
  return {
    mission_day: missionDay,
    protocol: `${source}-motionguard-${assessment.motionGuard?.mode || "monitor"}-v1`,
    gravity, source, pose_model: "MediaPipe Pose Landmarker lite",
    metrics, tracking_quality: quality, sample_count: assessment.sampleCount,
    calibrated_distance: false, is_baseline: baseline, consent_to_store: consent,
  };
}

export function formatMetric(key) {
  const names = {
    knee_extension_deg: "Knee extension", knee_rom_left_deg: "Left knee ROM",
    knee_rom_right_deg: "Right knee ROM", knee_asymmetry_deg: "Knee ROM difference",
    hip_rom_left_deg: "Left hip ROM", hip_rom_right_deg: "Right hip ROM",
    ankle_rom_left_deg: "Left ankle ROM", ankle_rom_right_deg: "Right ankle ROM",
    knee_angular_speed_deg_s: "Knee angular speed", gait_speed_m_s: "Calibrated gait speed",
    step_length_m: "Calibrated step length", sway_rms_normalized: "Normalized sway",
    shoulder_alignment_deg: "Shoulder alignment", cadence_cycles_min: "Knee-cycle cadence",
  };
  return names[key] || key;
}
