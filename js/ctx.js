// Shared app state + small UI helpers used by every module.

import { expandAll } from './recurrence.js';

export const app = {
  store: null,
  view: 'today',
  cursor: new Date(),
  occMap: new Map(), // rendered occurrence id -> occurrence
  render: () => {},
};

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function linkify(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

export const isNarrow = () => window.matchMedia('(max-width: 800px)').matches;

// ── Calendars & occurrences ──

export function calOf(ev) {
  return app.store.calendarById(ev.calendarId) || { id: ev.calendarId, name: 'Calendar', color: '#616161' };
}
export const colorOf = (ev) => calOf(ev).color || '#8c1d2f';

export function visibleEvents() {
  const hidden = new Set(app.store.calendars.filter((c) => c.hidden).map((c) => c.id));
  return app.store.events.filter((e) => !hidden.has(e.calendarId));
}

export function occurrences(start, end) {
  const list = expandAll(visibleEvents(), start, end);
  for (const o of list) app.occMap.set(o.id, o);
  return list;
}

// ── Completing events ──
// An occurrence is complete if you ticked it (its date key is in event.doneKeys),
// or automatically once its end time has passed (all-day: at the end of the day).

export const isAutoDone = (o) => o.end <= new Date();
export const isManualDone = (o) => (o.event.doneKeys || []).includes(o.key);
export const isDone = (o) => isManualDone(o) || isAutoDone(o);

export async function toggleDone(o) {
  const master = app.store.eventById(o.event.id);
  if (!master) return;
  if (isAutoDone(o)) { toast('This event has already passed, so it’s completed automatically.'); return; }
  const keys = new Set(master.doneKeys || []);
  const nowDone = !keys.has(o.key);
  if (nowDone) keys.add(o.key); else keys.delete(o.key);
  await app.store.saveEvent({ ...master, doneKeys: [...keys] });
  toast(nowDone ? 'Marked complete' : 'Marked not complete');
}

// ── Toast ──

let toastTimer;
export function toast(msg, action, ms = 5000) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ── Promise-based dialogs ──

export function showDialog(dlg) {
  return new Promise((resolve) => {
    dlg.returnValue = '';
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue); };
    dlg.addEventListener('close', done);
    dlg.showModal();
  });
}

export async function confirmDialog(text, okLabel = 'Delete') {
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  return (await showDialog($('#confirm-dlg'))) === 'ok';
}

/** Asks which occurrences of a repeating event to change. Resolves 'this'|'following'|'all'|null */
export async function askScope(title, allowThis = true) {
  const dlg = $('#scope-dlg');
  $('#scope-title').textContent = title;
  const thisRadio = dlg.querySelector('input[value=this]');
  thisRadio.closest('label').hidden = !allowThis;
  (allowThis ? thisRadio : dlg.querySelector('input[value=all]')).checked = true;
  const r = await showDialog(dlg);
  if (r !== 'ok') return null;
  return dlg.querySelector('input[name=scope]:checked').value;
}

// Close dialogs when tapping the dark backdrop.
export function closeOnBackdrop(dlg) {
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close('cancel');
  });
}
