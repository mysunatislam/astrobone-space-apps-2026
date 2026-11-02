import { createSelfCheckStore, backupPacket, restoreBackup } from './selfCheck.js';
import { openSealed, SEALED_SCHEMA } from './sealedStore.js';
import { normalizeRespiratoryRecord } from './respiratoryHistory.js';
export const HEALTH_BACKUP_SCHEMA = 'astrobone-health-backup-v2';
const PROFILE_KEY = 'astrobone-active-profile';
const CONSENT_KEY = 'astrobone-self-check-consent';
const STORE_KEY = 'astrobone-self-check-v1';
const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
const read = key => { try { return storage()?.getItem(key); } catch { return null; } };
let selected = read(PROFILE_KEY) === 'elena' ? 'elena' : 'you';
let consent = read(CONSENT_KEY) === '1';
let singleton;
function emit(name, detail) { if (typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent(name, { detail })); }
export function notifyHealthRecordsChanged() { emit('astrobone-records-change', {}); }
export function getHealthRecordStore() { return singleton ??= createSelfCheckStore(storage(), STORE_KEY); }
export function getHealthConsent() { return consent; }
export function setHealthConsent(value) { consent = Boolean(value); try { storage()?.setItem(CONSENT_KEY, consent ? '1' : '0'); } catch {} notifyHealthRecordsChanged(); }
export function getActiveProfile() { return selected; }
export function setActiveProfile(profile) {
  if (!['you', 'elena'].includes(profile) || profile === selected) return;
  selected = profile; try { storage()?.setItem(PROFILE_KEY, profile); } catch {}
  emit('astrobone-profile-change', { profile });
}
export async function healthBackup(store = getHealthRecordStore(), persist = getHealthConsent()) {
  await store.flush();
  if (persist && store.sealed()) return store.encryptedBackup();
  return { schema: HEALTH_BACKUP_SCHEMA, exportedAt: new Date().toISOString(), checks: store.load('you', persist), respiratory: store.load('respiratory:you', persist), encrypted: false };
}
export async function restoreHealthBackup(packet, { store = getHealthRecordStore(), persist = getHealthConsent(), passcode } = {}) {
  if (persist && store.locked()) throw new Error('Unlock the saved health record first.');
  let incoming = packet;
  if (packet?.schema === SEALED_SCHEMA) {
    if (!passcode) throw new Error('Enter the backup passcode.');
    const opened = await openSealed(packet, passcode);
    incoming = { schema: HEALTH_BACKUP_SCHEMA, checks: opened.value?.you ?? [], respiratory: opened.value?.['respiratory:you'] ?? [] };
  }
  const combined = incoming?.schema === HEALTH_BACKUP_SCHEMA;
  const restored = restoreBackup(store.load('you', persist), combined ? backupPacket(incoming.checks ?? []) : incoming);
  const current = store.load('respiratory:you', persist);
  const incomingResp = combined && Array.isArray(incoming.respiratory) ? incoming.respiratory : [];
  const ids = new Set(current.map(r => r.captureId || r.id));
  const respiratory = [...current];
  for (const raw of incomingResp.slice(0, 10000)) {
    const value = normalizeRespiratoryRecord(raw);
    if (value && !ids.has(value.captureId || value.id)) { ids.add(value.captureId || value.id); respiratory.push(value); }
  }
  if (!store.saveMany({ you: restored.checks, 'respiratory:you': respiratory }, persist)) throw new Error('The backup could not be saved.');
  await store.flush(); if (store.writeFailed) throw new Error('The backup did not reach device storage.');
  notifyHealthRecordsChanged();
  return { added: restored.added, respiratoryAdded: respiratory.length - current.length, skipped: restored.skipped };
}
globalThis.addEventListener?.('storage', event => {
  if (event.key === STORE_KEY || event.key === null) { singleton?.lock(); notifyHealthRecordsChanged(); }
  if (event.key === CONSENT_KEY || event.key === null) { consent = read(CONSENT_KEY) === '1'; notifyHealthRecordsChanged(); }
  if (event.key === PROFILE_KEY) { const profile = read(PROFILE_KEY) === 'elena' ? 'elena' : 'you'; if (profile !== selected) { selected = profile; emit('astrobone-profile-change', { profile }); } }
});
