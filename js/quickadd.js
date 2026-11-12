// Quick add: turn plain words like "Dentist tue 3pm" or
// "Gym every mon wed fri 6-7pm #health" into an event.

import {
  addDays, startOfDay, sameDay, toDateKey, fmt, fmtTimeRange, MIN_MS, daysInMonth,
} from './dates.js';
import { describeRecurrence } from './recurrence.js';
import { app, $, esc, toast } from './ctx.js';
import { newId } from './store.js';
import { openEditor } from './editor.js';

const WEEKDAYS = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};
const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const NAMED_TIMES = { noon: 720, midnight: 0, morning: 540, afternoon: 840, evening: 1080, tonight: 1200 };
const UNIT_MIN = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60 };

const norm = (t) => t.toLowerCase().replace(/^[,(]+|[,.;!?)]+$/g, '');
const ordinalNum = (t) => { const m = /^(\d{1,2})(st|nd|rd|th)?$/.exec(t); return m ? Number(m[1]) : null; };

/** Parse "3", "3pm", "3:30", "15:00", "3p". Returns { min, explicit } or null. */
function parseClock(t, nextTok) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  let ap = m[3] || (nextTok === 'am' || nextTok === 'pm' ? nextTok : null);
  if (h > 23 || mins > 59) return null;
  if (ap) {
    ap = ap[0];
    if (h > 12 || h === 0) return null;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  }
  return { min: h * 60 + mins, hasAmPm: !!ap, hasColon: !!m[2], h24: h > 12, usedNext: !m[3] && !!ap };
}

/** "3" with no am/pm: 1–6 → afternoon, 7–11 → morning, 12 → noon. */
function guessAmPm(c) {
  if (c.hasAmPm || c.h24) return c.min;
  const h = Math.floor(c.min / 60);
  if (h >= 1 && h <= 6) return c.min + 12 * 60;
  return c.min;
}

function nextWeekday(from, wd, includeToday = true) {
  const diff = (wd - from.getDay() + 7) % 7;
  return addDays(startOfDay(from), diff === 0 && !includeToday ? 7 : diff);
}

/**
 * @param {string} input   what was typed
 * @param {Date}   base    the day to use when no date is given (normally today)
 * @param {Array}  calendars  [{id,name}] for "#work"-style tags
 * @returns {{title, start: Date, end: Date, allDay, recurrence, calendarId, hasDate, hasTime}}
 */
