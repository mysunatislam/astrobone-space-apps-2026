export function buildCameraMediaConstraints({ deviceId = "", facingMode = "user" } = {}) {
  const normalizedDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";
  const normalizedFacingMode = facingMode === "environment" ? "environment" : "user";
  return {
    audio: false,
    video: {
      ...(normalizedDeviceId
        ? { deviceId: { exact: normalizedDeviceId } }
        : { facingMode: { ideal: normalizedFacingMode } }),
      width: { ideal: 960 },
      height: { ideal: 720 },
    },
  };
}

export function normalizeVideoInputs(devices = []) {
  const seen = new Set();
  return devices
    .filter((device) => device?.kind === "videoinput")
    .filter((device, index) => {
      const key = device.deviceId || `unidentified-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((device, index) => ({
      deviceId: device.deviceId || "",
      groupId: device.groupId || "",
      label: device.label?.trim() || `Camera ${index + 1}`,
    }));
}
