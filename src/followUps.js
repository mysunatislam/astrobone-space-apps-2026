// Durable user-selected actions retain the source check; changing a task never changes a reading.
export const FOLLOW_UP_STATUSES = Object.freeze(['open', 'recheck', 'awaiting-review', 'completed']);
export const FOLLOW_UP_LABELS = Object.freeze({ open: 'Due', recheck: 'Recheck', 'awaiting-review': 'Awaiting review', completed: 'Completed' });
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function normalizeFollowUps(items, checkId, at) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.slice(0, 100).flatMap(item => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id.slice(0, 160)) || typeof item.text !== 'string' || !item.text.trim()) return [];
    seen.add(item.id.slice(0, 160));
    return [{ id: item.id.slice(0, 160), sourceCheckId: checkId, sourceAt: at, text: item.text.slice(0, 3000), priority: ['urgent','attention','review','repeat','info'].includes(item.priority) ? item.priority : 'info',
      recordedAt: date(item.recordedAt) ? item.recordedAt : at, dueAt: date(item.dueAt) ? item.dueAt : null,
      status: FOLLOW_UP_STATUSES.includes(item.status) ? item.status : 'open', updatedAt: date(item.updatedAt) ? item.updatedAt : at,
      completedAt: item.status === 'completed' && date(item.completedAt) ? item.completedAt : null }];
  });
}
export function selectedFollowUps(actions, checkId, at = new Date().toISOString()) {
  return normalizeFollowUps(actions.map(action => ({ ...action, recordedAt: at, updatedAt: at,
    dueAt: Number.isFinite(action.due) && action.due >= 0 ? new Date(Date.parse(at) + action.due * 3600000).toISOString() : null,
    status: /repeat|recheck/.test(action.id) ? 'recheck' : 'open' })), checkId, at);
}
export function followUpsFor(checks) {
  return checks.flatMap(check => normalizeFollowUps(check.followUps, check.id, check.at)).sort((a, b) => {
    if ((a.status === 'completed') !== (b.status === 'completed')) return a.status === 'completed' ? 1 : -1;
    return (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
  });
}
export function updateFollowUpStatus(checks, checkId, actionId, status, at = new Date().toISOString()) {
  if (!FOLLOW_UP_STATUSES.includes(status) || !date(at)) throw new Error('Choose a valid follow-up status.');
  let changed = false;
  const updated = checks.map(check => {
    if (check.id !== checkId) return check;
    let changedCheck = false;
    const tasks = normalizeFollowUps(check.followUps, check.id, check.at).map(task => {
      if (task.id !== actionId || task.status === status) return task;
      changed = true; changedCheck = true;
      return { ...task, status, updatedAt: at, completedAt: status === 'completed' ? at : null };
    });
    return changedCheck ? { ...check, followUps: tasks } : check;
  });
  return { checks: updated, changed };
}
export function followUpBucket(task, now = Date.now()) {
  if (task.status === 'completed') return 'Completed';
  if (task.status === 'awaiting-review') return 'Awaiting review';
  if (task.status === 'recheck') return 'Recheck';
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return task.dueAt && Date.parse(task.dueAt) <= end.getTime() ? 'Due today' : 'Upcoming';
}