export function parseQuick(input, base = new Date(), calendars = []) {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const toks = raw.map(norm);
  const used = new Array(raw.length).fill(false);
  const today = startOfDay(new Date());
  const baseDay = startOfDay(base);
  const use = (...idx) => idx.forEach((i) => { used[i] = true; });

  let date = null;          // Date (midnight)
  let startMin = null, endMin = null, durMin = null;
  let allDay = false;
  let rec = null;
  let calendarId = null;
  let firstWeekday = null;  // from "every mon..." to pick the first date

  // ── Pass 1: phrases ──
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    const t = toks[i], n1 = toks[i + 1], n2 = toks[i + 2];

    // #calendar
    if (t.startsWith('#') && t.length > 1) {
      const name = t.slice(1);
      const cal = calendars.find((c) => c.name.toLowerCase() === name) || calendars.find((c) => c.name.toLowerCase().startsWith(name));
      if (cal) { calendarId = cal.id; use(i); }
      continue;
    }

    // Repeats
    if (t === 'every' || t === 'each') {
      let j = i + 1, interval = 1;
      if (toks[j] === 'other') { interval = 2; j++; }
      else if (/^\d+$/.test(toks[j] || '')) { interval = Number(toks[j]); j++; }
      const w = toks[j];
      const unit = { day: 'DAILY', days: 'DAILY', week: 'WEEKLY', weeks: 'WEEKLY', month: 'MONTHLY', months: 'MONTHLY', year: 'YEARLY', years: 'YEARLY' }[w];
      if (unit) { rec = { freq: unit, interval }; use(i, ...range(i + 1, j + 1)); continue; }
      if (w === 'weekday' || w === 'weekdays') { rec = { freq: 'WEEKLY', interval, byDay: [1, 2, 3, 4, 5] }; firstWeekday = 1; use(i, ...range(i + 1, j + 1)); continue; }
      if (w === 'weekend' || w === 'weekends') { rec = { freq: 'WEEKLY', interval, byDay: [0, 6] }; firstWeekday = 6; use(i, ...range(i + 1, j + 1)); continue; }
      // every mon, wed and fri
      const days = [];
      let k = j;
      while (k < toks.length) {
        const parts = toks[k].split(/[,/&]+/).filter(Boolean);
        if (parts.length && parts.every((p) => p in WEEKDAYS)) { parts.forEach((p) => days.push(WEEKDAYS[p])); k++; continue; }
        if ((toks[k] === 'and' || toks[k] === '&' || toks[k] === ',') && toks[k + 1] && toks[k + 1].replace(/,/g, '') in WEEKDAYS) { k++; continue; }
        break;
      }
      if (days.length) {
        rec = { freq: 'WEEKLY', interval, byDay: [...new Set(days)].sort() };
        firstWeekday = days[0];
        use(i, ...range(i + 1, k));
        continue;
      }
      continue;
    }
    const simpleRec = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY', annually: 'YEARLY' }[t];
    if (simpleRec) { rec = { freq: simpleRec, interval: 1 }; use(i); continue; }
    if (t === 'weekdays') { rec = { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] }; firstWeekday = 1; use(i); continue; }

    // All day
    if (t === 'all' && (n1 === 'day' || n1 === 'day,')) { allDay = true; use(i, i + 1); continue; }
    if (t === 'allday' || t === 'all-day') { allDay = true; use(i); continue; }

    // Relative days
    if (t === 'today') { date = today; use(i); continue; }
    if (t === 'tonight') { date = today; if (startMin === null) startMin = NAMED_TIMES.tonight; use(i); continue; }
    if (['tomorrow', 'tmr', 'tmrw', 'tom', 'tomorow'].includes(t)) { date = addDays(today, 1); use(i); continue; }
    if (t === 'yesterday') { date = addDays(today, -1); use(i); continue; }
    if ((t === 'next' || t === 'this') && n1 in WEEKDAYS) {
      date = nextWeekday(today, WEEKDAYS[n1], t === 'this');
      if (t === 'next' && date - today < 7 * 864e5 && sameDay(date, nextWeekday(today, WEEKDAYS[n1], false))) {
        // "next fri" = the coming Friday (same as Google); if today is Friday, a week from today.
      }
      use(i, i + 1); continue;
    }
    if (t === 'next' && n1 === 'week') { date = addDays(today, 7); use(i, i + 1); continue; }
    if (t === 'in' && /^\d+$/.test(n1 || '') && n2) {
      const num = Number(n1);
      const u = n2.replace(/s$/, '');
      if (u === 'day') { date = addDays(today, num); use(i, i + 1, i + 2); continue; }
      if (u === 'week') { date = addDays(today, num * 7); use(i, i + 1, i + 2); continue; }
      if (u === 'month') { const d = new Date(today); d.setMonth(d.getMonth() + num); date = d; use(i, i + 1, i + 2); continue; }
      if (UNIT_MIN[n2]) {
        const at = new Date(Date.now() + num * UNIT_MIN[n2] * MIN_MS);
        date = startOfDay(at); startMin = at.getHours() * 60 + Math.ceil(at.getMinutes() / 5) * 5;
        use(i, i + 1, i + 2); continue;
      }
    }
    const sunIsDay = t !== 'sun' || toks[i - 1] === 'on' || i === toks.length - 1 || !!parseClock(n1 || '', n2) || n1 === 'at';
    if (t in WEEKDAYS && sunIsDay) {
      // "sun" counts as Sunday only when it's clearly a date ("on sun", "sun 3pm", at the end)
      date = nextWeekday(today, WEEKDAYS[t], true); use(i);
      if (toks[i - 1] === 'on') use(i - 1);
      continue;
    }

    // Dates: "dec 4", "december 4th", "4 dec", "the 15th", "12/4", "12/4/2027"
    if (t in MONTHS && t !== 'may' || (t === 'may' && ordinalNum(n1 || '') !== null)) {
      const d = ordinalNum(n1 || '');
      if (d !== null && d >= 1 && d <= 31) {
        let year = today.getFullYear(), k = i + 2;
        if (/^\d{4}$/.test(toks[i + 2] || '')) { year = Number(toks[i + 2]); k = i + 3; }
        let cand = new Date(year, MONTHS[t], Math.min(d, daysInMonth(year, MONTHS[t])));
        if (k === i + 2 && cand < today) cand = new Date(year + 1, MONTHS[t], Math.min(d, daysInMonth(year + 1, MONTHS[t])));
        date = cand; use(...range(i, k));
        if (toks[i - 1] === 'on') use(i - 1);
        continue;
      }
    }
    if (ordinalNum(t) !== null && n1 in MONTHS && /(st|nd|rd|th)$|^\d+$/.test(t)) {
      const d = ordinalNum(t);
      if (d >= 1 && d <= 31) {
        let cand = new Date(today.getFullYear(), MONTHS[n1], d);
        if (cand < today) cand = new Date(today.getFullYear() + 1, MONTHS[n1], d);
        date = cand; use(i, i + 1);
        if (toks[i - 1] === 'on') use(i - 1);
        continue;
      }
    }
    if (t === 'the' && /^\d{1,2}(st|nd|rd|th)$/.test(n1 || '')) {
      const d = ordinalNum(n1);
      let cand = new Date(today.getFullYear(), today.getMonth(), d);
      if (cand < today) cand = new Date(today.getFullYear(), today.getMonth() + 1, d);
      date = cand; use(i, i + 1);
      if (toks[i - 1] === 'on') use(i - 1);
      continue;
    }
    const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
    if (slash) {
      const mo = Number(slash[1]) - 1, d = Number(slash[2]);
      if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) {
        let year = slash[3] ? Number(slash[3]) : today.getFullYear();
        if (year < 100) year += 2000;
        let cand = new Date(year, mo, d);
        if (!slash[3] && cand < today) cand = new Date(year + 1, mo, d);
        date = cand; use(i);
        if (toks[i - 1] === 'on') use(i - 1);
        continue;
      }
    }

    // Duration: "for 2 hours", "for 30 min", "for 1.5h"; also bare "90min", "2h"
    if (t === 'for' && n1) {
      const m = /^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?$/.exec(n1);
      if (m) {
        const unit = m[2] || n2;
        if (UNIT_MIN[unit]) { durMin = Math.round(Number(m[1]) * UNIT_MIN[unit]); use(i, i + 1); if (!m[2]) use(i + 2); continue; }
      }
    }
    const bareDur = /^(\d+(?:\.\d+)?)(h|hr|hrs|min|mins)$/.exec(t);
    if (bareDur) { durMin = Math.round(Number(bareDur[1]) * UNIT_MIN[bareDur[2]]); use(i); continue; }

    // Named times
    if (t in NAMED_TIMES && t !== 'tonight') {
      if (startMin === null) startMin = NAMED_TIMES[t]; else if (endMin === null) endMin = NAMED_TIMES[t];
      use(i); if (toks[i - 1] === 'at' || toks[i - 1] === 'in' || toks[i - 1] === 'the') use(i - 1);
      continue;
    }

    // Times and ranges: "3pm", "3:30", "at 3", "3-4pm", "3pm-5pm", "from 3 to 5", "10am–noon"
    if (/[-–]/.test(t) && /\d/.test(t)) {
      const [a, b] = t.split(/[-–]/);
      const ca = parseClock(a), cb = b in NAMED_TIMES ? { min: NAMED_TIMES[b], hasAmPm: true } : parseClock(b, n1);
      if (ca && cb) {
        setRange(ca, cb);
        use(i); if (cb.usedNext) use(i + 1);
        if (toks[i - 1] === 'at' || toks[i - 1] === 'from' || toks[i - 1] === '@') use(i - 1);
        continue;
      }
    }
    const lead = toks[i - 1] === 'at' || toks[i - 1] === '@' || toks[i - 1] === 'from';
    const c = parseClock(t, n1);
    if (c && (c.hasAmPm || c.hasColon || lead)) {
      // A following "to/until/-/–" + time makes a range.
      let j = i + 1 + (c.usedNext ? 1 : 0);
      if (['to', 'until', 'till', '-', '–'].includes(toks[j])) {
        const c2 = toks[j + 1] in NAMED_TIMES ? { min: NAMED_TIMES[toks[j + 1]], hasAmPm: true } : parseClock(toks[j + 1] || '', toks[j + 2]);
        if (c2) {
          setRange(c, c2);
          use(...range(i, j + 2)); if (c2.usedNext) use(j + 2);
          if (lead) use(i - 1);
          continue;
        }
      }
      if (startMin === null) startMin = guessAmPm(c);
      use(i); if (c.usedNext) use(i + 1);
      if (lead) use(i - 1);
      continue;
    }
  }

  function setRange(a, b) {
    let s = a.min, e = b.min;
    if (!a.hasAmPm && !a.h24) {
      // "3-4pm": the start borrows pm from the end when that makes sense
      if (b.hasAmPm && b.min >= 12 * 60 && a.min + 12 * 60 < b.min + 1) s = a.min + 12 * 60;
      else if (!b.hasAmPm) s = guessAmPm(a);
    }
    if (!b.hasAmPm && !b.h24) { e = guessAmPm(b); if (e <= s) e += 12 * 60; }
    startMin = s; endMin = e;
  }

  // ── Work out the date ──
  const hasDate = date !== null;
  if (!date && firstWeekday !== null) date = nextWeekday(baseDay, firstWeekday, true);
  if (!date) date = baseDay;
  if (rec && rec.freq === 'WEEKLY' && !rec.byDay) rec.byDay = [date.getDay()];
  if (rec && rec.byDay && !rec.byDay.includes(date.getDay())) date = nextWeekday(date, rec.byDay.find((d) => d >= date.getDay()) ?? rec.byDay[0], true);
  if (rec && rec.freq === 'MONTHLY') rec.monthlyMode = 'day';

  const hasTime = startMin !== null && !allDay;
  let start, end;
  if (hasTime) {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, startMin);
    const len = endMin !== null ? endMin - startMin : (durMin ?? 60);
    end = new Date(start.getTime() + (len > 0 ? len : len + 24 * 60) * MIN_MS);
  } else {
    // No time → an all-day item (handy as a to-do you can tick off)
    allDay = true;
    start = date;
    end = durMin && durMin >= 1440 ? addDays(date, Math.round(durMin / 1440)) : addDays(date, 1); // end is exclusive
  }

  // ── Title = whatever words weren't used ──
  const words = raw.filter((_, i) => !used[i]);
  while (words.length && /^(at|on|from|to|for|in|@|-|–|,|the)$/i.test(words[words.length - 1])) words.pop();
  while (words.length && /^(at|on|from|@|-|–|,)$/i.test(words[0])) words.shift();
  let title = words.join(' ').replace(/\s+([,.!?])/g, '$1').replace(/[,\s]+$/, '').trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);

  return { title: title || '(No title)', start, end, allDay, recurrence: rec, calendarId, hasDate, hasTime };
}

