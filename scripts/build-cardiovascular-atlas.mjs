import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, dedup, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { isAnatomySurface } from "../src/anatomyMetadata.js";

const dir = ".artifacts/anatomy-source", out = "public/models/anatomy";
await mkdir(dir, { recursive: true }); await mkdir(out, { recursive: true });
const revision = "6c7f9016bd5899ac8edafd31b9900c151df42ed6";
const file = "CardioVascular41.fbx", url = `https://raw.githubusercontent.com/LluisV/Z-Anatomy/${revision}/Resources/Models/FBX/${file}`;
let bytes;
try { bytes = await readFile(`${dir}/${file}`); }
catch { const response = await fetch(url); if (!response.ok) throw new Error(`Atlas: ${response.status}`); bytes = Buffer.from(await response.arrayBuffer()); await writeFile(`${dir}/${file}`, bytes); }
globalThis.window = { URL: globalThis.URL }; THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); } };
const source = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ""); source.updateMatrixWorld(true);
const systems = { heart: [], arteries: [], veins: [], other: [] }, structures = [];
// Display groups keep heart, renal, pulmonary and major vessels individually addressable for the digital twin.
const groups = { heart: [], renal: [], pulmonary: [], major: [], arteries: [], veins: [], other: [] };
const groupOf = (name, system) => system === "heart" ? "heart" : /\brenal\b|kidney/i.test(name) && !/suprarenal/i.test(name) ? "renal"
  : /lung|pulmonary|lobar|bronch/i.test(name) ? "pulmonary"
  : /aort|vena cava|brachiocephalic|common carotid|subclavian|common iliac|external iliac|femoral|coeliac|celiac|superior mesenteric/i.test(name) ? "major" : system;
source.traverse(node => {
  if (!node.isMesh) return;
  const name = node.userData.originalName || node.name, triangles = (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  if (!isAnatomySurface(name, triangles)) return;
  const system = /atrium|auricle|ventricle|myocard|heart|valve|papillary|chordae|septum|pectinate|trabecul/i.test(name) ? "heart"
    : /vein|venous|venule|vena|sinus/i.test(name) ? "veins" : /arter|aorta|pulmonary trunk|brachiocephalic trunk/i.test(name) ? "arteries" : "other";
  let geometry = node.geometry.clone().applyMatrix4(node.matrixWorld); if (geometry.index) geometry = geometry.toNonIndexed();
  for (const key of Object.keys(geometry.attributes)) if (!["position", "normal"].includes(key)) geometry.deleteAttribute(key);
  if (!geometry.attributes.normal) geometry.computeVertexNormals(); geometry.clearGroups(); systems[system].push(geometry);
  const group = groupOf(name, system); groups[group].push(geometry);
  geometry.computeBoundingBox(); structures.push({ name, system, group, triangles, center: geometry.boundingBox.getCenter(new THREE.Vector3()).toArray() });
});
if (structures.length < 50 || !systems.heart.length || !systems.arteries.length || !systems.veins.length) throw new Error("Incomplete cardiovascular atlas");
const root = new THREE.Group(); root.name = "Z-Anatomy cardiovascular reference";
for (const [group, geometries] of Object.entries(groups)) {
  if (!geometries.length) continue;
  const color = { heart: 0x963e47, renal: 0x8a63b8, pulmonary: 0x6d86c9, major: 0xc2464f, arteries: 0xbf535c, veins: 0x497da4, other: 0x97736c }[group];
  const mesh = new THREE.Mesh(mergeGeometries(geometries), new THREE.MeshStandardMaterial({ color, roughness: .52 }));
  mesh.name = group; mesh.userData = { cardiovascularGroup: group, sourceStructures: geometries.length }; root.add(mesh);
}
const manifest = { schema: "astrobone-cardiovascular-atlas-v1", revision, sourceUrl: url, sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  sourceBytes: bytes.length, license: "CC-BY-SA-4.0", attribution: "Z-Anatomy; BodyParts3D / DBCLS (CC-BY-SA 2.1 Japan)",
  boundary: "Static anatomical atlas, not patient-specific anatomy or a fluid-mechanics mesh. Vessel colors distinguish named anatomical categories, not measured oxygenation. Renal and pulmonary groups are vessels only; kidney and lung tissue are not in this atlas.",
  coordinateFrame: "Same pinned FBX atlas frame as musculoskeletal.glb; copy its normalization, never independently fit vessel bounds.", structures };
root.userData = { sourceRevision: revision, license: manifest.license, attribution: manifest.attribution };
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const binary = await new GLTFExporter().parseAsync(root, { binary: true }); const document = await io.readBinary(new Uint8Array(binary));
await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: .22, error: .001 }), dedup(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
const output = await io.writeBinary(document); manifest.bytes = output.length; manifest.outputSha256 = createHash("sha256").update(output).digest("hex");
manifest.outputTriangles = document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0), 0);
await writeFile(`${out}/cardiovascular.glb`, output); await writeFile(`${out}/cardiovascular-manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ structures: structures.length, systems: Object.fromEntries(Object.entries(systems).map(([k, v]) => [k, v.length])), groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), bytes: output.length, triangles: manifest.outputTriangles }));
