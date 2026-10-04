import * as THREE from "three";
import { anatomicalCoverage } from "./anatomicalCoverage.js";
import "./anatomicalMotion.css";

export function initAnatomicalMotion({ rig, getFrame, isTracking, isPaused = () => false }) {
  const toolbar = document.createElement("div"); toolbar.className = "anatomical-motion"; toolbar.hidden = true;
  toolbar.innerHTML = `<div class="anatomical-switches"><label><input id="motion-bones" type="checkbox" checked> Bones</label><label><input id="motion-muscles" type="checkbox" checked> Muscles</label><label><input id="motion-wire" type="checkbox"> Mesh lines</label><a href="${import.meta.env.BASE_URL}models/anatomy/musculoskeletal-rigged.glb" download="AstroBone-anatomical-rig.glb" title="Download the articulated reference GLB">GLB</a></div>
    <label class="anatomical-opacity">Muscle opacity<input id="motion-muscle-opacity" type="range" min=".1" max="1" step=".05" value=".85"></label>
    <output id="anatomical-coverage" aria-live="off">Reference pose</output><small>Muscle activation: not measured. Bone and muscle motion: reference coupling.</small>`;
  document.querySelector(".anatomy-toolbar").prepend(toolbar);
  const $ = id => toolbar.querySelector(`#${id}`);
  const surfaces = [], wires = [];
  let initialized = false, lastReport = -Infinity;
  function initialize() {
    rig.model.traverse(node => { if (node.isSkinnedMesh && node.userData.anatomicalSystem) surfaces.push(node); });
    for (const surface of surfaces) {
      surface.frustumCulled = false;
      const wire = new THREE.SkinnedMesh(surface.geometry, new THREE.MeshBasicMaterial({ color: 0xd3eee5, wireframe: true, transparent: true, opacity: .08, depthWrite: false }));
      wire.bindMode = surface.bindMode; wire.bind(surface.skeleton, surface.bindMatrix); wire.frustumCulled = false;
      wire.userData.technicalWire = true; wire.visible = false; surface.add(wire); wires.push(wire);
    }
    initialized = true;
  }
  function update(now) {
    if (!rig.loaded || !rig.anatomical) return;
    if (!initialized) initialize();
    toolbar.hidden = !rig.group.visible;
    const opacity = Number($("motion-muscle-opacity").value);
    for (let i = 0; i < surfaces.length; i++) {
      const mesh = surfaces[i], muscular = mesh.userData.anatomicalSystem === "muscles";
      mesh.visible = $(muscular ? "motion-muscles" : "motion-bones").checked;
      mesh.material.opacity = muscular ? opacity : 1; mesh.material.transparent = muscular && opacity < 1;
      mesh.material.depthWrite = !muscular || opacity === 1;
      wires[i].visible = $("motion-wire").checked;
    }
    if (now - lastReport < 250) return;
    lastReport = now;
    const frame = getFrame(), paused = isPaused();
    const coverage = anatomicalCoverage(frame, paused ? frame.timestamp : now, isTracking());
    toolbar.dataset.state = paused ? "paused" : coverage.state;
    const state = paused ? "Paused video / recorded pose" : { reference: "Reference pose", held: "Tracking lost / held", live: "Tracking", partial: "Partial tracking" }[coverage.state];
    const observed = paused ? "recorded" : "tracked";
    const kneeState = side => coverage.observed.includes(`${side}Leg`) ? observed : coverage.state === "reference" ? "--" : "held";
    const footState = side => coverage.observed.includes(`${side}Foot`) ? observed : "fixed";
    $("anatomical-coverage").textContent = `${state} | body ${coverage.body}/${coverage.bodyTotal} | fingers ${coverage.fingers}/${coverage.fingerTotal} | jaw ${coverage.jaw ? "cue" : "--"} | knees L ${kneeState("left")} / R ${kneeState("right")}`;
    $("anatomical-coverage").textContent += ` | feet L ${footState("left")} / R ${footState("right")}`;
    toolbar.title = `${rig.anatomical.skeletalStructures} skeletal and ${rig.anatomical.muscularStructures} muscular reference structures. ${rig.anatomical.joints} rig joints. No individual muscle activation or internal bone motion measurement.`;
  }
  return { update };
}
