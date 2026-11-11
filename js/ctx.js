// Shared app state + small UI helpers used by every module.

import { expandAll } from './recurrence.js';

export const app = {
  store: null,
  view: 'week',
  cursor: new Date(),
  agendaDays: 60,
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
export const colorOf = (ev) => calOf(ev).color || '#039be5';

export function visibleEvents() {
  const hidden = new Set(app.store.calendars.filter((c) => c.hidden).map((c) => c.id));
  return app.store.events.filter((e) => !hidden.has(e.calendarId));
}

export function occurrences(start, end) {
  const list = expandAll(visibleEvents(), start, end);
  for (const o of list) app.occMap.set(o.id, o);
  return list;
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
