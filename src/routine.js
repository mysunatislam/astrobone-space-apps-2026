// The self-check as part of the mission routine: what to measure when, when the next check is due,
// and a streak with badges. Badges reward the habit (checking daily, completing every part, repeating
// a measurement that failed its quality check), never a health value, so nobody is nudged to report a
// better number.
export const ROUTINE = Object.freeze([
  { id: "wake", when: "On waking, before breakfast", items: ["Blood sugar (fasting)", "Body temperature"], step: "body" },
  { id: "rest", when: "After 5 minutes seated", items: ["Blood pressure", "Resting pulse", "Oxygen saturation"], step: "body" },
  { id: "tests", when: "Same time every day", items: ["Knee test", "3-minute reaction test", "Sleep and mood"], step: "movement" },
]);

export const CHECK_INTERVAL_H = 24;
const DAY_MS = 86400e3;
// Local calendar day number, so a check at 23:00 and one at 07:00 the next morning are two days.
export const dayNumber = (date = new Date()) => { const d = new Date(date); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60e3) / DAY_MS); };

export const BADGES = Object.freeze([
  { id: "first", label: "First check", detail: "Saved your first self-check" },
  { id: "baseline", label: "Baseline built", detail: "3 checks: comparisons can start" },
  { id: "full", label: "Full check", detail: "Measured every domain in one check" },
  { id: "quality", label: "Quality first", detail: "Repeated a measurement that failed its quality check" },
  { id: "week", label: "7-day streak", detail: "Checked 7 days in a row" },
  { id: "month", label: "30-day streak", detail: "Checked 30 days in a row" },
]);

// checks: [{ day, complete, repeatedAfterFail }] on any day numbering (calendar or mission days).
export function routineStatus(checks, today) {
  const days = [...new Set(checks.map(c => c.day))].sort((a, b) => a - b);
  const done = new Set(days), doneToday = done.has(today);
  let streak = 0;
  for (let d = doneToday ? today : today - 1; done.has(d); d--) streak++;
  let longest = 0, run = 0;
  days.forEach((d, i) => { run = i && d === days[i - 1] + 1 ? run + 1 : 1; longest = Math.max(longest, run); });
  const earned = {
    first: days.length >= 1, baseline: days.length >= 3, full: checks.some(c => c.complete), quality: checks.some(c => c.repeatedAfterFail),
    week: longest >= 7, month: longest >= 30,
  };
  return { total: days.length, doneToday, streak, longest, lastDay: days.at(-1) ?? null, badges: BADGES.map(b => ({ ...b, earned: earned[b.id] })) };
}

// When the next check is due: 24 h after the last saved one.
export function nextDue(lastAt, now = new Date()) {
  if (!lastAt) return { dueAt: null, overdueH: 0, label: "Start your first check now" };
  const dueAt = new Date(new Date(lastAt).getTime() + CHECK_INTERVAL_H * 3600e3), overdueH = (now - dueAt) / 3600e3;
  return { dueAt, overdueH: Math.max(0, overdueH), label: overdueH > 0 ? `Overdue by ${Math.round(overdueH)} h` : `Next check due ${dueAt.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` };
}

// Badges a newly saved check unlocked: compare the status before and after it.
export const newBadges = (before, after) => after.badges.filter(b => b.earned && !before.badges.find(x => x.id === b.id)?.earned);
