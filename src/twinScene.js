import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { MAX_TRACKS } from "./twinModel.js";

// Reference anatomy rendered as a state-driven visualization. Geometry is the Z-Anatomy atlas;
// colors, pulses and particle counts come only from values passed in by the twin state.
const BONE_BUCKETS = [
  ["tibiaL", /^Tibia\.l$/], ["tibiaR", /^Tibia\.r$/], ["femurL", /^Femur\.l$/], ["femurR", /^Femur\.r$/],
  ["pelvis", /^(Hip bone\.[lr]|Sacrum|Coccyx)$/], ["lumbar", /^Vertebra L[1-5]$/],
];
export const WEIGHT_BEARING = ["tibiaL", "tibiaR", "femurL", "femurR", "pelvis", "lumbar"];
const CONNECTIVE = /bursa|sheath|tendon|trochlea/i;
// Fascia sheets (fascia lata, crural, antebrachial, palmar aponeurosis...) wrap whole limbs, so they get their own layer.
const isFasciaSheet = name => /fascia|aponeur|retinacul/i.test(name) && !/^tensor fasciae latae/i.test(name);
const MUSCLE_BUCKETS = [
  ["quadriceps", /^(rectus femoris|vastus (lateralis|medialis|intermedius))/i],
  ["hamstrings", /biceps femoris|^semitendinosus|^semimembranosus/i],
  ["gluteal", /^gluteus (maximus|medius|minimus)/i],
  ["calf", /gastrocnemius|^soleus|^plantaris muscle/i],
  ["trunk", /^(rectus abdominis|external abdominal oblique|internal abdominal oblique|transversus abdominis|quadratus lumborum|psoas major|iliacus muscle|iliocostalis (lumborum|thoracis)|longissimus thoracis|multifidus (lumborum|thoracis))/i],
];
export const KEY_MUSCLES = MUSCLE_BUCKETS.map(([name]) => name);
const CARDIO_GROUPS = ["heart", "major", "arteries", "veins", "pulmonary", "renal", "other"];

export const PICK_LABELS = {
  tibiaL: "Left tibia · bone twin & impact lab", tibiaR: "Right tibia · bone twin", femurL: "Left femur · skeletal model", femurR: "Right femur · skeletal model",
  pelvis: "Pelvis / hip · skeletal model", lumbar: "Lumbar spine · skeletal model", heart: "Heart · cardiovascular analysis",
  major: "Major vessels · cardiovascular", renal: "Renal vessels · renal pathway", pulmonary: "Pulmonary vessels · cardiovascular",
  quadriceps: "Quadriceps · functional scan", hamstrings: "Hamstrings · functional scan", gluteal: "Gluteal muscles · functional scan",
  calf: "Calf muscles · functional scan", trunk: "Trunk muscles · functional scan", radiation: "Radiation tracks · exposure analysis",
};

const C = hex => new THREE.Color(hex);
const PALETTE = {
  shell: C(0x7fdcff), shellRim: C(0x58c8ff), bone: C(0xbfeeff), boneRim: C(0x7ad8ff), muscle: C(0xd88a5c), muscleKey: C(0xffb070), muscleRim: C(0xffc28a),
  muscleTissue: C(0xc0584d), muscleTissueRim: C(0xff9a86), connective: C(0xe6d9c6),
  heart: C(0xff3f78), major: C(0xff5a73), arteries: C(0xe8506a), veins: C(0x5d86ff), pulmonary: C(0x8c7dff), renal: C(0xb27cff), other: C(0xb06c78),
  ghost: C(0x5fd7ff), alert: C(0xffb347),
};
// Self-check domains that map onto anatomy. Behavioral and immune results have no anatomical layer.
const ALERT_LAYERS = { musculoskeletal: [...["tibiaL", "tibiaR", "femurL", "femurR", "pelvis", "lumbar"], "quadriceps", "hamstrings", "gluteal", "calf"], cardiovascular: ["heart", "major"] };

// Per-system targets: opacity, rim, diffuse, solidity (1 = shaded solid, 0 = fresnel hologram).
// Styles: "holo" = additive outer skin (with depth pre-pass), "glass" = alpha-blended, "solid" = alpha-blended with depth write.
function layerTargets(system, compare) {
  const t = {};
  const set = (names, value) => names.forEach(name => { t[name] = { ...(t[name] || {}), ...value }; });
  const muscles = [...KEY_MUSCLES, "musclesOther", "connective", "fascia"], bones = [...WEIGHT_BEARING, "bonesOther"];
  const vessels = ["major", "arteries", "veins", "pulmonary", "renal", "other"];
  set(muscles, { opacity: .4, rim: 1.0, diffuse: .05, solidity: 0, color: PALETTE.shell, rimColor: PALETTE.shellRim, style: "holo" });
  set(bones, { opacity: .22, rim: .8, diffuse: .35, solidity: 0, style: "glass" });
  set(["heart", ...vessels], { opacity: 0, rim: .6, diffuse: .6, solidity: .6, style: "glass" });
  if (system === "skeleton" || compare) {
    set(muscles, { opacity: .16 });
    set(bones, { opacity: 1, rim: .9, diffuse: .95, solidity: 1, style: "solid" });
  } else if (system === "muscle") {
    // Full atlas muscle model (all 683 structures, including hands and feet) as shaded tissue.
    set(["musclesOther"], { opacity: 1, rim: .28, diffuse: .82, solidity: 1, color: PALETTE.muscleTissue, rimColor: PALETTE.muscleTissueRim, style: "solid" });
    set(["connective"], { opacity: 1, rim: .2, diffuse: .8, solidity: 1, color: PALETTE.connective, rimColor: PALETTE.connective, style: "solid" });
    set(["fascia"], { opacity: 0 });
    set(KEY_MUSCLES, { opacity: 1, rim: .38, diffuse: .78, solidity: 1, color: PALETTE.muscleKey, rimColor: PALETTE.muscleRim, style: "solid" });
    set(bones, { opacity: .2 });
  } else if (system === "cardiovascular") {
    set(muscles, { opacity: .1 }); set(bones, { opacity: .16 });
    set(["heart"], { opacity: 1, rim: 1.2, diffuse: .95, solidity: 1, style: "solid" });
    set(["major"], { opacity: .95, rim: 1.3, diffuse: .85, solidity: .85 });
    set(["arteries"], { opacity: .7, rim: 1.1, diffuse: .7 }); set(["veins"], { opacity: .5 }); set(["pulmonary"], { opacity: .65 });
    set(["renal", "other"], { opacity: .3 });
  } else if (system === "renal") {
    set(muscles, { opacity: .08 }); set(bones, { opacity: .14 }); set(["lumbar", "pelvis"], { opacity: .4 });
    set(["renal"], { opacity: 1, rim: 1.6, diffuse: .9, solidity: .9 }); set(["major"], { opacity: .55 }); set(["heart"], { opacity: .25 });
  } else if (system === "radiation") {
    set(muscles, { opacity: .42 }); set(bones, { opacity: .25 }); set(["heart", "major"], { opacity: .2 });
  } else if (system === "multisystem") {
    set(muscles, { opacity: .14, rim: .9 });
    set(bones, { opacity: .5, rim: .7, diffuse: .6, solidity: .25 });
    set(["heart"], { opacity: .9, rim: 1.1, diffuse: .9, solidity: .85 }); set(["major"], { opacity: .6 }); set(["arteries"], { opacity: .35 });
    set(["veins"], { opacity: .16 }); set(["pulmonary"], { opacity: .25 }); set(["renal"], { opacity: .7, rim: 1.4 });
    set(KEY_MUSCLES, { opacity: .26, color: PALETTE.muscle, rimColor: PALETTE.muscleRim, rim: .8 });
  } else if (system === "functional") {
    set(muscles, { opacity: .14 }); set(bones, { opacity: .45, solidity: .5 });
    set(["quadriceps", "hamstrings", "gluteal", "calf"], { opacity: .94, rim: .35, diffuse: .62, solidity: 1, color: PALETTE.muscle, rimColor: PALETTE.muscleRim, style: "solid" });
  } else if (system === "impact") {
    set(muscles, { opacity: .05 }); set(bones, { opacity: .1 }); set(["tibiaR", "femurL", "femurR"], { opacity: .25 });
    set(["tibiaL"], { opacity: 1, rim: .3, diffuse: .95, solidity: 1, style: "solid" });
  }
  return t;
}

