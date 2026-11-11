// Expands events (including repeating ones) into concrete occurrences.
// Shared by the app (browser) and the reminder sender (Node).
//
// Event shape:
//   { id, title, calendarId, allDay,
//     start, end,            // timed: ISO strings; all-day: "YYYY-MM-DD" (end inclusive)
//     recurrence: null | { freq: 'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY', interval,
//                          byDay: [0-6] (weekly), monthlyMode: 'day'|'nth', nth (1-5|-1),
//                          until: "YYYY-MM-DD" | null, count: number | null },
//     exdates: ["YYYY-MM-DD", ...],   // skipped occurrences (by local start date)
//     reminders: [minutes, ...], location, notes }

import {
  DAY_MS, toDateKey, fromDateKey, addDays, startOfDay, daysInMonth,
  nthWeekdayOfMonth, diffDays, fmt, ordinal, weekdayNames,
} from './dates.js';

export function eventBounds(ev) {
  if (ev.allDay) {
    const s = fromDateKey(ev.start);
    return { start: s, end: addDays(fromDateKey(ev.end || ev.start), 1) };
  }
  const s = new Date(ev.start);
  let e = new Date(ev.end || ev.start);
  if (e < s) e = s;
  return { start: s, end: e };
}

function occ(ev, start, end) {
  const key = toDateKey(start);
  return {
    id: ev.recurrence ? `${ev.id}_${key}` : ev.id,
    event: ev, start, end, key, allDay: !!ev.allDay,
  };
}

/** All occurrences of `ev` that overlap [rangeStart, rangeEnd). */
export function expandEvent(ev, rangeStart, rangeEnd) {
  const { start, end } = eventBounds(ev);
  const rec = ev.recurrence;
  if (!rec || !rec.freq) {
    return end > rangeStart && start < rangeEnd ? [occ(ev, start, end)] : [];
  }

  const out = [];
  const ex = new Set(ev.exdates || []);
  const durMs = end - start;
  const durDays = diffDays(start, end);
  const h = start.getHours(), mi = start.getMinutes();
  const until = rec.until ? addDays(fromDateKey(rec.until), 1) : null; // exclusive
  const count = rec.count > 0 ? rec.count : Infinity;
  const interval = Math.max(1, Number(rec.interval) || 1);
  const base = startOfDay(start);
  let n = 0;

  // Returns false when iteration should stop.
  const emit = (day) => {
    if (n >= count) return false;
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi);
    if (until && s >= until) return false;
    if (s >= rangeEnd) return false;
    n++;
    const e = ev.allDay ? addDays(s, durDays) : new Date(s.getTime() + durMs);
    if (e > rangeStart && !ex.has(toDateKey(s))) out.push(occ(ev, s, e));
    return true;
  };
  const pastEnd = (d) => d >= rangeEnd || (until && d >= until);

  // When there's no count limit we can jump close to the range instead of
  // walking from the very first occurrence.
  const canSkip = count === Infinity;
  const lookback = rangeStart.getTime() - durMs - 2 * DAY_MS;
  let guard = 0;
  const MAX = 50000;

  switch (rec.freq) {
    case 'DAILY': {
      let k = canSkip ? Math.max(0, Math.floor((lookback - base) / (interval * DAY_MS))) : 0;
      while (guard++ < MAX && emit(addDays(base, k * interval))) k++;
      break;
    }
    case 'WEEKLY': {
      const days = (rec.byDay && rec.byDay.length ? [...rec.byDay] : [start.getDay()]).sort((a, b) => a - b);
      const week0 = addDays(base, -base.getDay());
      let w = canSkip ? Math.max(0, Math.floor((lookback - week0) / (interval * 7 * DAY_MS))) : 0;
      outer: while (guard++ < MAX) {
        const ws = addDays(week0, w * 7 * interval);
        if (pastEnd(ws)) break;
        for (const d of days) {
          const day = addDays(ws, d);
          if (day < base) continue;
          if (!emit(day)) break outer;
        }
        w++;
      }
      break;
    }
    case 'MONTHLY': {
      const dom = start.getDate();
      const wd = start.getDay();
      const nth = rec.nth || 1;
      let k = 0;
      if (canSkip) {
        const ls = new Date(lookback);
        const months = (ls.getFullYear() - base.getFullYear()) * 12 + ls.getMonth() - base.getMonth();
        k = Math.max(0, Math.floor(months / interval) - 1);
      }
      while (guard++ < MAX) {
        const first = new Date(base.getFullYear(), base.getMonth() + k * interval, 1);
        if (pastEnd(first)) break;
        let day = null;
        if (rec.monthlyMode === 'nth') day = nthWeekdayOfMonth(first.getFullYear(), first.getMonth(), nth, wd);
        else if (dom <= daysInMonth(first.getFullYear(), first.getMonth())) day = new Date(first.getFullYear(), first.getMonth(), dom);
        if (day && day >= base && !emit(day)) break;
        k++;
      }
      break;
    }
    case 'YEARLY': {
      const m = start.getMonth(), dom = start.getDate();
      let k = canSkip ? Math.max(0, Math.floor((new Date(lookback).getFullYear() - base.getFullYear()) / interval) - 1) : 0;
      while (guard++ < MAX) {
        const y = base.getFullYear() + k * interval;
        if (pastEnd(new Date(y, 0, 1))) break;
        if (dom <= daysInMonth(y, m) && !emit(new Date(y, m, dom))) break;
        k++;
      }
      break;
    }
    default:
      if (end > rangeStart && start < rangeEnd) out.push(occ(ev, start, end));
  }
  return out;
}

