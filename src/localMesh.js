import * as THREE from "three";
import { OneEuroVector } from "./oneEuro.js";
import { meshCameraFrame } from "./meshFraming.js";
import "./multisystem.css";

const API = "http://127.0.0.1:8011";
export function initLocalMesh({ scene, rig, video, isActive, getMirror, camera, controls, renderCanvas }) {
  const panel = document.createElement("section"); panel.className = "local-mesh-panel";
  panel.innerHTML = `<h4>Local 3D reconstruction</h4><label>Vision pipeline<select id="mesh-pipeline"><option value="B">RTMW 133 + InstantHMR + MHR</option><option value="A">InstantHMR + MHR</option></select></label><label class="mesh-consent"><input type="checkbox" id="mesh-consent" /> Send frames to the private service on this computer. No frames are stored.</label><div class="companion-actions"><button type="button" id="mesh-start">Connect mesh engine</button><button type="button" id="mesh-stop" disabled>Stop</button></div><p id="mesh-status" role="status">Browser human rig active. Local models not connected.</p><small>Uncalibrated external body estimate. SAM 3D Body reference pass is not installed. MediaPipe remains the movement-assessment source.</small>`;
  document.querySelector(".motionguard-capture-details").append(panel);
  const $ = id => panel.querySelector(`#${id}`), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  const overlay = document.createElement("canvas"); overlay.className = "local-wholebody-overlay"; overlay.hidden = true; video.parentElement.append(overlay);
  const overlayContext = overlay.getContext("2d"), badge = document.querySelector(".twin-source-badge");
  const geometry = new THREE.BufferGeometry(), material = new THREE.MeshStandardMaterial({ color: 0xa6cfca, roughness: .62, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = "Estimated MHR surface"; mesh.visible = false; scene.add(mesh);
  const filter = new OneEuroVector();
  let active = false, initializing = false, generation = 0, lastResult = 0, timer, abort, fitted = false;
  const extent = new THREE.Vector3();
  function fitView() {
    const { distance, targetY } = meshCameraFrame(extent, Math.max(1, renderCanvas.clientWidth), Math.max(1, renderCanvas.clientHeight), camera.fov);
    controls.target.set(0, targetY, 0); camera.position.set(0, targetY, distance); camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    renderCanvas.dataset.meshFrame = JSON.stringify({ extent: extent.toArray(), position: mesh.position.toArray(), camera: camera.position.toArray(), aspect: camera.aspect, width: renderCanvas.clientWidth, height: renderCanvas.clientHeight });
  }
  async function request(path, options = {}) {
    const timeout = path.startsWith("/frame") ? (lastResult ? 15000 : 60000) : 120000;
    const response = await fetch(API + path, { ...options, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) });
    const data = await response.json(); if (!response.ok) throw new Error(data.detail || `Local service error ${response.status}`); return data;
  }
  function stop(reason = "Local reconstruction stopped. Browser human rig active.") {
    active = false; initializing = false; generation++; clearTimeout(timer); abort?.abort(); filter.reset(); fitted = false; lastResult = 0;
    mesh.visible = false; rig.group.visible = true; $("mesh-start").disabled = false; $("mesh-stop").disabled = true; $("mesh-pipeline").disabled = false;
    overlay.hidden = true; badge.textContent = rig.anatomical ? "Anatomical rig" : "Rigged human GLB";
    $("mesh-status").textContent = reason;
  }
  async function frame(version) {
    if (!active || version !== generation) return;
    if (!isActive() || video.paused || document.hidden || document.querySelector(".workspace").hidden || video.readyState < 2) {
      mesh.visible = false; rig.group.visible = true; lastResult = 0; filter.reset();
      overlay.hidden = true; badge.textContent = rig.anatomical ? "Anatomical rig" : "Rigged human GLB";
      $("mesh-status").textContent = "Waiting for active camera or video. No reconstruction available.";
      timer = setTimeout(() => frame(version), 300); return;
    }
    try {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .8));
      if (!blob || !active || version !== generation) return;
      const started = performance.now(), data = await request(`/frame?pipeline=${$("mesh-pipeline").value}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!active || version !== generation) return;
      if (!isActive() || video.paused) { timer = setTimeout(() => frame(version), 100); return; }
      if (data.status !== "estimated" || !data.vertices) {
        mesh.visible = false; rig.group.visible = true; filter.reset();
        overlay.hidden = true; badge.textContent = rig.anatomical ? "Anatomical rig" : "Rigged human GLB";
        $("mesh-status").textContent = data.reason || "No mesh output. Browser human rig remains active.";
      } else {
        const flat = data.vertices.flat();
        if (flat.length < 900 || flat.length > 60000 || !data.faces?.length) throw new Error("Unexpected MHR geometry dimensions");
        const values = filter.update(flat, performance.now()); if (!values) throw new Error("Invalid mesh coordinates");
        // Vision Y-down/Z-forward -> Three.js Y-up/Z-back. Viewer scale is illustrative, not anthropometry.
        for (let i = 0; i < values.length; i += 3) { values[i + 1] *= -1; values[i + 2] *= -1; }
        if (geometry.getAttribute("position")?.count !== values.length / 3) {
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3)); geometry.setIndex(data.faces.flat());
        } else { geometry.getAttribute("position").array.set(values); geometry.getAttribute("position").needsUpdate = true; }
        geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const size = geometry.boundingBox.getSize(new THREE.Vector3()), center = geometry.boundingBox.getCenter(new THREE.Vector3());
        if (!fitted) {
          if (!(size.y > .3 && size.y < 3)) throw new Error("Estimated body extent outside the rendering envelope");
          mesh.scale.setScalar(4.1 / size.y); fitted = true;
        }
        extent.copy(size).multiplyScalar(mesh.scale.y);
        mesh.position.copy(center).multiplyScalar(-mesh.scale.y);
        mesh.scale.x = getMirror() ? -Math.abs(mesh.scale.y) : Math.abs(mesh.scale.y);
        mesh.position.x = -center.x * mesh.scale.x;
        lastResult = performance.now(); mesh.visible = true; rig.group.visible = false;
        fitView();
        renderCanvas.style.transform = "";
        badge.textContent = "Estimated MHR LOD3";
        overlay.width = canvas.width; overlay.height = canvas.height;
        overlay.style.transform = getMirror() ? "scaleX(-1)" : "";
        overlay.hidden = !data.wholebody_2d;
        if (data.wholebody_2d) {
          data.wholebody_2d.forEach(([x, y], index) => {
            if (data.wholebody_confidence[index] < .4) return;
            overlayContext.fillStyle = index >= 91 ? "#f9c769" : index >= 23 ? "#f5a0ba" : "#5aedcb";
            overlayContext.beginPath(); overlayContext.arc(x, y, index < 23 ? 3 : 1.6, 0, Math.PI * 2); overlayContext.fill();
          });
        }
        const count = data.wholebody_2d?.length || 0;
        $("mesh-status").textContent = `MHR ${values.length / 3} vertices / ${count || 70} ${count ? "2D landmarks + 70 3D joints" : "3D joints"} / ${data.provider} / ${Math.round(performance.now() - started)} ms round trip`;
      }
      timer = setTimeout(() => frame(version), 200);
    } catch (error) { if (active && version === generation) stop(`Local mesh unavailable: ${error.message}. Browser human rig retained.`); }
  }
  $("mesh-start").addEventListener("click", async () => {
    if (active || initializing) return;
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) { $("mesh-status").textContent = "The local desktop mesh service is available only from localhost. Browser tracking remains available on phones."; return; }
    if (!$("mesh-consent").checked) { $("mesh-status").textContent = "Consent is required before sending camera frames to the local service."; return; }
    initializing = true; const version = ++generation; abort = new AbortController();
    $("mesh-start").disabled = true; $("mesh-stop").disabled = false; $("mesh-pipeline").disabled = true;
    $("mesh-status").textContent = "Loading local reconstruction models...";
    const timeout = setTimeout(() => { if (version === generation) stop("Model initialization timed out. Check the local vision service."); }, 120000);
    try {
      const data = await request("/initialize", { method: "POST" });
      if (version !== generation) return;
      if (!data.ready || data.mesh === "unavailable") throw new Error(data.mesh_error || "MHR decoder unavailable");
      initializing = false; active = true;
      $("mesh-status").textContent = "Models loaded. Waiting for the first reconstruction; GPU warmup may take up to 60 seconds.";
      void frame(version);
    } catch (error) { if (version === generation) stop(`Start scripts/start-local-vision.ps1 first. ${error.message}`); }
    finally { clearTimeout(timeout); }
  });
  $("mesh-stop").addEventListener("click", () => stop());
  $("mesh-consent").addEventListener("change", () => { if (!$("mesh-consent").checked) stop("Consent withdrawn. Local frame transfer stopped."); });
  window.addEventListener("beforeunload", () => stop());
  return { update(now) {
    if (lastResult && now - lastResult > 2000) { mesh.visible = false; rig.group.visible = true; overlay.hidden = true; badge.textContent = rig.anatomical ? "Anatomical rig" : "Rigged human GLB / stale mesh"; }
    if (mesh.visible) fitView();
  }, isShowing: () => mesh.visible, stop };
}