const VERTEX = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vW;
#ifdef USE_STRESS
attribute float aStress; varying float vS;
#endif
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  vec4 mv = viewMatrix * w; vV = -mv.xyz; vN = normalize(normalMatrix * normal);
  #ifdef USE_STRESS
  vS = aStress;
  #endif
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform vec3 uRimColor; uniform float uOpacity; uniform float uRim; uniform float uDiffuse; uniform float uSolidity;
uniform float uPulse; uniform float uHover; uniform float uSweep; uniform float uScanY; uniform float uScanOn;
uniform vec3 uWaveCenter; uniform float uWaveRadius; uniform float uWaveOn; uniform float uDesaturate;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
#ifdef USE_STRESS
uniform vec3 uRevealCenter; uniform float uRevealRadius; varying float vS;
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(.10,.25,.95), c1 = vec3(.10,.80,1.), c2 = vec3(.20,.95,.45), c3 = vec3(.98,.92,.25), c4 = vec3(1.,.55,.15), c5 = vec3(1.,.18,.15);
  if (t < .2) return mix(c0, c1, t / .2); if (t < .4) return mix(c1, c2, (t - .2) / .2);
  if (t < .6) return mix(c2, c3, (t - .4) / .2); if (t < .8) return mix(c3, c4, (t - .6) / .2); return mix(c4, c5, (t - .8) / .2);
}
#endif
void main() {
  if (vW.y > uSweep) discard;
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float fres = pow(1.0 - abs(dot(n, v)), 2.0);
  float lam = .32 + .68 * abs(dot(n, normalize(vec3(.35, .8, .5))));
  vec3 base = uColor;
  #ifdef USE_STRESS
  float reveal = smoothstep(uRevealRadius, uRevealRadius - .05, distance(vW, uRevealCenter));
  base = mix(base, ramp(vS), reveal);
  #endif
  float grey = dot(base, vec3(.299, .587, .114)); base = mix(base, vec3(grey), uDesaturate);
  vec3 col = base * lam * uDiffuse + uRimColor * fres * uRim * .6;
  float edge = smoothstep(.07, 0.0, uSweep - vW.y) * step(vW.y, uSweep) * step(uSweep, 1.6);
  float wave = 0.0;
  if (uWaveOn > .5) { float d = distance(vW, uWaveCenter); wave = exp(-pow((d - uWaveRadius) / .07, 2.0)) * (1.0 - smoothstep(.3, 1.9, uWaveRadius)); }
  float scan = uScanOn * exp(-pow((vW.y - uScanY) / .03, 2.0));
  col += uRimColor * (edge * 1.2 + wave * .9 + scan * .8);
  col *= 1.0 + uPulse * .35 + uHover * .45;
  float a = uOpacity * mix(.3 + .7 * fres, 1.0, uSolidity);
  a = clamp(a + (edge + wave * .8 + scan) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

function anatomyMaterial(shared, { stress = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    defines: stress ? { USE_STRESS: "" } : {},
    uniforms: {
      uColor: { value: PALETTE.bone.clone() }, uRimColor: { value: PALETTE.boneRim.clone() }, uOpacity: { value: 0 }, uRim: { value: 1 }, uDiffuse: { value: .5 },
      uSolidity: { value: 0 }, uPulse: { value: 0 }, uHover: { value: 0 }, uDesaturate: { value: 0 },
      uSweep: shared.sweep, uScanY: shared.scanY, uScanOn: shared.scanOn,
      uWaveCenter: shared.waveCenter, uWaveRadius: shared.waveRadius, uWaveOn: { value: 0 },
      uRevealCenter: { value: new THREE.Vector3() }, uRevealRadius: { value: 0 },
    },
  });
}

// Meshopt stores quantized attributes plus node transforms; bake both into float geometry.
function bake(mesh) {
  const geometry = new THREE.BufferGeometry();
  for (const key of ["position", "normal"]) {
    const source = mesh.geometry.attributes[key]; if (!source) continue;
    const values = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) { values[i * 3] = source.getX(i); values[i * 3 + 1] = source.getY(i); values[i * 3 + 2] = source.getZ(i); }
    geometry.setAttribute(key, new THREE.BufferAttribute(values, 3));
  }
  if (mesh.geometry.index) geometry.setIndex(Array.from(mesh.geometry.index.array));
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return geometry;
}

