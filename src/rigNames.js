export function matchesRigBoneName(name, pattern) {
  // GLTFLoader sanitizes "mixamorig:Spine" to "mixamorigSpine".
  const canonical = String(name || "").replace(/^mixamorig:?/i, "");
  return pattern.test(canonical);
}
