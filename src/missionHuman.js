import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { bindHumanRig } from "./humanRig.js";

// Atlas layers and schematic context only. Aggregates cannot recover a personal pose.
export function createMissionHuman(parent) {
  const canvas = document.createElement("canvas"); canvas.id = parent.id === "mi-human-stage" ? "mi-human-canvas" : "mission-human-canvas";
  canvas.setAttribute("aria-label", "Interactive reference anatomy, not measured organ function"); parent.append(canvas);
  const status = document.createElement("small"); status.className = "mission-human-status"; status.textContent = "Reference anatomy / not loaded"; parent.append(status);
  let renderer, scene, camera, controls, model, outer, context, exposure, helper, active = false, loading = false, disposed = false, current, frame = null, transition = null, outerLoading = false, cardioLoading = false, cardioFailed = false;
  const markers = [], materials = [], point = new THREE.Vector3(), reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  function release(object) {
    const geometries = new Set(), mats = new Set(), textures = new Set(), skeletons = new Set();
    object?.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.skeleton) skeletons.add(child.skeleton); for (const mat of Array.isArray(child.material) ? child.material : [child.material]) if (mat) { mats.add(mat); for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value); } });
    textures.forEach(t => t.dispose()); mats.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); skeletons.forEach(s => s.dispose());
  }
  function draw() {
    if (!active || disposed || !renderer || frame !== null || document.hidden) return;
    frame = requestAnimationFrame(now => {
      frame = null; if (!active || disposed || !renderer) return;
      if (transition) {
        const alpha = Math.min(1, (now - transition.start) / transition.duration), eased = 1 - (1 - alpha) ** 3;
        camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
        controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
        for (const item of materials) item.material.opacity = THREE.MathUtils.lerp(item.from, item.to, eased);
        controls.update(); if (alpha === 1) transition = null;
      }
      renderer.render(scene, camera); canvas.dataset.frames = Number(canvas.dataset.frames || 0) + 1;
      canvas.dataset.drawCalls = renderer.info.render.calls; canvas.dataset.triangles = renderer.info.render.triangles;
      if (transition) draw();
    });
  }
  function fit(animate = false) {
    if (!model || !active) return;
    const chest = current?.system === "cardiovascular", box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); if (chest) center.y += .45;
    const height = chest ? 1.35 : size.y, width = chest ? 1.3 : size.x;
    const distance = Math.max(height, width / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.2 + size.z / 2;
    const position = center.clone().add(new THREE.Vector3(.10 * distance, 0, distance));
    if (animate && !reduceMotion.matches) transition = { start: performance.now(), duration: 550, fromPosition: camera.position.clone(), toPosition: position, fromTarget: controls.target.clone(), toTarget: center };
    else { transition = null; controls.target.copy(center); camera.position.copy(position); for (const item of materials) item.material.opacity = item.to; controls.update(); }
    draw();
  }
  function resize() {
    if (!renderer || !active) return; const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); fit();
  }
  function normalize(object) {
    const box = new THREE.Box3().setFromObject(object), height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) throw new Error("Invalid reference bounds");
    object.scale.setScalar(2.5 / height); object.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-2.5 / height);
  }
  function recolor(object, callback) {
    const discarded = new Set(), textures = new Set();
    object.traverse(mesh => { if (!mesh.isMesh) return; for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (mat) { discarded.add(mat); for (const v of Object.values(mat)) if (v?.isTexture) textures.add(v); }
      mesh.material = callback(mesh); mesh.frustumCulled = false;
    }); discarded.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  }
  async function loadOuter() {
    if (outer || outerLoading || disposed) return; outerLoading = true;
    try {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/human_body_clothed.glb`);
      if (disposed) { release(gltf.scene); return; }
      outer = gltf.scene; normalize(outer); recolor(outer, () => new THREE.MeshStandardMaterial({ color: 0x9ab7bb, roughness: .7, metalness: .1, wireframe: true })); scene.add(outer); update(current);
    } catch { if (!disposed) status.textContent = "Surface reference unavailable; anatomical atlas retained."; }
    finally { outerLoading = false; }
  }
  function makeContext() {
    context = new THREE.Group(); context.name = "Z-Anatomy cardiovascular reference"; scene.add(context);
    exposure = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CapsuleGeometry(.63, 1.4, 4, 18)), new THREE.LineBasicMaterial({ color: 0xe2ba71, transparent: true, opacity: .28 }));
    exposure.name = "Schematic exposure envelope / not dose distribution"; scene.add(exposure);
  }
  async function loadCardiovascular() {
    if (cardioLoading || context.children.length || cardioFailed || disposed) return;
    cardioLoading = true;
    try {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/anatomy/cardiovascular.glb`);
      if (disposed) { release(gltf.scene); return; }
      // Both atlas assets retain the same source frame. Independent fitting would misalign organs.
      gltf.scene.scale.copy(model.scale); gltf.scene.position.copy(model.position);
      const colors = { heart: 0xbf6778, arteries: 0xdc7564, veins: 0x628ecb, renal: 0x9c81c4, pulmonary: 0x7cadd2, major: 0xc6979e, other: 0xcda1b1 };
      recolor(gltf.scene, mesh => new THREE.MeshStandardMaterial({ color: colors[mesh.name] || 0xcda1b1, roughness: .55, metalness: .02 }));
      context.add(gltf.scene); canvas.dataset.cardioReady = "true"; update(current);
    } catch { cardioFailed = true; canvas.dataset.cardioReady = "false"; update(current); }
    finally { cardioLoading = false; }
  }
  function update(value) {
    const changed = current?.system !== value?.system; current = value; if (!model) return;
    const system = value?.system || "multisystem", cardio = ["cardiovascular", "multisystem"].includes(system), radiation = ["radiation", "multisystem"].includes(system);
    if (system === "outer" && !outer) void loadOuter(); if (outer) outer.visible = system === "outer"; model.visible = system !== "outer" || !outer;
    for (const item of materials) {
      const muscle = item.muscle; item.from = item.material.opacity;
      item.to = muscle ? system === "muscular" ? .9 : system === "multisystem" ? .12 : 0 : system === "muscular" ? .13 : system === "cardiovascular" ? .09 : .92;
      item.material.depthWrite = !muscle && system !== "cardiovascular";
      item.mesh.visible = item.to > 0; if (!changed || reduceMotion.matches) item.material.opacity = item.to;
    }
    context.visible = cardio; if (cardio) void loadCardiovascular(); exposure.visible = radiation; exposure.material.opacity = value?.event ? .65 : .20; helper.visible = system === "movement";
    model.updateMatrixWorld(true); markers.forEach(({ mesh, bone }) => { bone.getWorldPosition(point); mesh.position.copy(point); mesh.visible = ["movement", "multisystem"].includes(system) && value?.status === "change_observed"; });
    status.textContent = system === "outer" ? "Surface reference / generic clothed mesh, not reconstructed skin" : system === "cardiovascular" ? cardioFailed ? "Cardiovascular atlas unavailable / no substitute anatomy" : !context.children.length ? "Loading cardiovascular atlas..." : "Z-Anatomy / color-coded vessel groups / static reference, not measured flow"
      : system === "radiation" ? "Exposure context envelope / no spatial dose or tissue damage model" : system === "movement" ? "Reference rig and reviewed knee regions / not recorded pose replay"
        : system === "multisystem" ? "Anatomical atlas + exposure context / no personal tissue measurements" : "Z-Anatomy reference atlas / no personal tissue measurements";
    canvas.dataset.layer = system; if (changed) fit(true); else draw();
  }
  async function load() {
    if (model || loading || disposed) return; loading = true; status.textContent = "Loading reference anatomy...";
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setClearColor(0x10191d);
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(36, 1, .01, 100); scene.add(new THREE.HemisphereLight(0xe7f2ee, 0x536371, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(3, 4, 5); scene.add(key);
      const rim = new THREE.DirectionalLight(0x91e1d2, 1.6); rim.position.set(-3, 2, -3); scene.add(rim);
      controls = new OrbitControls(camera, canvas); controls.enablePan = false; controls.minDistance = 1.4; controls.maxDistance = 10; controls.addEventListener("change", draw); controls.addEventListener("start", () => { transition = null; });
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/anatomy/musculoskeletal-rigged.glb`); if (disposed) { release(gltf.scene); return; }
      model = gltf.scene;
      recolor(model, mesh => { const muscle = mesh.userData.anatomicalSystem === "muscles";
        const material = new THREE.MeshStandardMaterial({ color: muscle ? 0xb97883 : 0xd9e7db, roughness: .64, metalness: .03, transparent: true, opacity: muscle ? .22 : .92, depthWrite: !muscle });
        materials.push({ mesh, muscle, material, from: material.opacity, to: material.opacity }); return material;
      }); normalize(model); scene.add(model);
      const binding = bindHumanRig(model);
      for (const bone of [binding.bones.leftLeg, binding.bones.rightLeg].filter(Boolean)) { const mesh = new THREE.Mesh(new THREE.TorusGeometry(.078, .006, 8, 28), new THREE.MeshBasicMaterial({ color: 0x69dfd0, depthTest: false })); mesh.renderOrder = 10; scene.add(mesh); markers.push({ mesh, bone }); }
      helper = new THREE.SkeletonHelper(model); helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = .48; scene.add(helper);
      makeContext(); canvas.dataset.ready = "true"; resize(); update(current);
    } catch (error) { if (!disposed) { status.textContent = "3D reference unavailable. Mission review and evidence remain usable."; canvas.dataset.error = error.message; release(scene); renderer?.dispose(); renderer = null; } }
    finally { loading = false; }
  }
  const observer = new ResizeObserver(resize); observer.observe(parent);
  const visibility = () => { if (document.hidden) { if (frame !== null) cancelAnimationFrame(frame); frame = null; transition = null; } else draw(); }; document.addEventListener("visibilitychange", visibility);
  return { update, resetView() { fit(); }, setActive(value) { active = value; if (active) { void load(); resize(); draw(); } else { if (frame !== null) cancelAnimationFrame(frame); frame = null; transition = null; } },
    dispose() { disposed = true; active = false; if (frame !== null) cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); controls?.dispose(); release(scene); renderer?.dispose(); canvas.remove(); status.remove(); } };
}
