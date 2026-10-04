// AstroBone offline pack. After one online visit, the twin (home), Live Capture, the pitch and their
// models, NASA summaries and pose runtime are served from this device's cache.
const CACHE = "astrobone-offline-v4";
const CORE = [
  "./", "lab.html", "pitch.html", "clip.html",
  "models/anatomy/musculoskeletal.glb", "models/anatomy/musculoskeletal-rigged.glb", "models/anatomy/cardiovascular.glb", "models/anatomy/SOURCE-LICENSE.txt",
  "models/pose_landmarker_lite.task",
  "mediapipe/vision_wasm_internal.js", "mediapipe/vision_wasm_internal.wasm",
  "mediapipe/vision_wasm_nosimd_internal.js", "mediapipe/vision_wasm_nosimd_internal.wasm",
  "mediapipe/vision_wasm_module_internal.js", "mediapipe/vision_wasm_module_internal.wasm",
  "simulations/astrobone-level-a-v1.json",
  "data/mission-research.json", "data/mission-research-extended.json", "data/osdr-804-summary.json", "data/circulation-reference.json",
  "inference/demo/IMG0001739_prediction.json", "inference/demo/IMG0001739_overlay.png",
  "pitch/broll-bone-loss.mp4", "pitch/concept-camera-baseline.mp4", "pitch/squat-pexels-4921644.mp4", "pitch/squat-pose.json", "pitch/challenge-details.mp4",
  "pitch/team-mysunat.webp", "pitch/team-redwan.webp", "pitch/team-borno.jpg",
];
const scope = new URL(self.registration.scope);
const url = path => new URL(path, scope).href;

// Hashed build assets are discovered from the pages and their bundles (including worker chunks).
async function discover(cache) {
  const found = new Set();
  const scan = async (href, depth) => {
    try {
      const response = await fetch(href, { cache: "no-cache" });
      if (!response.ok) return;
      await cache.put(href, response.clone());
      if (depth > 1) return;
      const text = await response.text();
      for (const match of text.matchAll(/(?:\.\/|\/)?assets\/[\w.-]+\.(?:js|css|wasm)/g)) {
        const asset = url(match[0].replace(/^\.?\//, "").replace(/^.*?assets\//, "assets/"));
        if (!found.has(asset)) { found.add(asset); await scan(asset, depth + 1); }
      }
    } catch { /* offline during install: runtime caching fills in later */ }
  };
  for (const page of ["./", "lab.html", "pitch.html", "clip.html"]) await scan(url(page), 0);
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(path => cache.add(url(path))));
    await discover(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Media elements request byte ranges; answer them from the cached full file.
async function rangeResponse(request, response) {
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  if (!match) return response;
  const blob = await response.blob(), size = blob.size;
  const start = match[1] ? Number(match[1]) : size - Number(match[2]);
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  return new Response(blob.slice(start, end + 1), { status: 206, statusText: "Partial Content",
    headers: { "Content-Type": response.headers.get("Content-Type") || "video/mp4", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" } });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(scope.origin)) return;
  const cacheKey = request.url.split("#")[0];
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Pages: network first so updates arrive, cache when offline.
    if (request.mode === "navigate") {
      try { const fresh = await fetch(request); cache.put(cacheKey.split("?")[0], fresh.clone()); return fresh; }
      catch { return (await cache.match(cacheKey.split("?")[0])) || (await cache.match(url("./"))) || Response.error(); }
    }
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    if (cached) {
      if (request.headers.has("range")) return rangeResponse(request, cached);
      // Refresh unhashed files quietly in the background.
      if (!/\/assets\//.test(cacheKey)) event.waitUntil(fetch(request).then(r => r.ok && r.status === 200 && cache.put(cacheKey, r)).catch(() => {}));
      return cached;
    }
    try {
      const fresh = await fetch(request);
      if (fresh.ok && fresh.status === 200) event.waitUntil(cache.put(cacheKey, fresh.clone()));
      return fresh;
    } catch { return Response.error(); }
  })());
});

// Lets a page ask how much is available offline.
self.addEventListener("message", event => {
  if (event.data?.type !== "status") return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE), keys = await cache.keys();
    event.source?.postMessage({ type: "status", files: keys.length });
  })());
});
