// Registers the offline pack (public/sw.js) in production builds and reports its state.
export const OFFLINE_CACHE = "astrobone-offline-v3";

export function registerOffline() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => null);
}

export async function offlineStatus() {
  const status = { online: navigator.onLine, controlled: Boolean(navigator.serviceWorker?.controller), files: 0, megabytes: null };
  try { status.files = (await (await caches.open(OFFLINE_CACHE)).keys()).length; } catch { /* Cache API unavailable */ }
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate?.usage) status.megabytes = Math.round(estimate.usage / 1048576); } catch { /* not supported */ }
  return status;
}
