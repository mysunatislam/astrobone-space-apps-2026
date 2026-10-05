import * as THREE from "three";
import { PulseCapture } from "./rppg.js";

export function initHealthLayers({ scene, rig, video, getFace, isLiveCamera, onCameraMeasuring = () => {} }) {
  let layer = "body", pulse = null, history = null, helper = null;
  const group = new THREE.Group(); group.name = "Schematic health overlays"; scene.add(group);
  // A schematic heart marker, not reconstructed internal anatomy.
  const heart = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xe56382, roughness: .5, transparent: true, opacity: .85, depthTest: false });
  for (const x of [-.032, .032]) { const lobe = new THREE.Mesh(new THREE.SphereGeometry(.045, 16, 12), material); lobe.position.set(x, .02, 0); heart.add(lobe); }
  const base = new THREE.Mesh(new THREE.ConeGeometry(.071, .1, 20), material); base.rotation.z = Math.PI; base.position.y = -.035; heart.add(base); group.add(heart);
  const exposure = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CapsuleGeometry(.53, 1.1, 4, 12)), new THREE.LineBasicMaterial({ color: 0xd7a846, transparent: true, opacity: .25 }));
  group.add(exposure);
  const toolbar = document.createElement("div"); toolbar.className = "anatomy-toolbar";
  toolbar.innerHTML = `<div class="anatomy-layers" role="group" aria-label="Human observation layer">${[["body", "Body"], ["movement", "Movement"], ["cardio", "Cardio"], ["exposure", "Exposure"], ["integrated", "Integrated"]].map(([id, label]) => `<button type="button" data-layer="${id}" aria-pressed="${id === "body"}">${label}</button>`).join("")}</div><small id="anatomy-status">Rigged human / estimated external anatomy</small>`;
  document.querySelector("#twin-canvas").parentElement.append(toolbar);
  toolbar.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    layer = button.dataset.layer;
    toolbar.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
  }));
  window.addEventListener("astrobone-health-history", event => { history = event.detail; });
  // Pulse and stress from the face: on request for the live camera, automatically for an uploaded video.
  const panel = document.createElement("section"); panel.className = "pulse-capture"; panel.setAttribute("aria-labelledby", "pulse-title");
  panel.innerHTML = `<div class="pulse-heading"><h4 id="pulse-title">Pulse and stress from the face</h4><button type="button" id="pulse-start" aria-pressed="false">Measure from camera</button></div>
    <div class="pulse-readouts"><div><span>Pulse</span><output id="pulse-value">-- bpm</output></div><div><span>Stress index</span><output id="stress-value">--</output><small id="stress-detail"></small></div></div>
    <p id="pulse-status" role="status">Upload a video with a visible face, or start the camera and press Measure.</p><canvas width="400" height="60" aria-label="Experimental pulse signal" role="img"></canvas>
    <small>Experimental, processed on this device. Needs a close, still face and steady light: pulse after 12 s, stress after 30 s. Stress is Baevsky's index from beat-to-beat timing; compare only with the same person's own readings. No SpO2, diagnosis or medical alerting.</small>`;
  (document.querySelector(".detail-analysis") ?? document.querySelector(".motionguard-capture-details")).after(panel);
  const chip = document.createElement("span"); chip.id = "pose-vitals"; chip.className = "pose-vitals"; chip.hidden = true;
  const strip = document.querySelector(".pose-live-strip");
  strip?.insertBefore(chip, strip.querySelector("#pose-live-fps"));
  const value = panel.querySelector("#pulse-value"), stressValue = panel.querySelector("#stress-value"), stressDetail = panel.querySelector("#stress-detail");
  const status = panel.querySelector("p"), chart = panel.querySelector("canvas"), start = panel.querySelector("button");
  let source = null, cameraMeasuring = false, cameraFrame = 0, cameraToken = 0, lastCameraTime = -1;
  const capture = new PulseCapture({ onResult(result) {
    pulse = { ...result, source, receivedAt: performance.now() };
    const stress = result.stress?.status === "estimated" ? result.stress : null;
    value.textContent = result.bpm ? `${result.bpm} bpm` : "-- bpm";
    stressValue.textContent = stress ? `${stress.stressIndex} · ${stress.level}` : "--";
    stressDetail.textContent = stress ? `RMSSD ${stress.rmssdMs} ms / ${stress.beats} beats` : "";
    const note = result.status === "estimated" ? result.stress?.status === "estimated" ? "Experimental estimate" : result.stress?.reason ?? "" : result.reason;
    status.textContent = `${source === "video" ? "Recorded video" : "Live camera"} / ${note}${result.collectedSeconds && !stress ? ` / ${Math.floor(result.collectedSeconds)} s collected` : ""}`;
    chip.hidden = !result.bpm;
    chip.textContent = result.bpm ? `♥ ${result.bpm} bpm${stress ? ` · stress ${stress.level}` : ""}` : "";
    const ctx = chart.getContext("2d"); ctx.clearRect(0, 0, 400, 60);
    if (result.waveform?.length) {
      const max = Math.max(...result.waveform.map(Math.abs), 1e-6); ctx.strokeStyle = "#d76283"; ctx.beginPath();
      result.waveform.forEach((v, i) => i ? ctx.lineTo(i / (result.waveform.length - 1) * 400, 30 - v / max * 25) : ctx.moveTo(0, 30 - v / max * 25)); ctx.stroke();
    }
  } });
  const useSource = next => { if (source !== next) { source = next; capture.reset(); } };
  const setCameraMeasuring = on => {
    cameraMeasuring = on; cancelAnimationFrame(cameraFrame); cameraToken++; lastCameraTime = -1;
    onCameraMeasuring(on);
    start.textContent = on ? "Stop camera pulse" : "Measure from camera";
    start.setAttribute("aria-pressed", String(on));
    if (on) { useSource("camera"); capture.reset("Hold still, face the camera"); startCameraFrames(); }
    else if (source === "camera") { capture.reset("Pulse capture stopped"); chip.hidden = true; }
  };
  // Live camera: one sample per new camera frame, timed by its capture time where the browser reports
  // it (a camera stream's currentTime runs continuously, so it cannot tell frames apart).
  const sampleCamera = t => {
    const face = getFace(), now = performance.now();
    // The face mesh arrives a few times a second; it locates the skin for up to 1.5 s (a still face
    // barely moves, and the motion gate rejects one that does).
    capture.addFrame(video, face?.face && now - face.timestamp < 1500 ? face.face.landmarks : null, t);
  };
  function startCameraFrames() {
    const token = cameraToken;
    if (typeof video.requestVideoFrameCallback === "function") {
      const step = (now, metadata) => {
        if (token !== cameraToken || !cameraMeasuring) return;
        if (!isLiveCamera()) { setCameraMeasuring(false); return; }
        sampleCamera(Number.isFinite(metadata.captureTime) ? metadata.captureTime : metadata.presentationTime ?? now);
        video.requestVideoFrameCallback(step);
      };
      video.requestVideoFrameCallback(step);
      return;
    }
    const tick = () => {
      if (token !== cameraToken || !cameraMeasuring) return;
      cameraFrame = requestAnimationFrame(tick);
      if (!isLiveCamera()) { setCameraMeasuring(false); return; }
      if (document.hidden || video.paused || video.currentTime === lastCameraTime) return;
      lastCameraTime = video.currentTime;
      sampleCamera(performance.now());
    };
    cameraFrame = requestAnimationFrame(tick);
  }
  start.addEventListener("click", () => {
    if (cameraMeasuring) { setCameraMeasuring(false); return; }
    if (!isLiveCamera()) { status.textContent = "Start the live camera and turn on face and hand tracking first. Uploaded videos are measured automatically."; return; }
    setCameraMeasuring(true);
  });
  // Recorded video: every presented frame, timed by its media time and located by its own face mesh.
  function videoFrame({ video: source, mediaTime, face }) {
    if (cameraMeasuring) return;
    useSource("video");
    capture.addFrame(source, face?.landmarks ?? null, mediaTime * 1000);
  }
  const chest = new THREE.Vector3(), root = new THREE.Vector3();
  const modelMaterials = new Map();
  function update(now) {
    if (!rig.loaded) { group.visible = false; return; }
    if (!rig.group.visible) {
      group.visible = false; if (helper) helper.visible = false;
      toolbar.querySelector("#anatomy-status").textContent = "MHR estimated surface / health overlays available on the browser rig";
      return;
    }
    group.visible = true;
    if (!helper) { helper = new THREE.SkeletonHelper(rig.model); helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = .55; scene.add(helper); }
    const seeInside = layer !== "body";
    rig.model.traverse(child => { if (child.isMesh && child.visible && !child.userData.technicalWire && !child.userData.anatomicalSystem) for (const mat of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!modelMaterials.has(mat)) modelMaterials.set(mat, { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite });
      const original = modelMaterials.get(mat);
      mat.opacity = seeInside ? .24 : original.opacity; mat.transparent = seeInside || original.transparent; mat.depthWrite = seeInside ? false : original.depthWrite;
    } });
    const current = pulse?.status === "estimated" && now - pulse.receivedAt < 5000 ? pulse : null;
    const cardio = layer === "cardio" || layer === "integrated", radiation = layer === "exposure" || layer === "integrated";
    helper.visible = layer === "movement" || layer === "integrated";
    heart.visible = cardio;
    rig.bones.leftArm.getWorldPosition(chest);
    rig.bones.rightArm.getWorldPosition(root);
    heart.position.copy(chest).add(root).multiplyScalar(.5).add(new THREE.Vector3(.09, -.28, .16));
    heart.scale.setScalar(1.8 * (current ? 1 + .12 * Math.max(0, Math.sin(now / 1000 * current.bpm / 60 * Math.PI * 2)) : 1));
    material.opacity = current ? .9 : .25;
    const dose = history?.summary?.series.filter(s => s.system === "exposure").at(-1);
    exposure.visible = radiation && Boolean(dose);
    rig.bones.root.getWorldPosition(root); exposure.position.copy(root); exposure.scale.setScalar(2.2);
    toolbar.querySelector("#anatomy-status").textContent = layer === "body" ? rig.anatomical ? "Articulated atlas / estimated joint motion" : "Rigged surface mesh / not imaged anatomy"
      : layer === "movement" ? "Rig segments, not imaged bones"
        : `${cardio ? current ? `${current.bpm} bpm / experimental ${current.source === "video" ? "video" : "camera"} pulse; ` : "No live pulse; " : ""}${radiation ? dose ? `Exposure record: ${dose.last?.value} ${dose.unit}${history.profile?.is_demo ? " / SYNTHETIC" : ""}; ` : "No exposure record; " : ""}schematic only`;
  }
  // Only a live-camera pulse can be saved as a "now" observation; a recorded video may be old.
  return { update, videoFrame, getPulse: () => (pulse?.source === "camera" ? pulse : null), getVitals: () => pulse };
}
