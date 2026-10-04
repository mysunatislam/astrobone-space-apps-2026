import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const ordinals = ["first", "second", "third", "fourth", "fifth"];
const v = coordinates => new THREE.Vector3(...coordinates);

// Reference-atlas kinematics, not subject-specific joint centers or muscle mechanics.
export function rigAnatomicalAtlas(atlas) {
  atlas.updateMatrixWorld(true);
  const surfaces = [];
  atlas.traverse(node => {
    if (!node.isMesh || !["bones", "muscles"].includes(node.userData.system)) return;
    const geometry = node.geometry.clone();
    // Meshopt stores normalized integer attributes. Convert before baking world
    // transforms; writing atlas coordinates into those attributes would clip them.
    for (const key of ["position", "normal"]) {
      const attribute = geometry.attributes[key];
      if (!attribute) continue;
      const values = new Float32Array(attribute.count * 3);
      for (let i = 0; i < attribute.count; i++) {
        values[i * 3] = attribute.getX(i); values[i * 3 + 1] = attribute.getY(i); values[i * 3 + 2] = attribute.getZ(i);
      }
      geometry.setAttribute(key, new THREE.BufferAttribute(values, 3));
    }
    geometry.applyMatrix4(node.matrixWorld);
    for (const key of Object.keys(geometry.attributes)) if (!["position", "normal"].includes(key)) geometry.deleteAttribute(key);
    geometry.computeBoundingBox();
    surfaces.push({ name: node.userData.anatomyName || node.name, system: node.userData.system, geometry, center: geometry.boundingBox.getCenter(new THREE.Vector3()) });
  });
  if (surfaces.length < 900) throw new Error("The complete musculoskeletal reference atlas is required");
  const byName = new Map(surfaces.map(surface => [surface.name.toLowerCase(), surface]));
  const model = new THREE.Group(); model.name = "Articulated musculoskeletal reference";
  const bones = [], joints = new Map(), positions = new Map();
  function add(name, parent, point) {
    const bone = new THREE.Bone(); bone.name = name;
    positions.set(name, v(point));
    bone.position.copy(positions.get(name));
    if (parent) { bone.position.sub(positions.get(parent)); joints.get(parent).add(bone); }
    else model.add(bone);
    joints.set(name, bone); bones.push(bone);
  }
  add("root", null, [0, 86, -2]);
  add("spine05", "root", [0, 95, -4]);
  add("spine03", "spine05", [0, 111, -5]);
  add("spine01", "spine03", [0, 129, -5]);
  add("neck01", "spine01", [0, 145, -3.5]);
  add("head", "neck01", [0, 153, -3]);
  add("headTop", "head", [0, 169, -3]);
  add("jaw", "head", [0, 156, 0]);
  const axes = [];
  const axis = (name, end, side = null) => axes.push({ name, a: positions.get(name), b: positions.get(end), side });
  for (const [from, to] of [["root", "spine05"], ["spine05", "spine03"], ["spine03", "spine01"], ["spine01", "neck01"], ["neck01", "head"], ["head", "headTop"]]) axis(from, to);
  const handBones = new Map();
  function end(surface, direction, proximal) {
    const positions = surface.geometry.attributes.position, point = new THREE.Vector3();
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < positions.count; i++) { const t = point.fromBufferAttribute(positions, i).dot(direction); low = Math.min(low, t); high = Math.max(high, t); }
    const limit = (high - low) * .12, mean = new THREE.Vector3(); let count = 0;
    for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i); const t = point.dot(direction); if (proximal ? t <= low + limit : t >= high - limit) { mean.add(point); count++; } }
    return mean.divideScalar(Math.max(1, count));
  }
  for (const [side, sign] of [["L", 1], ["R", -1]]) {
    const suffix = side.toLowerCase();
    add(`clavicle.${side}`, "spine01", [sign * 4, 137, -2]);
    add(`upperarm01.${side}`, `clavicle.${side}`, [sign * 16.6, 138, -2.5]);
    add(`lowerarm01.${side}`, `upperarm01.${side}`, [sign * 22, 110, -2.5]);
    add(`wrist.${side}`, `lowerarm01.${side}`, [sign * 26, 86, .4]);
    add(`upperleg01.${side}`, "root", [sign * 8.2, 85.3, -.5]);
    add(`lowerleg01.${side}`, `upperleg01.${side}`, [sign * 7.7, 44, -3]);
    add(`foot.${side}`, `lowerleg01.${side}`, [sign * 7.4, 8, -3.8]);
    add(`toe3-1.${side}`, `foot.${side}`, [sign * 7.4, 2.8, 8]);
    for (const [from, to] of [["clavicle", "upperarm01"], ["upperarm01", "lowerarm01"], ["lowerarm01", "wrist"], ["upperleg01", "lowerleg01"], ["lowerleg01", "foot"], ["foot", "toe3-1"]]) axis(`${from}.${side}`, `${to}.${side}`, side);
    for (let finger = 0; finger < 5; finger++) {
      const word = ordinals[finger];
      const names = finger === 0
        ? [`first metacarpal bone.${suffix}`, `proximal phalanx of first finger of hand.${suffix}`, `distal phalanx of first finger of hand.${suffix}`]
        : ["proximal", "middle", "distal"].map(part => `${part} phalanx of ${word} finger of hand.${suffix}`);
      const pieces = names.map(name => byName.get(name));
      if (pieces.some(piece => !piece)) throw new Error(`Missing finger atlas geometry: ${names.join(", ")}`);
      const direction = pieces[2].center.clone().sub(pieces[0].center).normalize();
      const points = pieces.map(piece => end(piece, direction, true));
      points.push(end(pieces[2], direction, false));
      for (let segment = 0; segment < 4; segment++) {
        const name = `finger${finger + 1}-${segment + 1}.${side}`;
        add(name, segment === 0 ? `wrist.${side}` : `finger${finger + 1}-${segment}.${side}`, points[segment].toArray());
        if (segment < 3) handBones.set(names[segment], name);
        if (segment > 0) axis(`finger${finger + 1}-${segment}.${side}`, name, side);
      }
    }
    axis(`wrist.${side}`, `finger3-1.${side}`, side);
  }
  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); skeleton.calculateInverses();
  const indices = new Map(bones.map((bone, index) => [bone.name, index]));
  const delta = new THREE.Vector3(), projected = new THREE.Vector3();
  function distance(point, segment) {
    delta.copy(segment.b).sub(segment.a);
    const t = THREE.MathUtils.clamp(projected.copy(point).sub(segment.a).dot(delta) / Math.max(delta.lengthSq(), 1e-9), 0, 1);
    projected.copy(segment.a).addScaledVector(delta, t);
    return point.distanceToSquared(projected);
  }
  function sideOf(name, point) { return /\.l$/i.test(name) ? "L" : /\.r$/i.test(name) ? "R" : point.x >= 0 ? "L" : "R"; }
  function nearest(point, candidates = axes) {
    let best, bestDistance = Infinity;
    for (const segment of candidates) { const d = distance(point, segment); if (d < bestDistance) { best = segment.name; bestDistance = d; } }
    return best;
  }
  function attachment(surface) {
    const name = surface.name.toLowerCase(), side = sideOf(name, surface.center);
    if (handBones.has(name)) return handBones.get(name);
    if (/^femur/.test(name)) return `upperleg01.${side}`;
    if (/^(tibia|fibula|patella)/.test(name)) return `lowerleg01.${side}`;
    if (surface.center.y < 15) return `foot.${side}`;
    if (/hip bone|sacrum|coccyx/.test(name)) return "root";
    if (/^humerus/.test(name)) return `upperarm01.${side}`;
    if (/^(ulna|radius)/.test(name)) return `lowerarm01.${side}`;
    if (/scapula|clavicle/.test(name)) return `clavicle.${side}`;
    if (/mandible|^lower .* (incisor|canine|molar|premolar)|^lower (medial|lateral) incisor|^lower canine/.test(name)) return "jaw";
    if (/rib|sternum|xiphoid/.test(name)) return "spine01";
    if (/vertebra l/i.test(name)) return "spine05";
    if (/vertebra t/i.test(name)) return surface.center.y < 120 ? "spine03" : "spine01";
    if (/vertebra c|axis \(c|atlas \(c|hyoid|thyroid|cricoid|arytenoid|corniculate/.test(name)) return "neck01";
    if (surface.center.y > 146) return "head";
    if (surface.center.y > 60 && surface.center.y < 90 && Math.abs(surface.center.x) > 19) return `wrist.${side}`;
    return nearest(surface.center);
  }
  const records = [];
  for (const surface of surfaces) {
    const positions = surface.geometry.attributes.position, skinIndex = new Uint16Array(positions.count * 4), skinWeight = new Float32Array(positions.count * 4);
    const rigid = attachment(surface), linked = new Set(), point = new THREE.Vector3();
    const side = sideOf(surface.name, surface.center);
    const central = segment => !segment.side;
    const isTrunk = /intercost|trapezius|latissimus|pectoral|serratus|diaphragm|abdom|oblique|spinalis|longissimus|iliocostal|multifid|thoracolumbar/i.test(surface.name);
    const region = surface.center.y > 145 ? "head" : isTrunk || (surface.center.y > 102 && Math.abs(surface.center.x) < 14) ? "trunk"
      : surface.center.y < 102 && Math.abs(surface.center.x) < 19 ? "leg" : "arm";
    const candidates = axes.filter(segment => {
      if (segment.side && segment.side !== side) return false;
      if (region === "head") return ["neck01", "head"].includes(segment.name);
      if (region === "trunk") return central(segment) || (/latissimus|pectoral/i.test(surface.name) && /clavicle|upperarm/.test(segment.name));
      if (region === "leg") return ["root", "spine05"].includes(segment.name) || /upperleg|lowerleg|foot/.test(segment.name);
      return /clavicle|upperarm|lowerarm|wrist|finger/.test(segment.name);
    });
    for (let i = 0; i < positions.count; i++) {
      if (surface.system === "bones") { skinIndex[i * 4] = indices.get(rigid); skinWeight[i * 4] = 1; linked.add(rigid); continue; }
      point.fromBufferAttribute(positions, i);
      let first, second, d1 = Infinity, d2 = Infinity;
      for (const segment of candidates) {
        // Broad chest/back origins stay with the trunk; only the lateral upper
        // insertion region should follow the nearby humeral axis during a reach.
        const trunkAnchor = region === "trunk" && segment.side
          ? 3 * Math.max(0, 131 - point.y) + 3 * Math.max(0, 12 - Math.abs(point.x)) : 0;
        const d = distance(point, segment) + trunkAnchor ** 2;
        if (d < d1) { second = first; d2 = d1; first = segment; d1 = d; }
        else if (d < d2) { second = segment; d2 = d; }
      }
      // Bounded distance blending is only a visual deformation, not muscle strain.
      const a = 1 / (d1 + 4) ** 2, b = 1 / (d2 + 4) ** 2;
      skinIndex[i * 4] = indices.get(first.name); skinIndex[i * 4 + 1] = indices.get(second.name);
      skinWeight[i * 4] = a / (a + b); skinWeight[i * 4 + 1] = b / (a + b);
      linked.add(first.name); linked.add(second.name);
    }
    surface.geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    surface.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
    surface.geometry.clearGroups();
    records.push({ name: surface.name, system: surface.system, joints: [...linked], method: surface.system === "bones" ? "rigid reference attachment" : "two-joint visual skinning", vertices: positions.count });
  }
  for (const [system, color] of [["bones", 0xe3e1d5], ["muscles", 0xd3868f]]) {
    const geometry = mergeGeometries(surfaces.filter(surface => surface.system === system).map(surface => surface.geometry), false);
    if (!geometry) throw new Error(`Could not merge ${system} layer`);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .64, metalness: .02, side: THREE.DoubleSide }));
    mesh.name = `Anatomical ${system}`; mesh.userData = { anatomicalSystem: system };
    model.add(mesh); mesh.bind(skeleton); mesh.frustumCulled = false;
  }
  let sourceRevision = atlas.userData.sourceRevision;
  atlas.traverse(node => { sourceRevision ??= node.userData.sourceRevision; });
  model.userData = { anatomicalRig: true, source: "Z-Anatomy / BodyParts3D", sourceRevision,
    license: "CC-BY-SA-4.0; retain SOURCE-LICENSE.txt", skeletalStructures: records.filter(r => r.system === "bones").length,
    muscularStructures: records.filter(r => r.system === "muscles").length, joints: bones.length,
    limitations: "Articulated reference atlas. Manual joint centers and approximate muscle skinning. Not subject-specific anatomy, individual bone tracking, muscle activation, force, strain or diagnosis." };
  return { model, skeleton, records };
}