// Midpoint subdivision with shared edge vertices: smoother color interpolation for the stress map.
function subdivide(geometry, levels) {
  let positions = Array.from(geometry.attributes.position.array), index = Array.from(geometry.index.array);
  for (let level = 0; level < levels; level++) {
    const edges = new Map(), next = [];
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`; if (edges.has(key)) return edges.get(key);
      const id = positions.length / 3; positions.push((positions[a * 3] + positions[b * 3]) / 2, (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2, (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2);
      edges.set(key, id); return id;
    };
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    index = next;
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); result.setIndex(index); result.computeVertexNormals();
  return result;
}

const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = THREE.MathUtils.lerp;

export function createTwinScene(canvas, { onPick, onHover, onProgress, onFrame } = {}) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
  // Near-black space. Set in linear space: a hex clear color is encoded twice by the output pass
  // and comes out navy, which hides the translucent body outlines.
  const SPACE = new THREE.Color().setRGB(0, .00004, .00012, THREE.LinearSRGBColorSpace);
  renderer.setPixelRatio(pixelRatio); renderer.setClearColor(SPACE, 1);
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(SPACE.clone(), .035);
  const camera = new THREE.PerspectiveCamera(34, 1, .02, 200); camera.position.set(0, .15, 6.2);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enablePan: false, enableDamping: true, dampingFactor: .08, minDistance: .55, maxDistance: 10, autoRotate: !reduceMotion.matches, autoRotateSpeed: 2.0, rotateSpeed: .7, zoomSpeed: .8 });
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Restrained bloom: only the brightest highlights (heart pulse, impact flash) bleed light.
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), .16, .35, .55); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const shared = {
    sweep: { value: 99 }, scanY: { value: 0 }, scanOn: { value: 0 },
    waveCenter: { value: new THREE.Vector3() }, waveRadius: { value: 0 },
  };
  const root = new THREE.Group(); root.name = "Digital twin"; scene.add(root);
  const anatomy = new THREE.Group(); anatomy.name = "Reference anatomy (Z-Anatomy / BodyParts3D)"; root.add(anatomy);
  const layers = new Map(); // name -> { mesh, material, target }
  const anchors = new Map(); // name -> Vector3 (world)
  let system = "multisystem", compare = false, ready = false, disposed = false, heartHz = 0, heartPhase = 0, frame = 0;
  let lastInteraction = -1e9, sequenceLock = false, tween = null, hovered = null, heartMesh = null, heartCenter = new THREE.Vector3();
  let musclePulse = 0, desaturate = {}, trackTarget = 0, trackCount = 0, introStart = null, scanStart = null;
  const clock = new THREE.Clock();

  // Environment: stars, polar grid, orbits. Decorative and labelled as such in the UI.
  const environment = new THREE.Group(); scene.add(environment);
  {
    const count = 2600, positions = new Float32Array(count * 3), random = mulberry(9);
    for (let i = 0; i < count; i++) {
      const r = 26 + random() * 40, theta = random() * Math.PI * 2, phi = Math.acos(2 * random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta); positions[i * 3 + 1] = r * Math.cos(phi) * .7; positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3)),
      new THREE.PointsMaterial({ color: 0x9fc8ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: .55, depthWrite: false, fog: false }));
    environment.add(stars);
    const grid = new THREE.PolarGridHelper(1.9, 12, 8, 96, 0x1f7fa8, 0x123a55); grid.position.y = -1.3;
    for (const mat of [grid.material].flat()) { mat.transparent = true; mat.opacity = .28; mat.depthWrite = false; }
    environment.add(grid);
    const orbitMaterial = new THREE.LineDashedMaterial({ color: 0x4bb8ff, transparent: true, opacity: .22, dashSize: .06, gapSize: .05, depthWrite: false });
    for (const [rx, rz, tilt, y] of [[1.75, 1.55, .22, -.2], [2.15, 1.9, -.34, .35]]) {
      const curve = new THREE.EllipseCurve(0, 0, rx, rz, 0, Math.PI * 2), line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(160).map(p => new THREE.Vector3(p.x, 0, p.y))), orbitMaterial);
      line.computeLineDistances(); line.rotation.z = tilt; line.position.y = y; line.userData.spin = tilt > 0 ? .02 : -.015; environment.add(line);
    }
  }

  // Radiation tracks: count follows cumulative dose; motion is illustrative, not transport.
  const tracks = (() => {
    const positions = new Float32Array(MAX_TRACKS * 6), along = new Float32Array(MAX_TRACKS * 2), seeds = new Float32Array(MAX_TRACKS * 2), random = mulberry(31);
    for (let i = 0; i < MAX_TRACKS; i++) {
      const through = new THREE.Vector3((random() - .5) * .7, (random() - .5) * 2.4, (random() - .5) * .45);
      const dir = new THREE.Vector3(random() - .5, (random() - .5) * .8, random() - .5).normalize(), half = .55 + random() * .35;
      const a = through.clone().addScaledVector(dir, -half), b = through.clone().addScaledVector(dir, half);
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); along.set([0, 1], i * 2); const s = random(); seeds.set([s, s], i * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); geometry.setAttribute("aT", new THREE.BufferAttribute(along, 1)); geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xc9b8ff) }, uHover: { value: 0 } },
      vertexShader: `attribute float aT; attribute float aSeed; varying float vT; varying float vSeed; void main(){ vT = aT; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uOpacity; uniform vec3 uColor; uniform float uHover; varying float vT; varying float vSeed;
        void main(){ float head = fract(uTime * (.18 + vSeed * .22) + vSeed * 7.0); float d = vT - head;
          float glow = exp(-pow(d / .025, 2.0)) * .9 + exp(-max(-d, 0.0) / .08) * step(d, 0.0) * .2;
          gl_FragColor = vec4(uColor * (1.0 + uHover), glow * uOpacity); }`,
    });
    const lines = new THREE.LineSegments(geometry, material); lines.name = "radiation"; lines.renderOrder = 4; lines.frustumCulled = false; root.add(lines);
    return { lines, material, geometry };
  })();

  // Time-travel scan ring and impact props.
  const scanRing = new THREE.Mesh(new THREE.TorusGeometry(.62, .004, 6, 120), new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scanRing.rotation.x = Math.PI / 2; root.add(scanRing);
  const impact = createImpactProps(); root.add(impact.group);

  function mulberry(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function createImpactProps() {
    const group = new THREE.Group(); group.visible = false;
    const tool = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(.16, .035, .035), new THREE.MeshBasicMaterial({ color: 0x1b2a3a, transparent: true, opacity: .9 }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xffc46b }));
    tool.add(body, edges); group.add(tool);
    const pathGeometry = new THREE.BufferGeometry(), pathPositions = new Float32Array(64 * 3); pathGeometry.setAttribute("position", new THREE.BufferAttribute(pathPositions, 3)); pathGeometry.setDrawRange(0, 0);
    const path = new THREE.Line(pathGeometry, new THREE.LineDashedMaterial({ color: 0xffc46b, dashSize: .03, gapSize: .02, transparent: true, opacity: .9 })); group.add(path);
    const shock = new THREE.Mesh(new THREE.RingGeometry(.02, .028, 64), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); group.add(shock);
    const marker = new THREE.Mesh(new THREE.RingGeometry(.018, .022, 48), new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false })); marker.renderOrder = 9; group.add(marker);
    const peak = new THREE.Mesh(new THREE.RingGeometry(.022, .027, 48), new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false })); peak.renderOrder = 9; group.add(peak);
    return { group, tool, path, pathPositions, shock, marker, peak };
  }

  const prepassMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  function addLayer(name, geometry, { color, rimColor, stress = false, pickable = true } = {}) {
    const material = anatomyMaterial(shared, { stress });
    material.uniforms.uColor.value.copy(color); material.uniforms.uRimColor.value.copy(rimColor ?? color);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.frustumCulled = false; mesh.visible = false;
    mesh.userData.pickable = pickable; anatomy.add(mesh);
    // Hologram skin: a depth-only pre-pass lets only the outermost muscle surface glow,
    // instead of hundreds of overlapping additive surfaces saturating the torso.
    let prepass = null;
    if (KEY_MUSCLES.includes(name) || ["musclesOther", "connective", "fascia"].includes(name)) {
      prepass = new THREE.Mesh(geometry, prepassMaterial); prepass.name = `${name} depth pre-pass`; prepass.frustumCulled = false; prepass.visible = false; prepass.renderOrder = 5; anatomy.add(prepass);
    }
    layers.set(name, { mesh, material, prepass, base: { color: color.clone(), rimColor: (rimColor ?? color).clone() }, from: null, to: null });
    return mesh;
  }

  async function load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), base = import.meta.env.BASE_URL;
    const progress = { atlas: 0, cardio: 0 }, report = () => onProgress?.((progress.atlas * .82 + progress.cardio * .18));
    const track = key => event => { if (event.total) { progress[key] = event.loaded / event.total; report(); } };
    const [atlas, cardio] = await Promise.all([
      loader.loadAsync(`${base}models/anatomy/musculoskeletal.glb`, track("atlas")),
      loader.loadAsync(`${base}models/anatomy/cardiovascular.glb`, track("cardio")),
    ]);
    if (disposed) return;
    atlas.scene.updateMatrixWorld(true); cardio.scene.updateMatrixWorld(true);
    const buckets = new Map(), centers = new Map(), box = new THREE.Box3();
    atlas.scene.traverse(node => {
      if (!node.isMesh || !node.userData.system) return;
      const name = node.userData.anatomyName || node.name, system = node.userData.system;
      let bucket = system === "bones" ? BONE_BUCKETS.find(([, re]) => re.test(name))?.[0] ?? "bonesOther"
        : isFasciaSheet(name) ? "fascia" : CONNECTIVE.test(name) ? "connective" : MUSCLE_BUCKETS.find(([, re]) => re.test(name))?.[0] ?? "musclesOther";
      const geometry = bake(node); geometry.computeBoundingBox(); box.union(geometry.boundingBox);
      if (/^(Patella\.l|Femur\.l|Tibia\.l)$/.test(name)) centers.set(name, geometry.boundingBox.getCenter(new THREE.Vector3()));
      if (!buckets.has(bucket)) buckets.set(bucket, []); buckets.get(bucket).push(geometry);
    });
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()), scale = 2.5 / size.y;
    anatomy.scale.setScalar(scale); anatomy.position.copy(center).multiplyScalar(-scale);
    for (const [name, geometries] of buckets) {
      let geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      if (name === "tibiaL") geometry = subdivide(geometry, 2);
      const muscle = KEY_MUSCLES.includes(name) || ["musclesOther", "connective", "fascia"].includes(name);
      addLayer(name, geometry, { color: muscle ? PALETTE.shell : PALETTE.bone, rimColor: muscle ? PALETTE.shellRim : PALETTE.boneRim, stress: name === "tibiaL", pickable: !["musclesOther", "bonesOther", "connective", "fascia"].includes(name) });
    }
    cardio.scene.traverse(node => {
      if (!node.isMesh) return;
      const group = node.userData.cardiovascularGroup || node.name; if (!CARDIO_GROUPS.includes(group)) return;
      const geometry = bake(node); geometry.computeBoundingBox();
      if (group === "heart") { geometry.boundingBox.getCenter(heartCenter); geometry.translate(-heartCenter.x, -heartCenter.y, -heartCenter.z); }
      const mesh = addLayer(group, geometry, { color: PALETTE[group], rimColor: PALETTE[group], pickable: group !== "other" && group !== "arteries" && group !== "veins" });
      if (group === "heart") { mesh.position.copy(heartCenter); heartMesh = mesh; }
      if (["major", "arteries", "veins", "pulmonary", "renal"].includes(group)) layers.get(group).material.uniforms.uWaveOn.value = 1;
    });
    anatomy.updateMatrixWorld(true);
    const world = (name, fallback) => { const layer = layers.get(name); if (!layer) return fallback; const b = new THREE.Box3().setFromObject(layer.mesh); return b.getCenter(new THREE.Vector3()); };
    anchors.set("body", new THREE.Vector3(0, 0, 0)); anchors.set("head", new THREE.Vector3(0, 1.12, 0)); anchors.set("heart", world("heart", new THREE.Vector3(0, .5, 0)));
    for (const name of [...WEIGHT_BEARING, "renal", "quadriceps", "hamstrings", "trunk", "calf"]) if (layers.has(name)) anchors.set(name, world(name));
    anchors.set("radiation", new THREE.Vector3(.75, .55, .2));
    shared.waveCenter.value.copy(anchors.get("heart"));
    setupImpactGeometry(centers);
    basePosition.copy(anatomy.position); for (const [key, point] of anchors) anchorsBase.set(key, point.clone());
    ready = true; canvas.dataset.ready = "true"; canvas.dataset.layers = [...layers.keys()].join(",");
    applySystem(system, false);
  }

  // Impact point: anteromedial tibial surface at 60 % of the shaft from the knee.
  function setupImpactGeometry(centers) {
    const tibia = layers.get("tibiaL"); if (!tibia) return;
    const toWorld = v => v.clone().applyMatrix4(anatomy.matrixWorld);
    const patella = centers.get("Patella.l"), femur = centers.get("Femur.l"), tibiaCenter = centers.get("Tibia.l");
    const anterior = new THREE.Vector3(0, 0, Math.sign((patella?.z ?? 1) - (femur?.z ?? 0)) || 1);
    const medial = new THREE.Vector3(-Math.sign(tibiaCenter?.x ?? 1) || -1, 0, 0);
    const outward = anterior.clone().multiplyScalar(.8).add(medial.multiplyScalar(.6)).normalize();
    const positions = tibia.mesh.geometry.attributes.position; let top = -Infinity, bottom = Infinity;
    for (let i = 0; i < positions.count; i++) { const y = positions.getY(i); top = Math.max(top, y); bottom = Math.min(bottom, y); }
    const targetY = top - (top - bottom) * .6, slice = [];
    for (let i = 0; i < positions.count; i++) if (Math.abs(positions.getY(i) - targetY) < (top - bottom) * .02) slice.push(i);
    const mid = slice.reduce((acc, i) => acc.add(new THREE.Vector3().fromBufferAttribute(positions, i)), new THREE.Vector3()).divideScalar(Math.max(1, slice.length));
    let best = slice[0], bestDot = -Infinity;
    for (const i of slice) { const d = new THREE.Vector3().fromBufferAttribute(positions, i).sub(mid).dot(outward); if (d > bestDot) { bestDot = d; best = i; } }
    const local = new THREE.Vector3().fromBufferAttribute(positions, best);
    impact.local = local; impact.outwardLocal = outward; impact.world = toWorld(local);
    impact.normalWorld = outward.clone().transformDirection(anatomy.matrixWorld).normalize();
    anchors.set("impact", impact.world.clone());
  }

  function setStressField(field, peakIndex) {
    const tibia = layers.get("tibiaL"); if (!tibia) return;
    tibia.mesh.geometry.setAttribute("aStress", new THREE.BufferAttribute(field, 1));
    const p = new THREE.Vector3().fromBufferAttribute(tibia.mesh.geometry.attributes.position, peakIndex).applyMatrix4(anatomy.matrixWorld);
    impact.peakWorld = p; anchors.set("peak", p.clone());
  }
  function tibiaPositions() { return layers.get("tibiaL")?.mesh.geometry.attributes.position.array; }

  function applySystem(next, animate = true) {
    system = next; const targets = layerTargets(system, compare);
    const alerted = new Set(Object.entries(alerts).filter(([, on]) => on).flatMap(([domain]) => ALERT_LAYERS[domain] ?? []));
    for (const [name, layer] of layers) {
      const target = { ...(targets[name] ?? { opacity: 0 }) }, u = layer.material.uniforms;
      if (alerted.has(name) && (target.opacity ?? 0) > .05 && system !== "impact") Object.assign(target, { rimColor: PALETTE.alert, rim: 1.8 });
      layer.from = { opacity: u.uOpacity.value, rim: u.uRim.value, diffuse: u.uDiffuse.value, solidity: u.uSolidity.value, color: u.uColor.value.clone(), rimColor: u.uRimColor.value.clone() };
      const tint = layer.tint && (system === "skeleton" || system === "multisystem" || compare) ? layer.tint : null;
      const alert = alerted.has(name) && target.rimColor === PALETTE.alert;
      layer.to = {
        opacity: target.opacity ?? 0, rim: target.rim ?? 1, diffuse: target.diffuse ?? .5, solidity: target.solidity ?? 0,
        color: tint ?? target.color ?? layer.base.color, rimColor: alert ? PALETTE.alert : tint ?? target.rimColor ?? layer.base.rimColor,
      };
      const holo = target.style === "holo", solid = target.style === "solid";
      layer.material.blending = holo ? THREE.AdditiveBlending : THREE.NormalBlending;
      layer.material.depthWrite = solid && (target.opacity ?? 0) > .9;
      layer.mesh.renderOrder = solid ? 1 : holo && layer.prepass ? 6 : 2;
      layer.shellPass = holo && Boolean(layer.prepass);
      if (layer.to.opacity > 0) layer.mesh.visible = true;
      if (layer.prepass) layer.prepass.visible = layer.shellPass && layer.mesh.visible;
    }
    layerTween = { start: performance.now(), duration: animate && !reduceMotion.matches ? 800 : 0 };
    // Less glow where colors carry data (stress map), so the scale is not washed out.
    bloom.strength = system === "impact" ? .06 : ["functional", "muscle"].includes(system) ? .08 : .16;
    canvas.dataset.system = system;
  }
  let layerTween = null;

  function stepLayers(now) {
    if (!layerTween) return;
    const t = layerTween.duration ? Math.min(1, (now - layerTween.start) / layerTween.duration) : 1, k = easeInOut(t);
    for (const layer of layers.values()) {
      if (!layer.to) continue; const u = layer.material.uniforms, f = layer.from;
      u.uOpacity.value = lerp(f.opacity, layer.to.opacity, k); u.uRim.value = lerp(f.rim, layer.to.rim, k);
      u.uDiffuse.value = lerp(f.diffuse, layer.to.diffuse, k); u.uSolidity.value = lerp(f.solidity, layer.to.solidity, k);
      u.uColor.value.copy(f.color).lerp(layer.to.color, k); u.uRimColor.value.copy(f.rimColor).lerp(layer.to.rimColor, k);
      if (t === 1) { layer.mesh.visible = layer.to.opacity > .002; if (layer.prepass) layer.prepass.visible = layer.shellPass && layer.mesh.visible; }
    }
    if (t === 1) layerTween = null;
  }

  // Model state -> visuals. Every input here is a value from twinState(), never a free animation.
  function setState(state, { bonesSolidity = 1 } = {}) {
    const tint = new THREE.Color().setRGB(...state.bone.tint, THREE.SRGBColorSpace);
    for (const name of WEIGHT_BEARING) { const layer = layers.get(name); if (!layer) continue; layer.tint = tint.clone(); layer.material.uniforms.uDesaturate.value = 1 - bonesSolidity; }
    desaturate = { bones: 1 - bonesSolidity };
    heartHz = state.heart.hz; trackTarget = system === "radiation" ? state.radiation.tracks : 0;
    tracks.trackCountForState = state.radiation.tracks;
    if (ready) applySystem(system, true);
  }

  function setSystem(next, { focusTarget, animate = true } = {}) {
    if (!ready) { system = next; return; }
    applySystem(next, animate);
    trackTarget = next === "radiation" ? tracks.trackCountForState ?? 0 : 0;
    if (focusTarget !== undefined) focus(focusTarget, { animate });
  }

  function setCompare(value) {
    compare = value;
    if (!ready) return;
    if (value && !ghost) buildGhost();
    if (ghost) ghost.visible = value;
    shiftX = value ? .62 : 0;
    anatomy.position.x = basePosition.x + shiftX; anatomy.updateMatrixWorld(true);
    for (const [key, point] of anchorsBase) anchors.set(key, point.clone().add(new THREE.Vector3(shiftX, 0, 0)));
    shared.waveCenter.value.copy(anchors.get("heart"));
    if (value) controls.autoRotate = false;
    applySystem(system, true);
    focus(value ? "compare" : "body");
  }
  let alerts = {};
  function setAlerts(next) { alerts = { ...(next || {}) }; if (ready) applySystem(system, true); }
  let ghost = null, shiftX = 0; const basePosition = new THREE.Vector3(), anchorsBase = new Map();
  function buildGhost() {
    ghost = new THREE.Group(); ghost.name = "Day 1 model baseline"; ghost.scale.copy(anatomy.scale); ghost.position.copy(basePosition); ghost.position.x -= .62;
    const material = anatomyMaterial(shared); material.blending = THREE.AdditiveBlending;
    material.uniforms.uColor.value.copy(PALETTE.ghost); material.uniforms.uRimColor.value.copy(PALETTE.ghost);
    material.uniforms.uOpacity.value = .6; material.uniforms.uRim.value = 1.4; material.uniforms.uDiffuse.value = .3;
    for (const name of [...WEIGHT_BEARING, "bonesOther"]) { const layer = layers.get(name); if (layer) { const mesh = new THREE.Mesh(layer.mesh.geometry, material); mesh.frustumCulled = false; ghost.add(mesh); } }
    anchors.set("ghostHead", new THREE.Vector3(-.62, 1.12, 0)); anchorsBase.set("ghostHead", new THREE.Vector3(-.62 - shiftX, 1.12, 0));
    root.add(ghost);
  }

  // Camera presets. Directions are unit vectors from target to camera.
  function focus(name, { animate = true, duration = 1000 } = {}) {
    const presets = {
      body: { target: new THREE.Vector3(shiftX, 0, 0), distance: 5.6, dir: new THREE.Vector3(.18, .08, 1) },
      compare: { target: new THREE.Vector3(0, 0, 0), distance: 6.4, dir: new THREE.Vector3(0, .05, 1) },
      thorax: { target: anchors.get("heart"), distance: 1.35, dir: new THREE.Vector3(.35, .12, 1) },
      kidneys: { target: anchors.get("renal"), distance: 1.35, dir: new THREE.Vector3(-.25, .12, 1) },
      pelvis: { target: anchors.get("pelvis"), distance: 1.7, dir: new THREE.Vector3(.3, .2, 1) },
      spine: { target: anchors.get("lumbar"), distance: 1.4, dir: new THREE.Vector3(.4, .15, -1) },
      thighs: { target: anchors.get("quadriceps") ?? anchors.get("femurL"), distance: 2.2, dir: new THREE.Vector3(.3, .1, 1) },
      legs: { target: new THREE.Vector3(shiftX, -.6, 0), distance: 2.8, dir: new THREE.Vector3(.35, .12, 1) },
      leftLeg: { target: anchors.get("tibiaL"), distance: 1.25, dir: impact.normalWorld ? impact.normalWorld.clone().add(new THREE.Vector3(0, .18, .25)) : new THREE.Vector3(.2, .1, 1) },
      hotspot: { target: impact.peakWorld ?? anchors.get("tibiaL"), distance: .7, dir: impact.normalWorld ? impact.normalWorld.clone().add(new THREE.Vector3(0, .1, .1)) : new THREE.Vector3(.2, .1, 1) },
      femur: { target: anchors.get("femurL"), distance: 1.5, dir: new THREE.Vector3(.4, .1, 1) },
      head: { target: anchors.get("head")?.clone().add(new THREE.Vector3(0, -.05, 0)), distance: 1.5, dir: new THREE.Vector3(.3, .05, 1) },
    };
    const preset = presets[name] ?? presets.body; if (!preset.target) return;
    const toTarget = preset.target.clone(), toPosition = toTarget.clone().add(preset.dir.clone().normalize().multiplyScalar(preset.distance));
    if (!animate || reduceMotion.matches) { controls.target.copy(toTarget); camera.position.copy(toPosition); controls.update(); tween = null; return; }
    tween = { start: performance.now(), duration, fromPosition: camera.position.clone(), toPosition, fromTarget: controls.target.clone(), toTarget };
    canvas.dataset.focus = name;
  }

  // Cinematic impact sequence. Values shown are computed by the caller (twinImpact.js).
  function playImpact({ onPhase } = {}) {
    if (!ready || !impact.world) return Promise.resolve();
    sequenceLock = true; controls.autoRotate = false; impact.group.visible = true;
    const tibia = layers.get("tibiaL"), u = tibia.material.uniforms;
    u.uRevealCenter.value.copy(impact.world); u.uRevealRadius.value = 0;
    const start = impact.world.clone().addScaledVector(impact.normalWorld, 1.25).add(new THREE.Vector3(.25, .55, .1));
    const control = start.clone().lerp(impact.world, .5).add(new THREE.Vector3(0, .25, 0));
    const curve = new THREE.QuadraticBezierCurve3(start, control, impact.world.clone()), points = curve.getPoints(63);
    points.forEach((p, i) => impact.pathPositions.set([p.x, p.y, p.z], i * 3)); impact.path.geometry.attributes.position.needsUpdate = true; impact.path.computeLineDistances();
    impact.shock.position.copy(impact.world); impact.shock.lookAt(impact.world.clone().add(impact.normalWorld));
    impact.marker.position.copy(impact.world); impact.marker.lookAt(impact.world.clone().add(impact.normalWorld));
    if (impact.peakWorld) { impact.peak.position.copy(impact.peakWorld); impact.peak.lookAt(camera.position); }
    const fast = reduceMotion.matches;
    const phases = [
      ["focus", fast ? 0 : 1100, () => { applySystem("impact", true); focus("leftLeg", { duration: 1100 }); }],
      ["trajectory", fast ? 0 : 1500, null],
      ["impact", fast ? 0 : 700, null],
      ["stress", fast ? 0 : 1800, null],
      ["hotspot", fast ? 0 : 1300, () => focus("hotspot", { duration: 1200 })],
      ["done", 0, null],
    ];
    return new Promise(resolve => {
      let index = -1, phaseStart = 0;
      const next = () => { index++; phaseStart = performance.now(); const [name, , enter] = phases[index]; enter?.(); onPhase?.(name); if (name === "done") { sequence = null; sequenceLock = false; resolve(); } };
      sequence = now => {
        const [name, duration] = phases[index], t = duration ? Math.min(1, (now - phaseStart) / duration) : 1;
        if (name === "trajectory") {
          const k = easeInOut(t); impact.path.geometry.setDrawRange(0, Math.max(2, Math.floor(k * 64)));
          impact.tool.position.copy(curve.getPoint(Math.min(1, t * 1.02))); impact.tool.lookAt(impact.world); impact.tool.rotateY(Math.PI / 2);
        } else if (name === "impact") {
          impact.tool.position.copy(impact.world.clone().addScaledVector(impact.normalWorld, .03));
          impact.shock.scale.setScalar(1 + t * 9); impact.shock.material.opacity = (1 - t) * .95; impact.marker.material.opacity = t;
          u.uPulse.value = (1 - t) * .8;
        } else if (name === "stress") {
          u.uRevealRadius.value = easeInOut(t) * 1.1; u.uColor.value.copy(PALETTE.bone);
          impact.tool.children.forEach(child => { child.material.transparent = true; child.material.opacity = .9 - .7 * t; });
        } else if (name === "hotspot") {
          impact.peak.material.opacity = .6 + .4 * Math.sin(now / 160);
        }
        if (t >= 1) next();
      };
      impact.path.geometry.setDrawRange(0, 0); impact.shock.material.opacity = 0; impact.marker.material.opacity = 0; impact.peak.material.opacity = 0;
      impact.tool.position.copy(start); impact.tool.children.forEach(child => { child.material.transparent = true; child.material.opacity = .9; }); next();
    });
  }
  let sequence = null;
  function resetImpact() {
    sequence = null; sequenceLock = false; impact.group.visible = false;
    const tibia = layers.get("tibiaL"); if (tibia) { tibia.material.uniforms.uRevealRadius.value = 0; tibia.material.uniforms.uPulse.value = 0; }
  }
  function showStress(value) {
    const tibia = layers.get("tibiaL"); if (!tibia || !impact.world) return;
    impact.group.visible = value; impact.tool.visible = value; impact.marker.material.opacity = value ? 1 : 0; impact.peak.material.opacity = value ? .9 : 0;
    tibia.material.uniforms.uRevealCenter.value.copy(impact.world); tibia.material.uniforms.uRevealRadius.value = value ? 1.1 : 0;
    if (value && impact.peakWorld) { impact.peak.position.copy(impact.peakWorld); impact.shock.material.opacity = 0; }
  }

  function intro() {
    if (reduceMotion.matches) { shared.sweep.value = 99; return Promise.resolve(); }
    introStart = performance.now(); shared.sweep.value = -1.5;
    return new Promise(resolve => { introResolve = resolve; });
  }
  let introResolve = null;
  function timeTravel() { if (!reduceMotion.matches) scanStart = performance.now(); }

  // Picking: only key structures map to navigation targets.
  const raycaster = new THREE.Raycaster(); raycaster.params.Line.threshold = .03;
  const pointer = new THREE.Vector2(); let downAt = null, lastHover = 0;
  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const muscle = name => KEY_MUSCLES.includes(name);
    const candidates = [...layers.values()].filter(l => l.mesh.visible && l.mesh.userData.pickable && l.material.uniforms.uOpacity.value > (muscle(l.mesh.name) ? .5 : .2)).map(l => l.mesh);
    if (tracks.lines.geometry.drawRange.count > 0 && tracks.material.uniforms.uOpacity.value > .2) candidates.push(tracks.lines);
    const hit = raycaster.intersectObjects(candidates, false)[0];
    return hit ? hit.object.name : null;
  }
  function onPointerDown(event) { downAt = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event) {
    if (!downAt || !ready) return; const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y); downAt = null;
    if (moved > 5) return; const name = pick(event); if (name) onPick?.(name);
  }
  function onPointerMove(event) {
    if (!ready || event.buttons || performance.now() - lastHover < 90) return; lastHover = performance.now();
    const name = pick(event);
    if (name !== hovered) {
      if (hovered) setHover(hovered, 0); hovered = name; if (name) setHover(name, 1);
      canvas.style.cursor = name ? "pointer" : "grab";
    }
    onHover?.(name ? { name, label: PICK_LABELS[name] ?? name, x: event.clientX, y: event.clientY } : null);
  }
  function setHover(name, value) { if (name === "radiation") tracks.material.uniforms.uHover.value = value; else { const l = layers.get(name); if (l) l.material.uniforms.uHover.value = value; } }
  canvas.addEventListener("pointerdown", onPointerDown); canvas.addEventListener("pointerup", onPointerUp); canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", () => { if (hovered) setHover(hovered, 0); hovered = null; onHover?.(null); });
  controls.addEventListener("start", () => { lastInteraction = performance.now(); controls.autoRotate = false; tween = null; });

  function resize() {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(rect.width, rect.height, false); composer.setPixelRatio(pixelRatio); composer.setSize(rect.width, rect.height);
    bloom.resolution.set(rect.width / 2, rect.height / 2); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);

  const projected = new THREE.Vector3(), fpsWindow = []; let lowFpsSince = null, paused = false;
  function project(name) {
    const point = anchors.get(name); if (!point) return null;
    projected.copy(point).project(camera); const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) / 2 * rect.width, y: rect.top + (1 - projected.y) / 2 * rect.height, visible: projected.z < 1 };
  }

  function tick() {
    if (disposed) return; frame = requestAnimationFrame(tick);
    if (document.hidden || paused) return;
    const raw = clock.getDelta(), delta = Math.min(raw, .1), now = performance.now(), elapsed = clock.elapsedTime;
    // Deltas over 250 ms mean the page was throttled in the background, not that rendering is slow.
    if (raw < .25) { fpsWindow.push(raw); if (fpsWindow.length > 90) fpsWindow.shift(); }
    const fps = fpsWindow.length / fpsWindow.reduce((a, b) => a + b, 0); canvas.dataset.fps = fps.toFixed(0);
    // Adaptive quality: lower resolution first, then bloom, if a laptop cannot hold ~30 FPS.
    if (fpsWindow.length === 90 && fps < 30) { lowFpsSince ??= now; if (now - lowFpsSince > 2500) { if (pixelRatio > 1) { pixelRatio = 1; resize(); } else bloom.enabled = false; lowFpsSince = null; fpsWindow.length = 0; } } else lowFpsSince = null;
    if (!sequenceLock && !tween && !compare && !reduceMotion.matches && now - lastInteraction > 6000) controls.autoRotate = true;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.duration), k = easeInOut(t);
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, k); controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (t === 1) tween = null;
    }
    controls.update(delta);
    stepLayers(now); sequence?.(now);
    if (introStart !== null) {
      const t = Math.min(1, (now - introStart) / 2200); shared.sweep.value = -1.4 + easeInOut(t) * 3.2;
      if (t === 1) { introStart = null; shared.sweep.value = 99; introResolve?.(); introResolve = null; }
    }
    if (scanStart !== null) {
      const t = Math.min(1, (now - scanStart) / 900); shared.scanOn.value = Math.sin(t * Math.PI); shared.scanY.value = 1.3 - t * 2.6;
      scanRing.position.set(shiftX, shared.scanY.value, 0); scanRing.material.opacity = shared.scanOn.value * .8; if (t === 1) { scanStart = null; shared.scanOn.value = 0; scanRing.material.opacity = 0; }
    }
    // Heart and vessel pulses at the modeled heart rate.
    if (heartMesh) {
      heartPhase = (heartPhase + delta * heartHz) % 1;
      const beat = heartHz ? Math.exp(-(((heartPhase - .08) / .05) ** 2)) + .45 * Math.exp(-(((heartPhase - .3) / .06) ** 2)) : 0;
      heartMesh.scale.setScalar(1 + beat * .07); layers.get("heart").material.uniforms.uPulse.value = beat * .9;
      shared.waveRadius.value = heartHz ? heartPhase * 1.9 : 99;
    }
    for (const name of ["quadriceps", "hamstrings", "gluteal", "calf"]) { const l = layers.get(name); if (l) l.material.uniforms.uPulse.value = musclePulse; }
    trackCount = lerp(trackCount, trackTarget, Math.min(1, delta * 3));
    tracks.geometry.setDrawRange(0, Math.round(trackCount) * 2);
    tracks.material.uniforms.uTime.value = elapsed; tracks.material.uniforms.uOpacity.value = .55;
    environment.children.forEach(child => { if (child.userData.spin) child.rotation.y += child.userData.spin * delta; });
    environment.rotation.y += delta * .004;
    composer.render(delta);
    onFrame?.(project);
  }
  frame = requestAnimationFrame(tick);

  return {
    load, setState, setSystem, setCompare, setAlerts, focus, intro, timeTravel, playImpact, resetImpact, showStress, setStressField, tibiaPositions,
    get impactWorld() { return impact.world; }, get impactLocal() { return impact.local; }, get impactOutward() { return impact.outwardLocal; },
    setMusclePulse(value) { musclePulse = value; },
    // A host page that hides the twin (the presentation) stops its rendering until it is shown again.
    setPaused(value) { if (paused && !value) clock.getDelta(); paused = Boolean(value); },
    setAutoRotate(value) { controls.autoRotate = value && !reduceMotion.matches; if (!value) lastInteraction = performance.now() + 1e9; else lastInteraction = -1e9; },
    lock(value) { sequenceLock = value; if (value) controls.autoRotate = false; },
    get system() { return system; }, get ready() { return ready; }, project,
    // QA hook: finish pending transitions and draw one frame (background tabs pause requestAnimationFrame).
    renderNow() {
      stepLayers(performance.now() + 1e4); if (tween) { camera.position.copy(tween.toPosition); controls.target.copy(tween.toTarget); tween = null; }
      if (introStart !== null) { introStart = null; shared.sweep.value = 99; introResolve?.(); introResolve = null; }
      controls.update(0); composer.render(0);
    },
    benchmark(frames = 30) {
      const gl = renderer.getContext(), pixel = new Uint8Array(4); composer.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const start = performance.now(); for (let i = 0; i < frames; i++) { controls.update(1 / 60); composer.render(1 / 60); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const ms = (performance.now() - start) / frames; return { msPerFrame: Number(ms.toFixed(2)), fps: Number((1000 / ms).toFixed(0)), pixelRatio, bloom: bloom.enabled, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      scene.traverse(node => { node.geometry?.dispose(); [node.material].flat().forEach(m => m?.dispose()); });
      composer.dispose(); renderer.dispose();
    },
  };
}
