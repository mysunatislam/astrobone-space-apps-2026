import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCameraMediaConstraints,
  normalizeVideoInputs,
} from "./cameraDevices.js";

test("camera constraints use phone orientation when no hardware device is selected", () => {
  const constraints = buildCameraMediaConstraints({ facingMode: "environment" });
  assert.deepEqual(constraints.video.facingMode, { ideal: "environment" });
  assert.equal(Object.hasOwn(constraints.video, "deviceId"), false);
  assert.deepEqual(constraints.video.width, { ideal: 960 });
});

test("an explicit PC webcam uses an exact device constraint", () => {
  const constraints = buildCameraMediaConstraints({
    deviceId: "usb-camera-2",
    facingMode: "environment",
  });
  assert.deepEqual(constraints.video.deviceId, { exact: "usb-camera-2" });
  assert.equal(Object.hasOwn(constraints.video, "facingMode"), false);
});

test("camera inputs are filtered, labeled, and deduplicated", () => {
  assert.deepEqual(normalizeVideoInputs([
    { kind: "audioinput", deviceId: "mic", label: "Microphone" },
    { kind: "videoinput", deviceId: "cam-a", label: " Integrated Camera " },
    { kind: "videoinput", deviceId: "cam-a", label: "Duplicate" },
    { kind: "videoinput", deviceId: "cam-b", label: "" },
  ]), [
    { deviceId: "cam-a", groupId: "", label: "Integrated Camera" },
    { deviceId: "cam-b", groupId: "", label: "Camera 2" },
  ]);
});