/** Expand many events and sort by start (all-day first on ties). */
export function expandAll(events, rangeStart, rangeEnd) {
  const out = [];
  for (const ev of events) out.push(...expandEvent(ev, rangeStart, rangeEnd));
  out.sort((a, b) => a.start - b.start || (b.allDay - a.allDay) || (b.end - a.end));
  return out;
}

/** Human description, e.g. "Every 2 weeks on Tuesday, Thursday, until Dec 1, 2026". */
export function describeRecurrence(rec, start) {
  if (!rec || !rec.freq) return 'Does not repeat';
  const iv = Math.max(1, rec.interval || 1);
  const days = weekdayNames('long');
  let text;
  switch (rec.freq) {
    case 'DAILY': text = iv === 1 ? 'Daily' : `Every ${iv} days`; break;
    case 'WEEKLY': {
      const bd = (rec.byDay && rec.byDay.length ? [...rec.byDay] : [start.getDay()]).sort();
      const names = bd.join() === '1,2,3,4,5' ? 'weekdays' : bd.map((d) => days[d]).join(', ');
      text = `${iv === 1 ? 'Weekly' : `Every ${iv} weeks`} on ${names}`;
      break;
    }
    case 'MONTHLY': {
      const what = rec.monthlyMode === 'nth'
        ? `on the ${rec.nth === -1 ? 'last' : ordinal(rec.nth || 1)} ${days[start.getDay()]}`
        : `on day ${start.getDate()}`;
      text = `${iv === 1 ? 'Monthly' : `Every ${iv} months`} ${what}`;
      break;
    }
    case 'YEARLY':
      text = `${iv === 1 ? 'Annually' : `Every ${iv} years`} on ${fmt(start, { month: 'long', day: 'numeric' })}`;
      break;
    default: text = 'Repeats';
  }
  if (rec.until) text += `, until ${fmt(fromDateKey(rec.until), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  else if (rec.count) text += `, ${rec.count} times`;
  return text;
}

/** When a reminder fires. All-day events remind relative to 9:00 AM on the day. */
export function reminderTime(o, minutes) {
  const anchor = o.allDay
    ? new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate(), 9, 0)
    : o.start;
  return new Date(anchor.getTime() - minutes * 60000);
}
