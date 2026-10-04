import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyTechnicalHuman } from "./technicalHuman.js";
import { bindHumanRig } from "./humanRig.js";

test("technical human preserves a complete outer envelope and shares each surface's rig", async () => {
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1 });
  const bytes = await readFile(new URL("../public/models/human_body_clothed.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const { body, wire, surfaces, wires, hiddenMeshCount } = applyTechnicalHuman(gltf.scene);
  assert.equal(hiddenMeshCount, 3);
  assert.equal(surfaces.length, 4);
  assert.equal(wires.length, 4);
  assert.equal(body.material.map, null);
  assert.equal(wire.geometry, body.geometry);
  assert.equal(wire.skeleton, body.skeleton);
  assert.equal(wire.material.wireframe, true);
  assert.equal(gltf.scene.getObjectByName("T_Shirt_And_Jeans").visible, true);
  assert.ok(surfaces.every(mesh => mesh.material.map === null));
  assert.equal(gltf.scene.getObjectByName("Short_Brown_Hair").visible, false);
  bindHumanRig(gltf.scene).bones.leftArm.rotation.z += .6;
  gltf.scene.updateMatrixWorld(true);
  for (let i = 0; i < body.geometry.attributes.position.count; i += 317) {
    const solid = body.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(body.matrixWorld);
    const line = wire.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(wire.matrixWorld);
    assert.ok(solid.distanceTo(line) < 1e-6, "wire must deform exactly with its base surface");
  }
});

test("technical human rejects an unrigged surface instead of presenting a static wire model", () => {
  assert.throws(() => applyTechnicalHuman(new THREE.Group()), /rigged body/);
});
