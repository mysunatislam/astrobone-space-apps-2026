import * as THREE from "three";

export function applyTechnicalHuman(model) {
  const meshes = [];
  model.traverse(node => { if (node.isMesh) meshes.push(node); });
  const body = meshes.find(mesh => mesh.name === "Human_Body");
  if (!body?.isSkinnedMesh) throw new Error("The technical human view requires the rigged body surface.");
  // The source has no torso/leg surface beneath its garments. Keep that geometry
  // as a neutral outer envelope rather than leaving holes in the tracked body.
  const surfaces = meshes.filter(mesh => ["Human_Body", "T_Shirt_And_Jeans", "White_Sneakers", "Eyes"].includes(mesh.name));
  for (const mesh of meshes) mesh.visible = surfaces.includes(mesh);
  const material = new THREE.MeshStandardMaterial({
    color: 0x799b98, roughness: .55, metalness: .18,
    emissive: 0x153f39, emissiveIntensity: .15, fog: false,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const wires = [];
  for (const surface of surfaces) {
    surface.material = material.clone();
    surface.castShadow = false;
    surface.receiveShadow = false;
    if (!surface.isSkinnedMesh) continue;
    // Share geometry and bone matrices so the wire follows the same deformation.
    const wire = new THREE.SkinnedMesh(surface.geometry, new THREE.MeshBasicMaterial({
      color: 0x9ce9dc, wireframe: true, transparent: true, opacity: .07,
      depthWrite: false, fog: false,
    }));
    wire.name = `Technical wire ${surface.name}`;
    wire.userData.technicalWire = true;
    wire.bindMode = surface.bindMode;
    wire.bind(surface.skeleton, surface.bindMatrix);
    wire.morphTargetDictionary = surface.morphTargetDictionary;
    wire.morphTargetInfluences = surface.morphTargetInfluences;
    wire.frustumCulled = false;
    surface.add(wire);
    wires.push(wire);
  }
  material.dispose();
  model.name = "Rigged technical human surface";
  return { body, wire: wires[0], surfaces, wires, hiddenMeshCount: meshes.length - surfaces.length };
}
