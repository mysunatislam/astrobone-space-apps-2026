import { Capacitor } from "@capacitor/core";
import { validateImageEvidence, validateXrayFile } from "./imageEvidence.js";

const DEFAULT_TIMEOUT_MS = 4_000;
const ANALYSIS_TIMEOUT_MS = 120_000;
export const ASTROBONE_API_STORAGE_KEY = "astrobone.apiBaseUrl";

export class XrayApiClient {
  constructor(baseUrl = resolveApiBaseUrl()) {
    this.baseUrl = "";
    this.setBaseUrl(baseUrl);
  }

  setBaseUrl(baseUrl, { persist = false } = {}) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl, {
      requireHttps: Capacitor.isNativePlatform(),
    });
    if (persist) persistApiBaseUrl(this.baseUrl);
    return this.baseUrl;
  }

  clearBaseUrl({ persist = false } = {}) {
    this.baseUrl = "";
    if (persist && typeof localStorage !== "undefined") {
      localStorage.removeItem(ASTROBONE_API_STORAGE_KEY);
    }
  }

  async getHealth() {
    this.ensureConfigured();
    return requestJson(`${this.baseUrl}/api/v1/health`, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  async analyze(file, targetRegion) {
    this.ensureConfigured();
    validateXrayFile(file);
    const form = new FormData();
    form.append("image", file, file.name);
    form.append("target_region", targetRegion);
    const payload = await requestJson(`${this.baseUrl}/api/v1/xray/analyze`, {
      method: "POST",
      body: form,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    });
    return validateImageEvidence(payload);
  }

  ensureConfigured() {
    if (this.baseUrl) return;
    throw new Error(
      Capacitor.isNativePlatform()
        ? "Configure a reachable HTTPS AI service. The verified held-out case remains available offline."
        : "The local AI service URL is not configured.",
    );
  }
}

export function resolveApiBaseUrl() {
  const configured = import.meta.env?.VITE_ASTROBONE_API_BASE?.trim();
  if (configured) return configured;
  const persisted = readPersistedApiBaseUrl();
  if (persisted) return persisted;
  if (Capacitor.isNativePlatform()) return "";
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  if (window.location.port === "8000") return window.location.origin;
  return "http://127.0.0.1:8000";
}

export function normalizeApiBaseUrl(value, { requireHttps = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new TypeError("Enter a complete AI service URL, including https://.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new TypeError("The AI service URL must use HTTP or HTTPS.");
  }
  if (requireHttps && parsed.protocol !== "https:") {
    throw new TypeError("Android AI service connections must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("Do not include credentials in the AI service URL.");
  }
  if (parsed.search || parsed.hash) {
    throw new TypeError("The AI service URL cannot include a query or fragment.");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

function readPersistedApiBaseUrl() {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(ASTROBONE_API_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function persistApiBaseUrl(value) {
  if (typeof localStorage === "undefined") return;
  if (value) {
    localStorage.setItem(ASTROBONE_API_STORAGE_KEY, value);
  } else {
    localStorage.removeItem(ASTROBONE_API_STORAGE_KEY);
  }
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.detail || `Local AI service returned HTTP ${response.status}.`);
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The local AI service did not respond in time.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
