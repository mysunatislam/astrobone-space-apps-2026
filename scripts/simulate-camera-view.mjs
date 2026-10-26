// How much does the camera view change the knee-angle error, for the same 3D keypoint noise?
// Seated knee extension: thigh horizontal (0.45 m), shank 0.40 m, knee angle theta (180 = straight).
// Each joint gets Gaussian noise: sigma in the two image directions, k x sigma in depth, because a single
// camera is least sure of depth. Facing the camera, the knee bends along the depth axis; side-on, it bends
// across the picture and depth is the left-right axis. Run: node scripts/simulate-camera-view.mjs
import { calculateJointAngle } from "../src/functionalAssessment.js";

let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const quantile = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];

// Body frame: f = forward, d = down, l = lateral. Camera axes (image x, image y, depth) per view.
const toCamera = { front: ({ f, d, l }) => ({ x: l, y: d, z: -f }), side: ({ f, d, l }) => ({ x: f, y: d, z: l }) };
export function viewError({ view, theta, sigma = 0.015, k = 2, runs = 20000 }) {
  const t = theta * Math.PI / 180;
  const body = { hip: { f: 0, d: 0, l: 0 }, knee: { f: 0.45, d: 0, l: 0 }, ankle: { f: 0.45 - 0.4 * Math.cos(t), d: 0.4 * Math.sin(t), l: 0 } };
  const truth = Object.fromEntries(Object.entries(body).map(([name, p]) => [name, toCamera[view](p)]));
  const errors = [];
  for (let i = 0; i < runs; i++) {
    const noisy = Object.fromEntries(Object.entries(truth).map(([name, p]) => [name, { x: p.x + sigma * gauss(), y: p.y + sigma * gauss(), z: p.z + k * sigma * gauss() }]));
    errors.push(calculateJointAngle(noisy.hip, noisy.knee, noisy.ankle) - theta);
  }
  const sd = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
  return { rmse: sd, bias: errors.reduce((s, e) => s + e, 0) / errors.length, p95: quantile(errors.map(Math.abs), 0.95) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Depth noise / image noise | Knee angle | Facing camera: RMSE, bias (95th pct) | Side-on: RMSE, bias (95th pct)");
  for (const k of [1, 2, 3]) for (const theta of [150, 170]) {
    const front = viewError({ view: "front", theta, k }), side = viewError({ view: "side", theta, k });
    const cell = r => `${r.rmse.toFixed(1)}, ${r.bias.toFixed(1)} (${r.p95.toFixed(1)})`;
    console.log(`${k}x | ${theta} deg | ${cell(front)} | ${cell(side)}`);
  }
}
