import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(".");
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const paths = [
  ...await walk(join(root, "src")), ...await walk(join(root, "public")),
  join(root, "index.html"), join(root, "package-lock.json"),
];
const assets = [];
for (const path of paths.sort()) {
  const bytes = await readFile(path);
  assets.push({
    path: relative(root, path).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const manifest = {
  schemaVersion: "astrobone-release-audit-v1",
  generatedAt: new Date().toISOString(),
  purpose: "Reproduce this source and public-asset revision; not a validation certificate.",
  contentDigest: createHash("sha256").update(JSON.stringify(assets)).digest("hex"),
  assetCount: assets.length,
  publicAssetBytes: assets.filter((asset) => asset.path.startsWith("public/")).reduce((sum, asset) => sum + asset.bytes, 0),
  assets,
  exclusions: [
    "External X-ray backend checkpoints and service configuration are not part of this web asset manifest.",
    "An asset hash establishes identity, not scientific validity or a license grant.",
  ],
};
const destination = resolve(".artifacts/release-audit.json");
await mkdir(resolve(".artifacts"), { recursive: true });
await writeFile(destination, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ destination, contentDigest: manifest.contentDigest, assetCount: assets.length, publicAssetBytes: manifest.publicAssetBytes }, null, 2));
