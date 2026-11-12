// Event details popup + create/edit form, including repeating-event logic.

import {
  addDays, toDateKey, fromDateKey, toTimeInput, combine, diffDays, sameDay, startOfDay,
  weekdayNames, ordinal, weekdayOrdinal, isLastWeekdayOfMonth, fmt, fmtTimeShort, MIN_MS,
} from './dates.js';
import { eventBounds, describeRecurrence } from './recurrence.js';
import { newId } from './store.js';
import { app, $, $$, esc, linkify, calOf, toast, showDialog, askScope, closeOnBackdrop, isDone, isAutoDone, toggleDone } from './ctx.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

// ─────────────────────────────── Details ───────────────────────────────

let detailsOcc = null;

function whenText(o) {
  const yr = (d) => d.getFullYear() !== new Date().getFullYear();
  const dayFmt = (d) => fmt(d, { weekday: 'long', month: 'long', day: 'numeric', ...(yr(d) ? { year: 'numeric' } : {}) });
  const short = (d) => fmt(d, { month: 'short', day: 'numeric', ...(yr(d) ? { year: 'numeric' } : {}) });
  if (o.allDay) {
    const last = addDays(o.end, -1);
    return sameDay(o.start, last) ? dayFmt(o.start) : `${short(o.start)} – ${short(last)}`;
  }
  if (sameDay(o.start, o.end) || (o.end - startOfDay(o.end) === 0 && o.end - o.start <= 86400000)) {
    return `${dayFmt(o.start)} · ${fmtTimeShort(o.start)} – ${fmtTimeShort(o.end)}`;
  }
  return `${short(o.start)}, ${fmtTimeShort(o.start)} – ${short(o.end)}, ${fmtTimeShort(o.end)}`;
}

