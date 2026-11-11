// Pure logic for the reminder sender (no Firebase here, so it can be tested).
// IMPORTANT: process.env.TZ must be set to the user's time zone before calling,
// because repeat rules and "9am" for all-day events use local time.

import { expandEvent, reminderTime } from '../js/recurrence.js';
import { humanizeMinutes } from '../js/dates.js';

export const HORIZON_MS = 48 * 3600 * 1000; // how far ahead each queue build looks
export const LATE_MS = 30 * 60 * 1000;      // still send reminders up to 30 min late

function timeFmt(tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}
function dayFmt(tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
}

function bodyFor(o, minutes, tz) {
  const ev = o.event;
  const tf = timeFmt(tz), df = dayFmt(tz);
  let when;
  if (o.allDay) {
    when = minutes === 0 ? 'Today' : minutes === 1440 ? 'Tomorrow' : df.format(o.start);
    when += ' · All day';
  } else {
    const lead = minutes === 0 ? 'Now' : `In ${humanizeMinutes(minutes)}`;
    const sameDay = df.format(o.start) === df.format(o.end);
    const range = sameDay ? `${tf.format(o.start)} – ${tf.format(o.end)}` : `${df.format(o.start)} ${tf.format(o.start)} – ${df.format(o.end)} ${tf.format(o.end)}`;
    when = `${lead} · ${minutes >= 1440 ? `${df.format(o.start)}, ` : ''}${range}`;
  }
  return ev.location ? `${when}\n${ev.location}` : when;
}

/** Every reminder that fires in [now - LATE_MS, now + HORIZON_MS]. */
export function buildQueue(events, now, tz) {
  const items = [];
  const from = now - LATE_MS, to = now + HORIZON_MS;
  for (const ev of events) {
    const rems = (ev.reminders || []).filter((m) => Number.isFinite(m) && m >= 0);
    if (!rems.length) continue;
    const maxLead = Math.max(...rems) * 60000 + 86400000; // + a day for the all-day 9am anchor
    const done = new Set(ev.doneKeys || []);
    for (const o of expandEvent(ev, new Date(from - 86400000), new Date(to + maxLead))) {
      if (done.has(o.key)) continue; // completed early: no reminder needed
      for (const m of rems) {
        const at = reminderTime(o, m).getTime();
        if (at < from || at > to) continue;
        items.push({
          key: `${ev.id}|${o.key}|${m}`,
          at,
          title: ev.title || '(No title)',
          body: bodyFor(o, m, tz),
        });
      }
    }
  }
  items.sort((a, b) => a.at - b.at);
  return items;
}

/** Items that should be sent right now. */
export function dueItems(items, sent, now) {
  return items.filter((i) => i.at <= now + 60000 && i.at >= now - LATE_MS && !sent[i.key]);
}
