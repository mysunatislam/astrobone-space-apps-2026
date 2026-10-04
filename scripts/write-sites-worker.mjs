import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const distDir = join(process.cwd(), "dist");
const serverDir = join(distDir, "server");
await mkdir(serverDir, { recursive: true });

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function toWebPath(filePath) {
  return `/${relative(distDir, filePath).split(sep).join("/")}`;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function addFile(assetMap, filePath) {
  const bytes = await readFile(filePath);
  const webPath = toWebPath(filePath);
  assetMap[webPath] = {
    body: bytes.toString("base64"),
    cacheControl: webPath === "/index.html"
      ? "no-store"
      : "public, max-age=31536000, immutable",
    contentType: contentTypeFor(filePath),
  };
}

const embeddedAssets = {};
await addFile(embeddedAssets, join(distDir, "index.html"));

for (const relativeDir of ["assets", join("inference", "demo")]) {
  const absoluteDir = join(distDir, relativeDir);
  for (const filePath of await collectFiles(absoluteDir)) {
    await addFile(embeddedAssets, filePath);
  }
}

const workerSource = `const EMBEDDED_ASSETS = ${JSON.stringify(embeddedAssets)};

const INDEX_PATH = "/index.html";

function decodeBase64(body) {
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function embeddedResponse(pathname, request) {
  const normalizedPath = pathname === "/" ? INDEX_PATH : pathname;
  const asset = EMBEDDED_ASSETS[normalizedPath];
  if (!asset) return null;

  const headers = new Headers({
    "cache-control": asset.cacheControl,
    "content-type": asset.contentType,
  });
  const body = request.method === "HEAD" ? null : decodeBase64(asset.body);
  return new Response(body, { status: 200, headers });
}

function shouldUseHtmlFallback(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/html")) return false;
  const pathname = new URL(request.url).pathname;
  return !pathname.split("/").pop()?.includes(".");
}

async function fetchAsset(env, request) {
  if (!env?.ASSETS?.fetch) {
    return new Response("AstroBone static asset binding is unavailable.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const embedded = embeddedResponse(url.pathname, request);
    if (embedded) return embedded;

    const response = await fetchAsset(env, request);
    if (response.status !== 404) return response;

    if (shouldUseHtmlFallback(request)) {
      const fallback = embeddedResponse(INDEX_PATH, request);
      if (fallback) return fallback;
    }

    return response;
  },
};
`;

await writeFile(join(serverDir, "index.js"), workerSource, "utf8");
