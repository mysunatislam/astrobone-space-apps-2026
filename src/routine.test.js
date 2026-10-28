import test from "node:test";
import assert from "node:assert/strict";
import { routineStatus, nextDue, newBadges, dayNumber, ROUTINE, BADGES } from "./routine.js";
import { ELENA_CHECK_DAYS } from "./elenaSelfCheck.js";

const days = list => list.map(day => ({ day }));

test("the streak counts consecutive days up to today, or up to yesterday before today's check", () => {
  assert.equal(routineStatus(days([8, 9, 10]), 10).streak, 3);
  assert.equal(routineStatus(days([8, 9]), 10).streak, 2, "today's check not done yet: the streak is still alive");
  assert.equal(routineStatus(days([7, 8]), 10).streak, 0, "a missed day breaks it");
  assert.equal(routineStatus(days([1, 2, 3, 5, 6]), 6).longest, 3);
  assert.equal(routineStatus(days([4, 4, 4]), 4).total, 1, "several checks in a day count once");
});

test("badges reward doing the checks, never a value", () => {
  const status = routineStatus([...days([1, 2, 3, 4, 5, 6, 7]), { day: 7, complete: true, repeatedAfterFail: true }], 7);
  assert.deepEqual(status.badges.filter(b => b.earned).map(b => b.id), ["first", "baseline", "full", "quality", "week"]);
  for (const badge of BADGES) assert.doesNotMatch(badge.detail, /good|better|healthy|normal|improv/i);
  const before = routineStatus(days([1, 2]), 3), after = routineStatus(days([1, 2, 3]), 3);
  assert.deepEqual(newBadges(before, after).map(b => b.id), ["baseline"]);
});

test("the next check is due 24 h after the last one", () => {
  const due = nextDue("2026-11-14T07:00:00Z", new Date("2026-11-15T09:00:00Z"));
  assert.equal(due.dueAt.toISOString(), "2026-11-15T07:00:00.000Z");
  assert.equal(due.overdueH, 2);
  assert.match(due.label, /Overdue by 2 h/);
  assert.equal(nextDue(null).dueAt, null);
  assert.equal(dayNumber(new Date(2026, 10, 14, 23, 0)) + 1, dayNumber(new Date(2026, 10, 15, 7, 0)));
});

test("the routine names when each measurement belongs, and Elena's synthetic log gives a 15-day streak", () => {
  assert.ok(ROUTINE.some(slot => slot.items.some(i => /fasting/i.test(i))));
  const elena = routineStatus(ELENA_CHECK_DAYS.map(day => ({ day })), 147);
  assert.deepEqual([elena.streak, elena.longest, elena.doneToday], [15, 53, false]);
  assert.equal(routineStatus([...ELENA_CHECK_DAYS.map(day => ({ day })), { day: 147 }], 147).streak, 16);
});
