// Date helpers. All "local" functions use the device's time zone.
// Used throughout the app.

export const DAY_MS = 86400000;
export const MIN_MS = 60000;

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> "YYYY-MM-DD" (local) */
export function toDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" -> local midnight Date */
export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Adds calendar days, keeping the wall-clock time (DST safe). */
export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

/** Adds months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  r.setDate(Math.min(d.getDate(), daysInMonth(r.getFullYear(), r.getMonth())));
  return r;
}

export function startOfWeek(d, weekStart = 0) {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() - weekStart + 7) % 7));
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Whole calendar days from a to b. */
export function diffDays(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** Date -> "HH:MM" for <input type=time> */
export function toTimeInput(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" + "HH:MM" -> local Date */
export function combine(dateKey, time) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
}

/** The n-th (1..5, or -1 = last) weekday wd (0=Sun) of a month, or null. */
export function nthWeekdayOfMonth(y, m, nth, wd) {
  if (nth === -1) {
    const last = new Date(y, m + 1, 0);
    return new Date(y, m, last.getDate() - ((last.getDay() - wd + 7) % 7));
  }
  const first = new Date(y, m, 1);
  const day = 1 + ((wd - first.getDay() + 7) % 7) + (nth - 1) * 7;
  return day <= daysInMonth(y, m) ? new Date(y, m, day) : null;
}

/** Which occurrence of its weekday this date is within the month (1..5). */
export function weekdayOrdinal(d) {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

export function isLastWeekdayOfMonth(d) {
  return d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth());
}

// ---------- Formatting ----------

const uses24h = (() => {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hc === 'h23' || hc === 'h24';
  } catch { return false; }
})();

/** Compact time like Google: "3pm", "3:30pm" (or "15:00"). */
export function fmtTimeShort(d) {
  if (uses24h) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? ':' + pad(m) : ''}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

export function fmtTimeRange(s, e) {
  return `${fmtTimeShort(s)} – ${fmtTimeShort(e)}`;
}

export function fmtHourLabel(h) {
  if (uses24h) return `${pad(h)}:00`;
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

export const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);

export function weekdayNames(style = 'short') {
  const base = new Date(2023, 0, 1); // a Sunday
  return Array.from({ length: 7 }, (_, i) => fmt(addDays(base, i), { weekday: style }));
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function humanizeMinutes(min) {
  if (min === 0) return 'At time of event';
  if (min % 10080 === 0) { const w = min / 10080; return `${w} week${w > 1 ? 's' : ''}`; }
  if (min % 1440 === 0) { const d = min / 1440; return `${d} day${d > 1 ? 's' : ''}`; }
  if (min % 60 === 0) { const h = min / 60; return `${h} hour${h > 1 ? 's' : ''}`; }
  return `${min} minutes`;
}
