import * as THREE from "three";
import { PulseCapture } from "./rppg.js";

export function initHealthLayers({ scene, rig, video, getFace, isLiveCamera }) {
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
  const panel = document.createElement("section"); panel.className = "pulse-capture";
  panel.innerHTML = `<h4>Experimental webcam pulse</h4><button type="button" id="pulse-start" aria-pressed="false">Start pulse capture</button><output id="pulse-value">-- bpm</output><p id="pulse-status" role="status">Not measuring</p><canvas width="400" height="60" aria-label="Experimental pulse signal" role="img"></canvas><small>Local camera processing. Requires a close, still face and steady lighting. No SpO2, HRV, diagnosis or medical alerting.</small>`;
  document.querySelector(".motionguard-capture-details").append(panel);
  const value = panel.querySelector("output"), status = panel.querySelector("p"), chart = panel.querySelector("canvas"), start = panel.querySelector("button");
  const capture = new PulseCapture({ video, getFace, isLiveCamera, onResult(result) {
    pulse = { ...result, receivedAt: performance.now() };
    value.textContent = result.bpm ? `${result.bpm} bpm / estimate` : "-- bpm";
    status.textContent = `${result.reason}${result.collectedSeconds && result.status !== "estimated" ? ` / ${Math.floor(result.collectedSeconds)} s` : ""}`;
    const ctx = chart.getContext("2d"); ctx.clearRect(0, 0, 400, 60);
    if (result.waveform?.length) {
      const max = Math.max(...result.waveform.map(Math.abs), 1e-6); ctx.strokeStyle = "#d76283"; ctx.beginPath();
      result.waveform.forEach((v, i) => i ? ctx.lineTo(i / (result.waveform.length - 1) * 400, 30 - v / max * 25) : ctx.moveTo(0, 30 - v / max * 25)); ctx.stroke();
    }
  } });
  start.addEventListener("click", () => {
    if (capture.active) capture.stop();
    else {
      if (!isLiveCamera()) { status.textContent = "Start the live camera and enable hand / face detail tracking first."; return; }
      capture.start();
    }
    start.textContent = capture.active ? "Stop pulse capture" : "Start pulse capture";
    start.setAttribute("aria-pressed", String(capture.active));
  });
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
    const current = pulse?.status === "estimated" && now - pulse.receivedAt < 5000 && isLiveCamera() ? pulse : null;
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
        : `${cardio ? current ? `${current.bpm} bpm / experimental camera pulse; ` : "No live pulse; " : ""}${radiation ? dose ? `Exposure record: ${dose.last?.value} ${dose.unit}${history.profile?.is_demo ? " / SYNTHETIC" : ""}; ` : "No exposure record; " : ""}schematic only`;
  }
  return { update, getPulse: () => pulse };
}
