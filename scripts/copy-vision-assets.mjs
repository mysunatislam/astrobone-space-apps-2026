import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const source = resolve("node_modules/@mediapipe/tasks-vision/wasm");
const destination = resolve("public/mediapipe");
await mkdir(destination, { recursive: true });
const assets = (await readdir(source)).filter((name) => /\.(js|wasm)$/.test(name));
if (!assets.length) throw new Error("MediaPipe WASM runtime assets were not found.");
for (const asset of assets) await copyFile(join(source, asset), join(destination, asset));
console.log(`Copied ${assets.length} MediaPipe runtime assets to ${destination}`);