function range(a, b) { const out = []; for (let i = a; i < b; i++) out.push(i); return out; }

/** Short human summary for the live preview. */
export function describeQuick(p) {
  const now = new Date();
  const day = sameDay(p.start, now) ? 'Today' : sameDay(p.start, addDays(now, 1)) ? 'Tomorrow'
    : fmt(p.start, { weekday: 'short', month: 'short', day: 'numeric', ...(p.start.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  let when = day;
  if (p.allDay) {
    const last = addDays(p.end, -1);
    when += sameDay(p.start, last) ? ' · All day' : ` – ${fmt(last, { month: 'short', day: 'numeric' })} · All day`;
  } else {
    when += ` · ${fmtTimeRange(p.start, p.end)}`;
  }
  return { when, repeat: p.recurrence ? describeRecurrence(p.recurrence, p.start) : null };
}

/** Convert a parse result into the stored event shape. */
export function toEvent(p, calendarId) {
  return {
    title: p.title,
    allDay: p.allDay,
    start: p.allDay ? toDateKey(p.start) : p.start.toISOString(),
    end: p.allDay ? toDateKey(addDays(p.end, -1)) : p.end.toISOString(),
    recurrence: p.recurrence,
    calendarId: p.calendarId || calendarId,
    location: '', notes: '', exdates: [],
  };
}

// ───────────────────────────── The quick-add box ─────────────────────────────

let qaBase = null; // day to use when none is typed (null = today)

function preview(p) {
  const { when, repeat } = describeQuick(p);
  const cal = app.store.calendarById(p.calendarId) || app.store.calendarById(app.lastCalendarId) || app.store.calendarById(app.store.defaultCalendarId());
  return `<div class="qa-title">${esc(p.title)}</div>
    <div class="qa-meta">
      <span>${esc(when)}</span>
      ${repeat ? `<span>↻ ${esc(repeat)}</span>` : ''}
      ${cal ? `<span class="qa-cal" style="--c:${esc(cal.color)}">${esc(cal.name)}</span>` : ''}
    </div>`;
}

function current() {
  const text = $('#qa-input').value.trim();
  if (!text) return null;
  return parseQuick(text, qaBase || new Date(), app.store.calendars);
}

/** Save a parsed quick-add result. */
export async function addQuick(p) {
  const calId = p.calendarId
    || (app.lastCalendarId && app.store.calendarById(app.lastCalendarId) ? app.lastCalendarId : app.store.defaultCalendarId());
  const ev = { ...toEvent(p, calId), id: newId(), createdAt: Date.now() };
  await app.store.saveEvent(ev);
  const { when } = describeQuick(p);
  toast(`Added “${p.title}” · ${when}`, { label: 'Undo', run: () => app.store.deleteEvent(ev.id) });
  return ev;
}

export function openQuickAdd(base = null) {
  qaBase = base;
  const pop = $('#qa');
  pop.hidden = false;
  $('#create-btn').setAttribute('aria-expanded', 'true');
  $('#qa-input').value = '';
  $('#qa-preview').innerHTML = '';
  $('#qa-input').placeholder = base && !sameDay(base, new Date())
    ? `e.g. “Dentist 3pm” on ${fmt(base, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'e.g. “Dentist tue 3pm”';
  setTimeout(() => $('#qa-input').focus(), 30);
}

export function closeQuickAdd() {
  $('#qa').hidden = true;
  $('#create-btn').setAttribute('aria-expanded', 'false');
}

export function initQuickAdd() {
  const input = $('#qa-input');
  input.addEventListener('input', () => {
    const p = current();
    $('#qa-preview').innerHTML = p ? preview(p) : '';
  });
  $('#qa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = current();
    if (!p) { input.focus(); return; }
    closeQuickAdd();
    await addQuick(p);
  });
  $('#qa-more').onclick = () => {
    const p = current();
    closeQuickAdd();
    if (!p) { openEditor({}); return; }
    openEditor({
      start: p.start, end: p.allDay ? addDays(p.end, -1) : p.end, allDay: p.allDay,
      prefill: { title: p.title === '(No title)' ? '' : p.title, recurrence: p.recurrence, calendarId: p.calendarId || undefined },
    });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeQuickAdd(); });
  document.addEventListener('click', (e) => {
    if (!$('#qa').hidden && !e.target.closest('#qa') && !e.target.closest('#create-btn')) closeQuickAdd();
  });
}
