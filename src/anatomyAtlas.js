import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { anatomyDisplayName } from "./anatomyMetadata.js";
import "./anatomyAtlas.css";

export function initAnatomyAtlas({ stopCapture, onViewChange }) {
  const motion = document.querySelector("#twin-view-grid");
  const shell = document.querySelector(".simulation-shell");
  const tabs = document.createElement("div"); tabs.className = "anatomy-view-tabs";
  tabs.innerHTML = '<div role="tablist" aria-label="3D workspace"><button id="motion-view-tab" role="tab" aria-selected="true" aria-controls="twin-view-grid">Motion capture</button><button id="anatomy-view-tab" role="tab" aria-selected="false" aria-controls="anatomy-atlas">Anatomy atlas</button></div><span>Movement estimates and reference anatomy are separate</span>';
  motion.before(tabs);
  const panel = document.createElement("section"); panel.id = "anatomy-atlas"; panel.hidden = true;
  panel.innerHTML = `<header class="atlas-heading"><div><span class="section-label">Musculoskeletal reference</span><h3>Human anatomy</h3></div><span class="atlas-reference-badge">Reference / not live</span></header>
    <div class="atlas-workspace"><div class="atlas-stage"><canvas id="atlas-canvas" aria-label="Interactive anatomical bones and muscles"></canvas><p id="atlas-load-status" role="status">Not loaded</p></div>
    <aside class="atlas-controls"><fieldset><legend>Systems</legend><label><input id="atlas-bones" type="checkbox" checked> Bones <output id="atlas-bone-count"></output></label><label><input id="atlas-muscles" type="checkbox" checked> Muscles <output id="atlas-muscle-count"></output></label></fieldset>
    <label>Muscle opacity <input id="atlas-opacity" type="range" min="0.08" max="1" step="0.01" value="1"></label>
    <label class="atlas-check"><input id="atlas-wire" type="checkbox"> Mesh lines</label>
    <label>Find a structure<input id="atlas-search" type="search" placeholder="Femur, deltoid, tibia..." autocomplete="off"></label>
    <select id="atlas-structures" size="7" aria-label="Anatomical structures"></select>
    <output id="atlas-selection">No structure selected</output>
    <div class="atlas-actions"><button id="atlas-focus" type="button" disabled>Focus structure</button><button id="atlas-reset" type="button">Full body</button></div>
    <small>Static atlas geometry. Not registered to the camera or to an individual's anatomy. Muscle activation and internal loads are not measured.</small></aside></div>
    <footer><span id="atlas-summary">Skeletal and muscular systems</span><a id="atlas-download" download="AstroBone-musculoskeletal-reference.glb">Download GLB</a><a href="https://github.com/LluisV/Z-Anatomy" target="_blank" rel="noopener noreferrer">Z-Anatomy / BodyParts3D</a><a id="atlas-license" target="_blank" rel="noopener noreferrer">CC BY-SA attribution</a></footer>`;
  motion.after(panel);
  const $ = id => panel.querySelector(`#${id}`);
  const asset = name => `${import.meta.env.BASE_URL}models/anatomy/${name}`;
  $("atlas-download").href = asset("musculoskeletal.glb");
  $("atlas-license").href = asset("SOURCE-LICENSE.txt");
  let renderer, scene, camera, controls, model, selected, loading = false, queued = false;
  const structures = [], materials = new Set();
  let active = false;
  function requestRender() {
    if (!active || !renderer || queued) return;
    queued = true; requestAnimationFrame(() => { queued = false; if (active) renderer.render(scene, camera); });
  }
  function resize() {
    if (!renderer || !active) return;
    const rect = $("atlas-canvas").getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height); camera.updateProjectionMatrix(); requestRender();
  }
  function fit(object = model) {
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(size.y / 2 / tangent, size.x / 2 / tangent / camera.aspect) * 1.16 + size.z / 2;
    controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(0, 0, Math.max(.1, distance))); camera.lookAt(center);
    controls.update(); requestRender();
  }
  const displayName = mesh => anatomyDisplayName(mesh.userData.anatomyName || mesh.name);
  function updateList() {
    const query = $("atlas-search").value.toLowerCase();
    $("atlas-structures").replaceChildren();
    for (const mesh of structures.filter(m => m.visible && displayName(m).toLowerCase().includes(query))) {
      const option = document.createElement("option"); option.value = mesh.userData.anatomyId; option.textContent = displayName(mesh);
      option.selected = mesh === selected; $("atlas-structures").append(option);
    }
  }
  function select(mesh) {
    if (selected) selected.material.emissive.setHex(0);
    selected = mesh;
    if (selected) selected.material.emissive.setHex(0x315c51);
    $("atlas-selection").textContent = selected ? `${displayName(selected)} / ${selected.userData.system}` : "No structure selected";
    $("atlas-focus").disabled = !selected;
    $("atlas-structures").value = selected?.userData.anatomyId ?? ""; requestRender();
  }
  function updateVisibility() {
    for (const mesh of structures) {
      mesh.visible = $(mesh.userData.system === "bones" ? "atlas-bones" : "atlas-muscles").checked;
      const opacity = mesh.userData.system === "muscles" ? Number($("atlas-opacity").value) : 1;
      mesh.material.opacity = opacity; mesh.material.transparent = opacity < 1; mesh.material.depthWrite = opacity === 1;
      mesh.material.wireframe = $("atlas-wire").checked;
    }
    if (selected && !selected.visible) select(null);
    updateList(); requestRender();
  }
  async function load() {
    if (model || loading) return;
    loading = true; $("atlas-load-status").textContent = "Loading anatomical reference...";
    try {
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas: $("atlas-canvas"), antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setClearColor(0x101b1e);
        scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(42, 1, .01, 100);
        scene.add(new THREE.HemisphereLight(0xe6f1f3, 0x526264, 2));
        const key = new THREE.DirectionalLight(0xfff3dd, 2.5); key.position.set(4, 7, 8); scene.add(key);
        const rim = new THREE.DirectionalLight(0x98dfd8, 1.5); rim.position.set(-5, 3, -5); scene.add(rim);
        controls = new OrbitControls(camera, $("atlas-canvas")); controls.addEventListener("change", requestRender);
        controls.minDistance = .15; controls.maxDistance = 15;
        new ResizeObserver(resize).observe($("atlas-canvas"));
        const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down;
        $("atlas-canvas").addEventListener("pointerdown", event => { down = [event.clientX, event.clientY]; });
        $("atlas-canvas").addEventListener("pointerup", event => {
          if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
          const rect = $("atlas-canvas").getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
          raycaster.setFromCamera(pointer, camera); select(raycaster.intersectObjects(structures.filter(m => m.visible), false)[0]?.object ?? null);
        });
      }
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(asset("musculoskeletal.glb"), progress => {
        $("atlas-load-status").textContent = `Loading anatomical reference / ${(progress.loaded / 1048576).toFixed(1)} MB`;
      });
      model = gltf.scene;
      const sourceMeshes = []; model.updateMatrixWorld(true);
      model.traverse(node => { if (node.isMesh && node.userData.anatomyId) sourceMeshes.push(node); });
      for (const mesh of sourceMeshes) {
        model.attach(mesh); mesh.material = mesh.material.clone(); mesh.material.fog = false;
        materials.add(mesh.material); structures.push(mesh);
      }
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const scale = 4.35 / size.y; model.scale.setScalar(scale); model.position.copy(center).multiplyScalar(-scale); scene.add(model);
      structures.sort((a, b) => displayName(a).localeCompare(displayName(b)));
      for (const [system, id] of [["bones", "atlas-bone-count"], ["muscles", "atlas-muscle-count"]]) $(id).textContent = structures.filter(m => m.userData.system === system).length;
      $("atlas-summary").textContent = `${structures.length} named mesh structures / skeletal + muscular systems`;
      $("atlas-load-status").textContent = "Reference atlas ready";
      $("atlas-canvas").dataset.ready = "true";
      updateVisibility(); resize(); fit();
    } catch (error) {
      $("atlas-load-status").textContent = `Anatomy unavailable: ${error.message}. Reopen this tab to retry.`;
    } finally { loading = false; }
  }
  function show(atlas) {
    active = atlas; shell.classList.toggle("atlas-active", atlas); panel.hidden = !atlas;
    tabs.querySelector("#motion-view-tab").setAttribute("aria-selected", String(!atlas));
    tabs.querySelector("#anatomy-view-tab").setAttribute("aria-selected", String(atlas));
    if (atlas) { stopCapture(); void load(); resize(); requestRender(); }
    onViewChange();
  }
  tabs.querySelector("#motion-view-tab").onclick = () => show(false);
  tabs.querySelector("#anatomy-view-tab").onclick = () => show(true);
  for (const id of ["atlas-bones", "atlas-muscles", "atlas-opacity", "atlas-wire"]) $(id).addEventListener("input", updateVisibility);
  $("atlas-search").addEventListener("input", updateList);
  $("atlas-structures").addEventListener("change", () => select(structures.find(m => m.userData.anatomyId === $("atlas-structures").value)));
  $("atlas-focus").onclick = () => fit(selected);
  $("atlas-reset").onclick = () => { select(null); fit(); };
  for (const id of ["source-live", "source-video"]) document.querySelector(`#${id}`).addEventListener("click", () => show(false), { capture: true });
  return { isActive: () => active };
}
