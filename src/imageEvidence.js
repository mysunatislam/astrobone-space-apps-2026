const IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

export function validateXrayFile(file) {
  if (!file) throw new Error("Choose an X-ray image first.");
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error("The selected image is empty.");
  if (file.size > 15 * 1024 * 1024) throw new Error("The image exceeds the 15 MB local-analysis limit.");
  return file;
}

export function validateImageEvidence(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Image evidence must be a JSON object.");
  if (payload.schemaVersion !== "astrobone-image-evidence-v3") {
    throw new Error("The inference service returned an unsupported evidence schema.");
  }
  validateFraction(payload.fractureScore, "fractureScore");
  validateFraction(payload.maskAreaFraction, "maskAreaFraction");
  if (payload.calibratedProbability !== false) {
    throw new Error("Image evidence must not label the research score as a calibrated probability.");
  }
  if (payload.retained !== false) {
    throw new Error("The inference service must confirm that the uploaded image was not retained.");
  }
  if (typeof payload.fractureDetected !== "boolean") throw new Error("fractureDetected must be boolean.");
  if (typeof payload.overlayDataUrl !== "string" || !payload.overlayDataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("The inference service did not return an in-memory PNG overlay.");
  }
  if (!payload.model?.classifier || !payload.model?.segmenter) {
    throw new Error("Image evidence is missing model provenance.");
  }
  return payload;
}

function validateFraction(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite value from 0 to 1.`);
  }
}
