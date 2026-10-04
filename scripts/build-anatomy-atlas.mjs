import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, simplify, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { isAnatomySurface } from "../src/anatomyMetadata.js";

const sourceDir = ".artifacts/anatomy-source", outputDir = "public/models/anatomy";
await mkdir(sourceDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
const repo = "LluisV/Z-Anatomy";
const revisionFile = `${sourceDir}/revision.json`;
let revision;
try { revision = JSON.parse(await readFile(revisionFile, "utf8")).sha; }
catch {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/PC-Version`);
  if (!response.ok) throw new Error(`Source revision unavailable: ${response.status}`);
  revision = (await response.json()).sha;
  await writeFile(revisionFile, JSON.stringify({ repo, sha: revision }, null, 2));
}
globalThis.window = { URL: globalThis.URL };
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const root = new THREE.Group(); root.name = "Z-Anatomy musculoskeletal reference";
const manifest = { source: `https://github.com/${repo}`, revision, generatedAt: new Date().toISOString(),
  license: "CC-BY-SA-4.0", attribution: "Z-Anatomy; BodyParts3D, The Database Center for Life Science (CC-BY-SA 2.1 Japan)",
  limitations: "Static reference atlas. Not subject-specific. No pose registration or validated deformation. No organs, nerves or vessels included.", systems: [], structures: [] };
for (const [system, file, color] of [["bones", "SkeletalSystem100.fbx", 0xe2dfcc], ["muscles", "MuscularSystem100.fbx", 0xa94554]]) {
  const path = `${sourceDir}/${file}`, url = `https://raw.githubusercontent.com/${repo}/${revision}/Resources/Models/FBX/${file}`;
  let bytes;
  try { bytes = await readFile(path); }
  catch {
    console.log(`Downloading ${file}`);
    const response = await fetch(url); if (!response.ok) throw new Error(`${file}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000000 || bytes.length > 100000000) throw new Error("Unexpected source size");
    await writeFile(path, bytes);
  }
  const parsed = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  parsed.updateMatrixWorld(true);
  const group = new THREE.Group(); group.name = system; root.add(group);
  const material = new THREE.MeshStandardMaterial({ color, roughness: .64, metalness: .04 });
  let vertices = 0, triangles = 0;
  parsed.traverse(node => {
    if (!node.isMesh) return;
    const count = (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    const originalName = node.userData.originalName || node.name;
    if (!isAnatomySurface(originalName, count)) return;
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (!["position", "normal"].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.clearGroups();
    const mesh = new THREE.Mesh(geometry, material);
    const id = `${system}-${group.children.length}`;
    mesh.name = originalName;
    mesh.userData = { anatomyId: id, anatomyName: originalName, system };
    group.add(mesh); vertices += geometry.attributes.position.count; triangles += count;
    manifest.structures.push({ id, name: originalName, system, sourceTriangles: count });
  });
  manifest.systems.push({ system, sourceFile: file, url, sha256: createHash("sha256").update(bytes).digest("hex"), structures: group.children.length, vertices, triangles });
  console.log(manifest.systems.at(-1));
}
root.userData = { source: manifest.source, sourceRevision: revision, license: manifest.license, attribution: manifest.attribution, limitations: manifest.limitations };
const sourceGlb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const document = await io.readBinary(new Uint8Array(sourceGlb));
await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: .35, error: .002 }), dedup(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
const byId = new Map(manifest.structures.map(item => [item.id, item]));
for (const node of document.getRoot().listNodes()) {
  const record = byId.get(node.getExtras().anatomyId);
  if (record && node.getMesh()) record.triangles = node.getMesh().listPrimitives().reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
}
const glb = await io.writeBinary(document);
await writeFile(`${outputDir}/musculoskeletal.glb`, glb);
manifest.outputBytes = glb.byteLength;
manifest.optimization = { targetRatio: .35, relativeErrorLimit: .002, compression: "EXT_meshopt_compression", annotationMarkersRemoved: true, triangles: manifest.structures.reduce((sum, item) => sum + item.triangles, 0) };
await writeFile(`${outputDir}/manifest.json`, JSON.stringify(manifest, null, 2));
const license = await fetch(`https://raw.githubusercontent.com/${repo}/${revision}/Resources/Models/License.txt`);
if (!license.ok) throw new Error("Source attribution could not be downloaded");
await writeFile(`${outputDir}/SOURCE-LICENSE.txt`, await license.text());
console.log(`Exported ${manifest.structures.length} named structures, ${(glb.byteLength / 1048576).toFixed(1)} MB`);
