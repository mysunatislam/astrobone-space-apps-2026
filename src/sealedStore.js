// Passcode encryption for records saved on this device, with the browser's own Web Crypto:
// PBKDF2-SHA256 turns the passcode into a 256-bit AES-GCM key (600,000 iterations, the OWASP 2023
// figure for PBKDF2-HMAC-SHA256), a fresh 12-byte IV seals every write, and GCM's tag makes a wrong
// passcode or an edited file fail to open rather than read as garbage. The passcode is never stored;
// the derived key stays in memory, non-extractable, until the page locks or closes.
export const SEALED_SCHEMA = "astrobone-sealed-v1";
export const PASSCODE_MIN = 8;
export const PBKDF2_ITERATIONS = 600000;
const AAD = new TextEncoder().encode(SEALED_SCHEMA);

const toBase64 = bytes => { let text = ""; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function passcodeProblem(passcode, repeat = passcode) {
  if (typeof passcode !== "string" || [...passcode].length < PASSCODE_MIN) return `Use at least ${PASSCODE_MIN} characters.`;
  if (passcode !== repeat) return "The two passcodes do not match.";
  return null;
}

// A sealed envelope, checked field by field so a damaged or planted value is refused before any crypto runs.
export function readEnvelope(value) {
  let env = value;
  if (typeof value === "string") { try { env = JSON.parse(value); } catch { return null; } }
  if (env?.schema !== SEALED_SCHEMA || env.kdf !== "PBKDF2-SHA256" || env.cipher !== "AES-GCM-256") return null;
  if (!Number.isInteger(env.iterations) || env.iterations < 100000 || env.iterations > 10000000) return null;
  try {
    const salt = fromBase64(env.salt), iv = fromBase64(env.iv), data = fromBase64(env.data);
    return salt.length === 16 && iv.length === 12 && data.length >= 16 ? { iterations: env.iterations, salt, iv, data } : null;
  } catch { return null; }
}
export const isSealed = value => readEnvelope(value) !== null;

export async function deriveSealKey(passcode, salt, iterations = PBKDF2_ITERATIONS, subtle = globalThis.crypto?.subtle) {
  const base = await subtle.importKey("raw", new TextEncoder().encode(passcode.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function newSeal(passcode, { iterations = PBKDF2_ITERATIONS, subtle = globalThis.crypto?.subtle } = {}) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveSealKey(passcode, salt, iterations, subtle), salt, iterations };
}

export async function sealJson(value, { key, salt, iterations }, subtle = globalThis.crypto?.subtle) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, new TextEncoder().encode(JSON.stringify(value))));
  return { schema: SEALED_SCHEMA, kdf: "PBKDF2-SHA256", iterations, salt: toBase64(salt), cipher: "AES-GCM-256", iv: toBase64(iv), data: toBase64(data) };
}

export async function openSealed(envelope, passcode, subtle = globalThis.crypto?.subtle) {
  const env = readEnvelope(envelope);
  if (!env) throw new Error("These saved checks are damaged and cannot be opened.");
  const key = await deriveSealKey(passcode, env.salt, env.iterations, subtle);
  let plain;
  try { plain = await subtle.decrypt({ name: "AES-GCM", iv: env.iv, additionalData: AAD }, key, env.data); } catch { throw new Error("Wrong passcode."); }
  return { value: JSON.parse(new TextDecoder().decode(plain)), seal: { key, salt: env.salt, iterations: env.iterations } };
}
