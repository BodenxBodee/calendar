// Minimal iCalendar (.ics) parser for importing a Google Calendar export.
// Handles: all-day & timed events, UTC / TZID / floating times, RRULE
// (daily/weekly/monthly/yearly), EXDATE, edited instances (RECURRENCE-ID),
// cancelled events and VALARM reminders.

import { toDateKey, addDays } from './dates.js';

const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseLine(line) {
  // NAME;PARAM=VAL;PARAM="x:y":VALUE
  let i = 0, inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

// Offset (ms) of time zone `tz` at UTC instant `utcMs`.
function tzOffset(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
}

function zonedToDate(y, mo, d, h, mi, s, tz) {
  try {
    const guess = Date.UTC(y, mo, d, h, mi, s);
    let ms = guess - tzOffset(guess, tz);
    ms = guess - tzOffset(ms, tz);
    return new Date(ms);
  } catch {
    return new Date(y, mo, d, h, mi, s); // unknown zone name: treat as local
  }
}

/** Returns { date: Date, allDay: boolean } */
function parseDate(value, params) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === 'DATE') {
    return { date: new Date(+y, +mo - 1, +d), allDay: true };
  }
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
  if (params.TZID) return { date: zonedToDate(+y, +mo - 1, +d, +h, +mi, +(s || 0), params.TZID), allDay: false };
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = (((+(w || 0) * 7 + +(d || 0)) * 24 + +(h || 0)) * 60 + +(mi || 0)) * 60000 + +(s || 0) * 1000;
  return sign === '-' ? -ms : ms;
}

function parseRRule(v, start) {
  const parts = Object.fromEntries(v.split(';').map((p) => p.split('=')).map(([k, x]) => [k.toUpperCase(), x]));
  const freq = parts.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const rec = { freq, interval: parseInt(parts.INTERVAL || '1', 10) || 1, until: null, count: null };
  if (parts.COUNT) rec.count = parseInt(parts.COUNT, 10);
  if (parts.UNTIL) {
    const u = parseDate(parts.UNTIL, {});
    if (u) rec.until = toDateKey(u.date);
  }
  if (parts.BYDAY) {
    const items = parts.BYDAY.split(',').map((s) => /^([+-]?\d+)?([A-Z]{2})$/.exec(s.trim())).filter(Boolean);
    if (freq === 'WEEKLY') {
      rec.byDay = items.map((x) => DAY_CODES[x[2]]).filter((x) => x !== undefined);
    } else if (freq === 'MONTHLY' && items[0] && items[0][1]) {
      rec.monthlyMode = 'nth';
      rec.nth = parseInt(items[0][1], 10) < 0 ? -1 : parseInt(items[0][1], 10);
    } else if (freq === 'DAILY' && items.length) {
      // e.g. "every weekday" exported as DAILY;BYDAY=MO,TU,WE,TH,FR
      rec.freq = 'WEEKLY';
      rec.byDay = items.map((x) => DAY_CODES[x[2]]);
    }
  } else if (freq === 'WEEKLY') {
    rec.byDay = [start.getDay()];
  }
  if (rec.freq === 'MONTHLY' && !rec.monthlyMode) rec.monthlyMode = 'day';
  return rec;
}

/**
 * Parse .ics text.
 * @returns {{ name: string|null, events: object[] }} events in app format (without id/calendarId),
 *   each with `icsUid` for de-duplication.
 */
