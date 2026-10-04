import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserCompanion } from "./browserCompanion.js";

const post = (companion, path, body) => companion.request(path, {
  method: "POST", body: JSON.stringify(body),
});
const fakeStorage = () => {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    inspect: () => [...items.values()].join(""),
  };
};
const cameraRecord = (day, angle, overrides = {}) => ({
  mission_day: day, protocol: "camera-knee-extension-v1", gravity: "earth",
  source: "camera", pose_model: "MediaPipe Pose Landmarker lite",
  metrics: { knee_extension_deg: angle }, tracking_quality: .9,
  sample_count: 40, calibrated_distance: false, is_baseline: day === 1,
  consent_to_store: true, ...overrides,
});
const review = async (companion, id, redFlags = []) => {
  const run = await post(companion, "/runs", {
    astronaut_id: id, prompt: "Compare my movement with baseline.",
    red_flags: redFlags, use_llm: false,
  });
  return (await companion.request(`/runs/${run.id}`)).report;
};

test("health series persist in browser fallback and are deleted with the profile", async () => {
  const storage = fakeStorage(), companion = createBrowserCompanion(storage);
  await post(companion, "/profiles", { astronaut_id: "CREW-MULTI", display_name: "Crew", mission_name: "Analog", equipment: ["camera"] });
  const data = { mission_day: 1, observed_at: "2025-01-01T12:00:00Z", source: "instrument", device_id: "PPG-01", protocol: "resting-v1", metrics: { heart_rate_bpm: 67 }, quality: 1, consent_to_store: true };
  await post(companion, "/profiles/CREW-MULTI/health", data);
  assert.equal((await createBrowserCompanion(storage).request("/profiles/CREW-MULTI")).health.length, 1);
  assert.equal((await review(companion, "CREW-MULTI")).multisystem.series.length, 1);
  await companion.request("/profiles/CREW-MULTI", { method: "DELETE" });
  assert.equal(storage.inspect().includes("PPG-01"), false);
});

test("multisystem demo cannot receive webcam observations", async () => {
  const companion = createBrowserCompanion(fakeStorage()), profile = await post(companion, "/demo", {});
  const data = await companion.request(`/profiles/${profile.astronaut_id}`);
  assert.equal(data.health.length, 6); assert.ok(data.health.every(row => row.source === "synthetic"));
  assert.ok(data.radiation.every(row => row.source === "synthetic"));
  await assert.rejects(post(companion, `/profiles/${profile.astronaut_id}/health`, { mission_day: 181, observed_at: "2025-08-01T12:00:00Z", source: "camera_rppg", device_id: "WEBCAM-01", protocol: "resting-v1", metrics: { heart_rate_bpm: 70 }, quality: .9, consent_to_store: true }), /separate/);
});

test("synthetic Day 1-180 journey is explicitly labeled and never predicts fracture", async () => {
  const companion = createBrowserCompanion(fakeStorage());
  const profile = await post(companion, "/demo", {});
  const { history } = await companion.request(`/profiles/${profile.astronaut_id}`);
  assert.equal(profile.is_demo, true);
  assert.deepEqual(history.map((row) => row.mission_day), [1, 30, 90, 180, 182, 194]);
  assert.equal(history[0].is_baseline, true);
  const report = await review(companion, profile.astronaut_id);
  assert.equal(report.engine, "deterministic-browser");
  assert.equal(report.model, "none");
  assert.equal(report.is_demo, true);
  assert.equal(report.priority.status, "change_observed");
  assert.equal(report.comparison.comparable, true);
  assert.equal(report.comparison.changes.find((item) => item.metric === "knee_extension_deg").delta, -5);
  assert.match(report.priority.clinical_predictions.injury_probability, /Not estimated/);
  assert.ok(report.evidence.every((source) => source.url.startsWith("https://www.nasa.gov/")));
  assert.equal(report.privacy.raw_frames_stored, false);
  assert.equal(report.privacy.cloud_used, false);
});

