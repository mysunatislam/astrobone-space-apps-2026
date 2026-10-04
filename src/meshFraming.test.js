import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { meshCameraFrame } from "./meshFraming.js";

for (const [width, height] of [[436, 560], [366, 356], [720, 560]]) {
  test(`mesh fits clear viewer area at ${width}x${height}`, () => {
    for (const size of [{ x: 2, y: 4.1, z: 1 }, { x: 5, y: 3, z: 1.8 }]) {
      const frame = meshCameraFrame(size, width, height, 42);
      const camera = new THREE.PerspectiveCamera(42, width / height, .1, 100);
      camera.position.set(0, frame.targetY, frame.distance);
      camera.lookAt(0, frame.targetY, 0); camera.updateMatrixWorld();
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        const p = new THREE.Vector3(x * size.x / 2, y * size.y / 2, z * size.z / 2).project(camera);
        const screenX = (p.x + 1) * width / 2, screenY = (1 - p.y) * height / 2;
        assert.ok(screenX >= 24 && screenX <= width - 24);
        assert.ok(screenY >= 100 && screenY <= height - 88);
      }
    }
  });
}