export function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let calName = null;
  const raw = [];
  let cur = null, inAlarm = false, alarm = null;

  for (const line of lines) {
    if (!line) continue;
    const { name, params, value } = parseLine(line);
    if (name === 'BEGIN' && value === 'VEVENT') { cur = { props: {}, exdates: [], alarms: [] }; continue; }
    if (name === 'END' && value === 'VEVENT') { if (cur) raw.push(cur); cur = null; continue; }
    if (name === 'X-WR-CALNAME' && !cur) { calName = unescapeText(value); continue; }
    if (!cur) continue;
    if (name === 'BEGIN' && value === 'VALARM') { inAlarm = true; alarm = {}; continue; }
    if (name === 'END' && value === 'VALARM') { inAlarm = false; if (alarm) cur.alarms.push(alarm); continue; }
    if (inAlarm) { alarm[name] = { params, value }; continue; }
    if (name === 'EXDATE') {
      for (const v of value.split(',')) { const d = parseDate(v, params); if (d) cur.exdates.push(toDateKey(d.date)); }
      continue;
    }
    cur.props[name] = { params, value };
  }

  const masters = new Map();
  const events = [];
  const overrides = [];

  for (const r of raw) {
    const p = r.props;
    if (!p.DTSTART) continue;
    if (p.STATUS && p.STATUS.value.toUpperCase() === 'CANCELLED') {
      // A cancelled single instance of a repeating event = an exception date.
      if (p['RECURRENCE-ID']) overrides.push({ uid: p.UID?.value, recId: parseDate(p['RECURRENCE-ID'].value, p['RECURRENCE-ID'].params), cancelled: true });
      continue;
    }
    const s = parseDate(p.DTSTART.value, p.DTSTART.params);
    if (!s) continue;
    let e = p.DTEND ? parseDate(p.DTEND.value, p.DTEND.params) : null;
    if (!e && p.DURATION) {
      const ms = parseDuration(p.DURATION.value);
      if (ms !== null) e = { date: new Date(s.date.getTime() + ms), allDay: s.allDay };
    }
    const ev = {
      title: p.SUMMARY ? unescapeText(p.SUMMARY.value) : '(No title)',
      allDay: s.allDay,
      location: p.LOCATION ? unescapeText(p.LOCATION.value) : '',
      notes: p.DESCRIPTION ? unescapeText(p.DESCRIPTION.value) : '',
      recurrence: p.RRULE ? parseRRule(p.RRULE.value, s.date) : null,
      exdates: r.exdates,
      reminders: [],
      icsUid: p.UID ? p.UID.value : null,
    };
    if (s.allDay) {
      ev.start = toDateKey(s.date);
      // DTEND is exclusive for all-day events; ours is inclusive.
      const endEx = e ? e.date : addDays(s.date, 1);
      const last = addDays(endEx, -1);
      ev.end = toDateKey(last < s.date ? s.date : last);
    } else {
      ev.start = s.date.toISOString();
      const endDate = e && e.date > s.date ? e.date : new Date(s.date.getTime() + 30 * 60000);
      ev.end = endDate.toISOString();
    }
    for (const a of r.alarms) {
      if (!a.TRIGGER || (a.ACTION && a.ACTION.value.toUpperCase() !== 'DISPLAY' && a.ACTION.value.toUpperCase() !== 'EMAIL')) continue;
      const ms = parseDuration(a.TRIGGER.value);
      if (ms === null) continue;
      let min;
      if (s.allDay) {
        // Triggers are relative to midnight; ours are "minutes before 9:00 AM".
        // Google: "-PT15H" = 9am the day before (1440), "PT9H" = 9am on the day (0).
        min = Math.max(0, 540 - Math.round(ms / 60000));
      } else if (ms <= 0) {
        min = Math.round(-ms / 60000);
      } else continue;
      if (!ev.reminders.includes(min)) ev.reminders.push(min);
    }
    if (p['RECURRENCE-ID']) {
      ev.icsUid = `${ev.icsUid}#${p['RECURRENCE-ID'].value}`;
      overrides.push({ uid: p.UID?.value, recId: parseDate(p['RECURRENCE-ID'].value, p['RECURRENCE-ID'].params) });
      events.push(ev);
      continue;
    }
    if (ev.recurrence && ev.icsUid) masters.set(ev.icsUid, ev);
    events.push(ev);
  }

  // Edited / cancelled instances: hide the original occurrence on the series.
  for (const o of overrides) {
    const m = masters.get(o.uid);
    if (m && o.recId) {
      const key = toDateKey(o.recId.date);
      if (!m.exdates.includes(key)) m.exdates.push(key);
    }
  }
  return { name: calName, events };
}