test("real observation needs consent; only allowlisted aggregates persist", async () => {
  const storage = fakeStorage();
  const companion = createBrowserCompanion(storage);
  const profile = await post(companion, "/profiles", {
    astronaut_id: "CREW-001", display_name: "Crew A", mission_name: "Analog",
    equipment: ["camera"],
  });
  const path = `/profiles/${profile.astronaut_id}/assessments`;
  await assert.rejects(post(companion, path, cameraRecord(1, 165, { consent_to_store: false })), /consent/);
  await post(companion, path, { ...cameraRecord(1, 165), raw_frames: "private pixels", landmarks: [1, 2, 3] });
  await assert.rejects(post(companion, path, cameraRecord(2, 160, { is_baseline: true })), /locked/);
  await post(companion, path, cameraRecord(30, 145));
  assert.equal(storage.inspect().includes("private pixels"), false);
  assert.equal(storage.inspect().includes("landmarks"), false);
  const reloaded = createBrowserCompanion(storage);
  assert.equal((await reloaded.request(`/profiles/${profile.astronaut_id}`)).history.length, 2);
  assert.equal((await review(reloaded, profile.astronaut_id)).comparison.comparable, true);
  await reloaded.request(`/profiles/${profile.astronaut_id}`, { method: "DELETE" });
  assert.deepEqual(await reloaded.request("/profiles"), []);
});

test("protocol or gravity mismatch withholds comparison; reported severe pain escalates", async () => {
  const companion = createBrowserCompanion(null);
  const profile = await post(companion, "/profiles", {
    astronaut_id: "CREW-002", display_name: "Crew B", mission_name: "Analog",
    equipment: ["camera"],
  });
  const path = `/profiles/${profile.astronaut_id}/assessments`;
  await post(companion, path, cameraRecord(1, 165));
  await post(companion, path, cameraRecord(90, 140, { gravity: "moon" }));
  const report = await review(companion, profile.astronaut_id);
  assert.equal(report.comparison.comparable, false);
  assert.equal(report.comparison.changes.length, 0);
  assert.equal(report.priority.status, "insufficient_evidence");
  const flagged = await review(companion, profile.astronaut_id, ["new_severe_pain"]);
  assert.equal(flagged.priority.status, "human_review_now");
  assert.equal(flagged.actions[0].approval, "human-led");
});

test("distance-derived measurements require calibration and observation limits are enforced", async () => {
  const companion = createBrowserCompanion(null);
  const profile = await post(companion, "/profiles", {
    astronaut_id: "CREW-003", display_name: "Crew C", mission_name: "Analog",
    equipment: ["camera"],
  });
  const path = `/profiles/${profile.astronaut_id}/assessments`;
  await assert.rejects(post(companion, path, cameraRecord(1, 165, {
    metrics: { gait_speed_m_s: 1.5 },
  })), /unsupported measurement/);
  await assert.rejects(post(companion, path, cameraRecord(1, 165, {
    metrics: { knee_extension_deg: 190 },
  })), /unsupported measurement/);
  await assert.rejects(post(companion, path, cameraRecord(1, 165, {
    sample_count: 5,
  })), /Baseline requires/);
  assert.equal((await companion.request(`/profiles/${profile.astronaut_id}`)).history.length, 0);
});

test("personal dosimeter data is consented context, never a fused bone-risk score", async () => {
  const companion = createBrowserCompanion(fakeStorage());
  const profile = await post(companion, "/profiles", {
    astronaut_id: "CREW-RAD", display_name: "Crew R", mission_name: "Analog", equipment: ["camera"],
  });
  const prefix = `/profiles/${profile.astronaut_id}`;
  await post(companion, `${prefix}/assessments`, cameraRecord(1, 165));
  await post(companion, `${prefix}/assessments`, cameraRecord(30, 150));
  const dose = { mission_day: 30, cumulative_personal_absorbed_dose_mgy: 7.2,
    instrument_id: "DOS-01", consent_to_store: true };
  await assert.rejects(post(companion, `${prefix}/radiation`, { ...dose, consent_to_store: false }), /consent/);
  await post(companion, `${prefix}/radiation`, dose);
  await assert.rejects(post(companion, `${prefix}/radiation`, { ...dose, mission_day: 31,
    cumulative_personal_absorbed_dose_mgy: 6 }), /decrease/);
  await assert.rejects(post(companion, `${prefix}/radiation`, { ...dose, mission_day: 31,
    instrument_id: "DOS-02" }), /new instrument/);
  const report = await review(companion, profile.astronaut_id);
  assert.equal(report.environment.radiation.status, "instrument_recorded");
  assert.equal(report.environment.radiation.cumulative_personal_absorbed_dose_mgy, 7.2);
  assert.match(report.environment.radiation.interpretation, /not authenticated/);
  assert.equal(report.environment.fusion_status, "not_validated");
  assert.match(report.priority.clinical_predictions.bone_loading_risk, /Not estimated/);
  assert.equal((await companion.request(prefix)).radiation.length, 1);
});