export function openDetails(o) {
  detailsOcc = o;
  const ev = o.event;
  const cal = calOf(ev);
  const icon = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  $('#details-body').innerHTML = `
    <span class="dot" style="--c:${cal.color}"></span>
    <div><div class="d-title">${esc(ev.title || '(No title)')}</div>
      <div class="d-sub">${esc(whenText(o))}</div>
      ${ev.recurrence ? `<div class="d-sub">${esc(describeRecurrence(ev.recurrence, eventBounds(ev).start))}</div>` : ''}</div>
    ${ev.location ? `${icon('M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z')}
      <div>${/^https?:\/\//.test(ev.location) ? linkify(ev.location) : `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener">${esc(ev.location)}</a>`}</div>` : ''}
    ${ev.notes ? `${icon('M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z')}<div class="d-notes">${linkify(ev.notes)}</div>` : ''}
    ${icon('M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2zm3 18H5V8h14v11z')}<div>${esc(cal.name)}</div>
    <div class="d-complete">${isAutoDone(o)
      ? '<span class="done-note"><svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>Completed automatically — this event has passed</span>'
      : `<button class="btn ${isDone(o) ? '' : 'btn-primary'}" data-act="done"><svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>${isDone(o) ? 'Completed — undo' : 'Mark complete'}</button>`}</div>`;
  const dlg = $('#details-dlg');
  if (!dlg.open) dlg.showModal();
}

async function deleteOcc(o) {
  const master = app.store.eventById(o.event.id);
  if (!master) return;
  const before = clone(master);
  const undo = { label: 'Undo', run: () => app.store.saveEvent(clone(before)) };
  if (!master.recurrence) {
    await app.store.deleteEvent(master.id);
    toast('Event deleted', undo);
    return;
  }
  const scope = await askScope('Delete recurring event', true);
  if (!scope) return;
  const isFirst = o.key === toDateKey(eventBounds(master).start);
  if (scope === 'all' || (scope === 'following' && isFirst)) {
    await app.store.deleteEvent(master.id);
  } else if (scope === 'this') {
    master.exdates = [...new Set([...(master.exdates || []), o.key])];
    await app.store.saveEvent(master);
  } else {
    master.recurrence = { ...master.recurrence, until: toDateKey(addDays(fromDateKey(o.key), -1)), count: null };
    await app.store.saveEvent(master);
  }
  toast('Event deleted', undo);
}

// ─────────────────────────────── Editor ───────────────────────────────

let editing = null; // { master, occ } | null for new
let customRec = null;

// ── Repeat options ──

function startDateFromForm() {
  return $('#f-sdate').value ? fromDateKey($('#f-sdate').value) : new Date();
}

function presetFor(kind, d) {
  switch (kind) {
    case 'none': return null;
    case 'daily': return { freq: 'DAILY', interval: 1 };
    case 'weekly': return { freq: 'WEEKLY', interval: 1, byDay: [d.getDay()] };
    case 'weekdays': return { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] };
    case 'monthly-day': return { freq: 'MONTHLY', interval: 1, monthlyMode: 'day' };
    case 'monthly-nth': return { freq: 'MONTHLY', interval: 1, monthlyMode: 'nth', nth: weekdayOrdinal(d) };
    case 'monthly-last': return { freq: 'MONTHLY', interval: 1, monthlyMode: 'nth', nth: -1 };
    case 'yearly': return { freq: 'YEARLY', interval: 1 };
    default: return null;
  }
}

function buildRepeatOptions(selected) {
  const d = startDateFromForm();
  const wd = weekdayNames('long')[d.getDay()];
  const opts = [
    ['none', 'Does not repeat'],
    ['daily', 'Daily'],
    ['weekly', `Weekly on ${wd}`],
    ['monthly-day', `Monthly on day ${d.getDate()}`],
    ...(weekdayOrdinal(d) <= 4 ? [['monthly-nth', `Monthly on the ${ordinal(weekdayOrdinal(d))} ${wd}`]] : []),
    ...(isLastWeekdayOfMonth(d) ? [['monthly-last', `Monthly on the last ${wd}`]] : []),
    ['yearly', `Annually on ${fmt(d, { month: 'long', day: 'numeric' })}`],
    ['weekdays', 'Every weekday (Monday to Friday)'],
    ['custom', 'Custom…'],
  ];
  const sel = $('#f-repeat');
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  sel.value = opts.some(([v]) => v === selected) ? selected : (selected === 'monthly-nth' || selected === 'monthly-last' ? 'monthly-day' : 'none');
}

function kindOf(rec) {
  if (!rec || !rec.freq) return 'none';
  if ((rec.interval || 1) !== 1 || rec.until || rec.count) return 'custom';
  const d = startDateFromForm();
  if (rec.freq === 'DAILY') return 'daily';
  if (rec.freq === 'YEARLY') return 'yearly';
  if (rec.freq === 'WEEKLY') {
    const bd = [...(rec.byDay || [d.getDay()])].sort().join();
    if (bd === '1,2,3,4,5') return 'weekdays';
    if (bd === String(d.getDay())) return 'weekly';
    return 'custom';
  }
  if (rec.freq === 'MONTHLY') {
    if (rec.monthlyMode !== 'nth') return 'monthly-day';
    if (rec.nth === -1) return 'monthly-last';
    if (rec.nth === weekdayOrdinal(d)) return 'monthly-nth';
  }
  return 'custom';
}

function renderCustom() {
  const d = startDateFromForm();
  const r = customRec;
  $('#r-interval').value = r.interval || 1;
  $('#r-freq').value = r.freq;
  const days = weekdayNames('narrow');
  const ws = app.store.settings.weekStart ?? 0;
  const on = new Set(r.byDay && r.byDay.length ? r.byDay : [d.getDay()]);
  $('#r-days').hidden = r.freq !== 'WEEKLY';
  $('#r-days').innerHTML = Array.from({ length: 7 }, (_, i) => (ws + i) % 7)
    .map((i) => `<button type="button" data-d="${i}" class="${on.has(i) ? 'on' : ''}" aria-pressed="${on.has(i)}" title="${weekdayNames('long')[i]}">${days[i]}</button>`).join('');
  $('#r-monthly').hidden = r.freq !== 'MONTHLY';
  const wd = weekdayNames('long')[d.getDay()];
  const mOpts = [['day', `On day ${d.getDate()}`]];
  if (weekdayOrdinal(d) <= 4) mOpts.push(['nth', `On the ${ordinal(weekdayOrdinal(d))} ${wd}`]);
  if (isLastWeekdayOfMonth(d)) mOpts.push(['last', `On the last ${wd}`]);
  $('#r-monthmode').innerHTML = mOpts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  $('#r-monthmode').value = r.monthlyMode === 'nth' ? (r.nth === -1 ? 'last' : 'nth') : 'day';
  if (!$('#r-monthmode').value) $('#r-monthmode').value = 'day';
  const endKind = r.until ? 'until' : r.count ? 'count' : 'never';
  $(`input[name=r-end][value=${endKind}]`).checked = true;
  $('#r-until').value = r.until || toDateKey(addDays(d, 90));
  $('#r-count').value = r.count || 10;
}

function readCustom() {
  const d = startDateFromForm();
  const freq = $('#r-freq').value;
  const rec = { freq, interval: Math.max(1, parseInt($('#r-interval').value, 10) || 1), until: null, count: null };
  if (freq === 'WEEKLY') {
    rec.byDay = $$('#r-days button.on').map((b) => Number(b.dataset.d)).sort();
    if (!rec.byDay.length) rec.byDay = [d.getDay()];
  }
  if (freq === 'MONTHLY') {
    const m = $('#r-monthmode').value;
    rec.monthlyMode = m === 'day' ? 'day' : 'nth';
    if (m === 'nth') rec.nth = weekdayOrdinal(d);
    if (m === 'last') rec.nth = -1;
  }
  const end = $('input[name=r-end]:checked').value;
  if (end === 'until' && $('#r-until').value) rec.until = $('#r-until').value;
  if (end === 'count') rec.count = Math.max(1, parseInt($('#r-count').value, 10) || 1);
  return rec;
}

function readRecurrence() {
  const kind = $('#f-repeat').value;
  if (kind === 'custom') return readCustom();
  return presetFor(kind, startDateFromForm());
}

// ── Open / fill form ──

/**
 * openEditor({ occ })                      edit an existing occurrence
 * openEditor({ start, end, allDay })       new event
 * openEditor({ duplicate: occ })           new event copied from occ
 */
export function openEditor(opts = {}) {
  const store = app.store;
  const dlg = $('#event-dlg');
  $('#f-error').textContent = '';
  let data, start, end;

  if (opts.occ) {
    const master = store.eventById(opts.occ.event.id);
    editing = { master, occ: opts.occ };
    data = master;
    start = opts.occ.start; end = opts.occ.end;
  } else {
    editing = null;
    if (opts.duplicate) {
      data = { ...clone(opts.duplicate.event), title: opts.duplicate.event.title };
      start = opts.duplicate.start; end = opts.duplicate.end;
    } else {
      const now = new Date();
      start = opts.start || new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
      end = opts.end || new Date(start.getTime() + 60 * MIN_MS);
      if (opts.allDay) { start = startOfDay(start); end = addDays(startOfDay(end), 1); }
      data = {
        title: '', allDay: !!opts.allDay, recurrence: null, location: '', notes: '',
        calendarId: app.lastCalendarId && store.calendarById(app.lastCalendarId) ? app.lastCalendarId : store.defaultCalendarId(),
      };
    }
  }

  $('#f-title').value = data.title || '';
  $('#f-allday').checked = !!data.allDay;
  $('#f-sdate').value = toDateKey(start);
  $('#f-stime').value = toTimeInput(start);
  const lastDay = data.allDay ? addDays(end, -1) : end;
  $('#f-edate').value = toDateKey(lastDay < start ? start : lastDay);
  $('#f-etime').value = toTimeInput(end);
  toggleAllDay();

  // Calendars
  const cals = [...store.calendars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  $('#f-cal').innerHTML = cals.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#f-cal').value = data.calendarId && store.calendarById(data.calendarId) ? data.calendarId : store.defaultCalendarId();
  updateCalDot();

  // Repeat
  customRec = clone(data.recurrence || { freq: 'WEEKLY', interval: 1, byDay: [start.getDay()] });
  buildRepeatOptions(kindOf(data.recurrence));
  $('#custom-rec').hidden = $('#f-repeat').value !== 'custom';
  if ($('#f-repeat').value === 'custom') renderCustom();

  $('#f-location').value = data.location || '';
  $('#f-notes').value = data.notes || '';

  if (!dlg.open) dlg.showModal();
  if (!opts.occ) setTimeout(() => $('#f-title').focus(), 50);
}

function toggleAllDay() {
  const ad = $('#f-allday').checked;
  $('#f-stime').hidden = ad;
  $('#f-etime').hidden = ad;
}

function updateCalDot() {
  const c = app.store.calendarById($('#f-cal').value);
  $('#f-cal-dot').style.setProperty('--c', c ? c.color : '#616161');
  $('#f-cal-dot').className = 'dot';
}

function readForm() {
  const allDay = $('#f-allday').checked;
  const sd = $('#f-sdate').value, ed = $('#f-edate').value || sd;
  if (!sd) throw new Error('Please choose a start date.');
  const ev = {
    title: $('#f-title').value.trim() || '(No title)',
    allDay,
    calendarId: $('#f-cal').value,
    recurrence: readRecurrence(),
    location: $('#f-location').value.trim(),
    notes: $('#f-notes').value.trim(),
  };
  if (allDay) {
    if (ed < sd) throw new Error('The end date is before the start date.');
    ev.start = sd; ev.end = ed;
  } else {
    const s = combine(sd, $('#f-stime').value || '09:00');
    const e = combine(ed, $('#f-etime').value || '10:00');
    if (e < s) throw new Error('The end time is before the start time.');
    ev.start = s.toISOString(); ev.end = e.toISOString();
  }
  if (ev.recurrence && ev.recurrence.until && ev.recurrence.until < sd) throw new Error('The repeat end date is before the event starts.');
  return ev;
}

async function save() {
  let data;
  try { data = readForm(); } catch (e) { $('#f-error').textContent = e.message; return; }
  const store = app.store;
  app.lastCalendarId = data.calendarId;

  if (!editing) {
    await store.saveEvent({ ...data, id: newId(), exdates: [], createdAt: Date.now() });
    $('#event-dlg').close();
    toast('Event saved');
    return;
  }

  const { master, occ } = editing;
  if (!master) { $('#event-dlg').close(); return; }

  if (!master.recurrence) {
    await store.saveEvent({ ...master, ...data });
    $('#event-dlg').close();
    toast('Event saved');
    return;
  }

  // Repeating event: which ones?
  const scope = await askScope('Edit recurring event', true);
  if (!scope) return;
  const masterStart = eventBounds(master).start;
  const isFirst = occ.key === toDateKey(masterStart);

  if (scope === 'this') {
    master.exdates = [...new Set([...(master.exdates || []), occ.key])];
    await store.saveEvent(master);
    await store.saveEvent({ ...data, recurrence: null, exdates: [], id: newId(), createdAt: Date.now() });
  } else if (scope === 'all' || isFirst) {
    await store.saveEvent(applyToSeries(master, data, occ));
  } else {
    // This and following: end the old series the day before, start a new one here.
    const oldRec = { ...master.recurrence, until: toDateKey(addDays(fromDateKey(occ.key), -1)), count: null };
    await store.saveEvent({ ...master, recurrence: oldRec });
    const newRec = data.recurrence && master.recurrence.count ? { ...data.recurrence, count: null } : data.recurrence;
    await store.saveEvent({
      ...data, recurrence: newRec, id: newId(), createdAt: Date.now(),
      exdates: (master.exdates || []).filter((k) => k > occ.key),
    });
  }
  $('#event-dlg').close();
  toast('Event saved');
}

/** Apply edits made on one occurrence to the whole series (shifting the series start if needed). */
function applyToSeries(master, data, occ) {
  if (!data.recurrence) return { ...master, ...data, exdates: [] };
  const mStart = eventBounds(master).start;
  if (data.allDay) {
    const shift = diffDays(occ.start, fromDateKey(data.start));
    const len = diffDays(fromDateKey(data.start), fromDateKey(data.end));
    const s = addDays(startOfDay(mStart), shift);
    return { ...master, ...data, start: toDateKey(s), end: toDateKey(addDays(s, len)) };
  }
  const ns = new Date(data.start), ne = new Date(data.end);
  const shift = diffDays(occ.start, ns);
  const base = addDays(startOfDay(mStart), shift);
  const s = new Date(base.getFullYear(), base.getMonth(), base.getDate(), ns.getHours(), ns.getMinutes());
  return { ...master, ...data, start: s.toISOString(), end: new Date(s.getTime() + (ne - ns)).toISOString() };
}

// ─────────────────────────────── Wiring ───────────────────────────────

export function initEditor() {
  const dd = $('#details-dlg');
  closeOnBackdrop(dd);
  dd.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const o = detailsOcc;
    dd.close();
    if (act === 'edit') openEditor({ occ: o });
    if (act === 'duplicate') openEditor({ duplicate: o });
    if (act === 'delete') deleteOcc(o);
    if (act === 'done') toggleDone(o);
  });

  const dlg = $('#event-dlg');
  closeOnBackdrop(dlg);
  $('#event-form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  dlg.querySelector('[data-act=cancel]').onclick = () => dlg.close();
  $('#f-allday').onchange = () => toggleAllDay();
  $('#f-cal').onchange = updateCalDot;

  // Keep the duration when the start moves (like Google Calendar).
  let prevStart = null;
  const rememberStart = () => { prevStart = { d: $('#f-sdate').value, t: $('#f-stime').value, ed: $('#f-edate').value, et: $('#f-etime').value }; };
  $('#f-sdate').addEventListener('focus', rememberStart);
  $('#f-stime').addEventListener('focus', rememberStart);
  const shiftEnd = () => {
    if (!prevStart || !$('#f-sdate').value) return;
    const allDay = $('#f-allday').checked;
    const oldS = combine(prevStart.d, allDay ? '00:00' : prevStart.t);
    const oldE = combine(prevStart.ed, allDay ? '00:00' : prevStart.et);
    const newS = combine($('#f-sdate').value, allDay ? '00:00' : $('#f-stime').value);
    const newE = new Date(newS.getTime() + Math.max(0, oldE - oldS));
    $('#f-edate').value = toDateKey(newE);
    if (!allDay) $('#f-etime').value = toTimeInput(newE);
    rememberStart();
  };
  $('#f-sdate').addEventListener('change', () => {
    shiftEnd();
    const kind = $('#f-repeat').value;
    buildRepeatOptions(kind);
    if (kind === 'custom') { customRec = readCustom(); renderCustom(); }
  });
  $('#f-stime').addEventListener('change', shiftEnd);

  $('#f-repeat').onchange = () => {
    const custom = $('#f-repeat').value === 'custom';
    $('#custom-rec').hidden = !custom;
    if (custom) renderCustom();
  };
  $('#r-freq').onchange = () => { customRec = readCustom(); customRec.freq = $('#r-freq').value; renderCustom(); };
  $('#r-days').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', b.classList.contains('on'));
  });
  $('#r-until').addEventListener('focus', () => { $('input[name=r-end][value=until]').checked = true; });
  $('#r-count').addEventListener('focus', () => { $('input[name=r-end][value=count]').checked = true; });

  $('#scope-dlg').addEventListener('cancel', () => { $('#scope-dlg').returnValue = 'cancel'; });
}

export { showDialog };
