// Registers the offline pack (public/sw.js) in production builds and reports its state.
// Must match CACHE in public/sw.js (src/offlinePack.test.js).
export const OFFLINE_CACHE = "astrobone-offline-v10";

// Resolves once the page has finished its own first load (pageReady settled and the window loaded) and
// the browser is idle, or after maxWait ms whatever happens, so a stalled download never blocks the pack.
export function afterFirstLoad(pageReady, { maxWait = 60000, win = globalThis } = {}) {
  const loaded = win.document?.readyState === "complete" ? null : new Promise(resolve => win.addEventListener("load", resolve, { once: true }));
  let timer;
  const cap = new Promise(resolve => { timer = win.setTimeout(resolve, maxWait); });
  return Promise.race([Promise.allSettled([pageReady, loaded]), cap]).then(() => {
    win.clearTimeout(timer);
    return new Promise(resolve => (win.requestIdleCallback ? win.requestIdleCallback(() => resolve(), { timeout: 3000 }) : win.setTimeout(resolve, 0)));
  });
}

// The pack is about 50 MB. Downloading it while the page is still loading splits a phone's link with
// the twin's own 14 MB: at 9 Mbit/s the twin appeared after 38 s instead of 15 s. So the pack waits for
// the page, then reuses the files the page already downloaded.
export function registerOffline(pageReady = null, options) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return Promise.resolve(null);
  return afterFirstLoad(pageReady, options)
    .then(() => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }))
    .catch(() => null);
}

export async function offlineStatus() {
  const status = { online: navigator.onLine, controlled: Boolean(navigator.serviceWorker?.controller), files: 0, megabytes: null };
  try { status.files = (await (await caches.open(OFFLINE_CACHE)).keys()).length; } catch { /* Cache API unavailable */ }
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate?.usage) status.megabytes = Math.round(estimate.usage / 1048576); } catch { /* not supported */ }
  return status;
}
