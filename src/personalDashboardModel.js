import { INDICATORS, personalReference } from './selfCheck.js';
import { followUpBucket } from './followUps.js';
const KEYS = ['restingHr', 'systolicBp', 'sleepHours', 'mood', 'bodyTemp', 'glucose'];
const STATUS = { urgent: 'Contact now', attention: 'Contact today', changed: 'Review change', recheck: 'Recheck', repeat: 'Repeat capture', baseline: 'Building baseline', stable: 'Within usual range', notChecked: 'Not checked' };
const dateLabel = at => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'No saved check';
export function personalDashboardModel(snapshot = {}, now = Date.now()) {
  const locked = Boolean(snapshot?.locked), history = locked ? [] : (snapshot?.history ?? []), check = locked ? null : snapshot?.latestCheck;
  const evaluation = locked ? null : snapshot?.evaluation;
  const tasks = locked ? [] : (snapshot?.followUps ?? []).filter(task => task.status !== 'completed').map(task => ({ ...task, label: followUpBucket(task, now), due: task.dueAt ? 'Due ' + dateLabel(task.dueAt) : 'Review according to your mission procedure' }));
  const indicators = KEYS.map(key => {
    const def = INDICATORS[key], reading = evaluation?.domains?.flatMap(d => d.indicators ?? []).find(r => r.key === key);
    const usable = !locked && check?.quality?.[key] !== false && Number.isFinite(check?.values?.[key]);
    const earlier = history.filter(row => row.id !== check?.id && Date.parse(row.at) < Date.parse(check?.at));
    const ref = check ? personalReference(earlier, key, check.protocols?.[key]) : { count: 0, needed: 3, ready: false };
    const protocol = check?.protocols?.[key] ?? '';
    const source = /camera|rppg/i.test(protocol) ? 'Camera estimate' : def.source === 'SELF-REPORT' ? 'Self-report' : 'Entered instrument reading';
    return { key, label: key === 'systolicBp' ? 'Systolic blood pressure' : def.label,
      value: usable ? Number(check.values[key]).toFixed(def.digits ?? 0) + (def.unit ? ' ' + def.unit : '') : '—',
      status: usable ? reading?.status ?? 'baseline' : check?.quality?.[key] === false ? 'repeat' : 'notChecked',
      statusLabel: usable ? STATUS[reading?.status] ?? 'Recorded' : check?.quality?.[key] === false ? 'Quality failed · withheld' : 'Not measured',
      detail: usable ? source + ' · ' + (ref.ready ? ref.count + ' prior comparable readings' : ref.count + '/3 prior comparable readings') : 'Add a usable observation in Self-Check.' };
  });
  return { locked, persist: Boolean(snapshot?.persist), checkCount: history.length, openCount: tasks.length, tasks, indicators,
    summary: locked ? 'Personal observations are hidden while your record is locked.' : check ? 'Latest saved check · ' + dateLabel(check.at) : 'Your first usable observations will appear here. No demo values are shown.' };
}
