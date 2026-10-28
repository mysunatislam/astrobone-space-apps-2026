// Usage: node scripts/throttled-server.mjs <root containing astrobone-space-apps-2026/> <port> <Mbit/s> <round trip ms> [log file]
// Static server behind one shared bottleneck link: every response draws from a single token bucket
// (bytes/s) and waits one round trip first, like a phone on mobile data. Logs bytes per path.
import http from "node:http";
import { createReadStream, statSync, existsSync, appendFileSync } from "node:fs";
import { join, extname } from "node:path";
const [root, port, mbps, rttMs, logFile] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5] ?? 60), process.argv[6]];
const rate = (mbps * 1e6) / 8; // bytes per second
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".png": "image/png", ".task": "application/octet-stream", ".tflite": "application/octet-stream", ".txt": "text/plain", ".onnx": "application/octet-stream", ".bin": "application/octet-stream", ".mp4": "video/mp4", ".svg": "image/svg+xml" };
let tokens = 0, last = Date.now();
const waiters = [];
function refill() { const now = Date.now(); tokens = Math.min(rate * 0.05, tokens + ((now - last) / 1000) * rate); last = now; }
// Grant chunks round-robin so parallel downloads share the link.
setInterval(() => { refill(); while (tokens > 0 && waiters.length) { const w = waiters.shift(); const n = Math.min(w.want, Math.max(1, Math.floor(tokens))); tokens -= n; w.grant(n); } }, 5);
const take = want => new Promise(grant => waiters.push({ want, grant }));
http.createServer(async (req, res) => {
  const t0 = Date.now();
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = join(root, path);
  if (path.endsWith("/")) file = join(file, "index.html");
  await new Promise(r => setTimeout(r, rttMs));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = statSync(file).size;
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Length": size, "Cache-Control": "max-age=600" });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file, { highWaterMark: 16384 });
  for await (const chunk of stream) {
    let off = 0;
    while (off < chunk.length) { const n = await take(Math.min(16384, chunk.length - off)); const ok = res.write(chunk.subarray(off, off + n)); off += n; if (!ok) await new Promise(r => res.once("drain", r)); }
  }
  res.end();
  if (logFile) appendFileSync(logFile, `${Date.now()} ${Date.now() - t0}ms ${size} ${req.headers["service-worker"] ? "SW " : ""}${path}\n`);
}).listen(port, "127.0.0.1");
