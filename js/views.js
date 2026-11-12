// Renders the main area: the Today screen and Month.

import {
  DAY_MS, addDays, startOfDay, startOfWeek, startOfMonth, sameDay, diffDays, toDateKey,
  fmt, fmtTimeShort, weekdayNames,
} from './dates.js';
import { app, esc, colorOf, occurrences, isNarrow, isDone, isAutoDone, toggleDone } from './ctx.js';
import { openDetails, rescheduleOcc, pushToTomorrow } from './editor.js';
import { renderToday } from './today.js';
import { openQuickAdd } from './quickadd.js';

// ── Ranges & titles ──

export function viewRange(view = app.view, cursor = app.cursor) {
  if (view === 'today') { const s = startOfDay(cursor); return { start: s, end: addDays(s, 1) }; }
  const ws = app.store.settings.weekStart ?? 0;
  const first = startOfMonth(cursor);
  const s = startOfWeek(first, ws);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const weeks = Math.ceil((diffDays(s, last) + 1) / 7);
  return { start: s, end: addDays(s, weeks * 7) };
}

export function viewTitle() {
  const c = app.cursor;
  const narrow = isNarrow();
  if (app.view === 'today') {
    const isToday = sameDay(c, new Date());
    if (narrow) return isToday ? 'Today' : fmt(c, { weekday: 'short', month: 'short', day: 'numeric' });
    const d = fmt(c, innerWidth > 1200 ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
    return isToday ? `Today · ${d}` : d;
  }
  // Month. Phones: "Nov", or "Nov 2027" when not this year.
  if (narrow) return fmt(c, { month: 'short', ...(c.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
  return fmt(c, { month: 'long', year: 'numeric' });
}

export function step(dir) {
  const c = app.cursor;
  if (app.view === 'today') app.cursor = addDays(c, dir);
  else app.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
}

/** Open the Today screen for a particular date (from Month's day numbers and "+N more"). */
export function goToDay(date) {
  app.cursor = startOfDay(date);
  app.setView('today');
}

// ── Shared bits ──

const isAllDayLike = (o) => o.allDay || o.end - o.start >= DAY_MS;

/** Round tick-box used to complete an event. */
export function check(o) {
  const done = isDone(o);
  const auto = isAutoDone(o);
  const tip = auto ? 'Completed automatically (time has passed)' : done ? 'Mark not complete' : 'Mark complete';
  return `<span class="ck${done ? ' on' : ''}${auto ? ' auto' : ''}" data-done="${esc(o.id)}" role="checkbox" aria-checked="${done}" title="${tip}">` +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>';
}

export function renderView(el) {
  app.occMap.clear();
  clearInterval(app._todayTimer);
  if (app.view === 'today') renderToday(el);
  else renderMonth(el);
}

// ───────────────────────────── Month ─────────────────────────────

function renderMonth(el) {
  const { start, end } = viewRange();
  const today = new Date();
  const month = app.cursor.getMonth();
  const occs = occurrences(start, end);
  const ws = app.store.settings.weekStart ?? 0;
  const names = weekdayNames(isNarrow() ? 'narrow' : innerWidth > 1100 ? 'long' : 'short');
  const nDays = diffDays(start, end);
  const prevTop = el.querySelector('.m-grid')?.scrollTop;
  const sameLayout = el.dataset.layout === `month:${toDateKey(start)}`;

  let head = '';
  for (let i = 0; i < 7; i++) head += `<div>${names[(ws + i) % 7]}</div>`;

  let cells = '';
  for (let i = 0; i < nDays; i++) {
    const d = addDays(start, i);
    const dEnd = addDays(d, 1);
    const items = occs.filter((o) => o.start < dEnd && o.end > d);
    items.sort((a, b) => (isAllDayLike(b) - isAllDayLike(a)) || a.start - b.start);
    let chips = '';
    for (const o of items) {
      const title = esc(o.event.title || '(No title)');
      const done = isDone(o) ? ' done' : '';
      if (isAllDayLike(o)) {
        const contL = o.start < d && d.getDay() !== ws;
        const contR = o.end > dEnd && dEnd.getDay() !== ws;
        chips += `<div class="chip bar${contL ? ' cont-l' : ''}${contR ? ' cont-r' : ''}${done}" style="--c:${colorOf(o.event)}" data-occ="${esc(o.id)}" title="${title}">${check(o)}<span class="tt">${title}</span></div>`;
      } else {
        chips += `<div class="chip soft${done}" style="--c:${colorOf(o.event)}" data-occ="${esc(o.id)}" title="${title}">${check(o)}<span class="tm">${fmtTimeShort(o.start)}</span><span class="tt">${title}</span></div>`;
      }
    }
    const label = d.getDate() === 1 && !isNarrow() ? fmt(d, { month: 'short', day: 'numeric' }) : d.getDate();
    // Tint the day card with the colour of its first event.
    const tint = items.length ? colorOf(items[0].event) : null;
    cells += `<div class="m-cell${d.getMonth() !== month ? ' other' : ''}${sameDay(d, today) ? ' today' : ''}${tint ? ' tinted' : ''}"${tint ? ` style="--tint:${tint}"` : ''} data-day="${toDateKey(d)}">
      <div class="dn"><span data-goto="${toDateKey(d)}">${label}</span></div>${chips}</div>`;
  }

  el.innerHTML = `<div class="month"><div class="m-head strip">${head}</div><div class="m-grid" style="grid-template-rows:repeat(${nDays / 7}, minmax(var(--row-min), 1fr))">${cells}</div></div>`;
  if (sameLayout && prevTop) el.querySelector('.m-grid').scrollTop = prevTop;
  el.dataset.layout = `month:${toDateKey(start)}`;
  fitMonthCells(el);

  wireMonthDrag(el);

  el.querySelectorAll('.m-cell').forEach((c) => {
    c.onclick = (e) => {
      if (app._dragJustEnded || e.target.closest('[data-occ],[data-goto],[data-done]')) return;
      const day = new Date(c.dataset.day + 'T00:00');
      // Phone: open that day. Mac: quick add straight onto that day.
      if (isNarrow()) { goToDay(day); return; }
      e.stopPropagation(); // keep the click from closing the box it just opened
      openQuickAdd(day);
    };
  });
}

/** Drag an event chip onto another day (mouse). */
function wireMonthDrag(el) {
  el.querySelectorAll('.m-cell .chip').forEach((chip) => {
    chip.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.ck')) return;
      const o = app.occMap.get(chip.dataset.occ);
      if (!o) return;
      e.preventDefault();
      const fromDay = new Date(chip.closest('.m-cell').dataset.day + 'T00:00');
      const sx = e.clientX, sy = e.clientY;
      const rect = chip.getBoundingClientRect();
      let ghost = null, target = null;
      const move = (m) => {
        if (!ghost) {
          if (Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
          ghost = chip.cloneNode(true);
          ghost.classList.add('drag-ghost');
          ghost.style.width = `${rect.width}px`;
          document.body.append(ghost);
          chip.classList.add('drag-src');
        }
        ghost.style.left = `${m.clientX - (sx - rect.left)}px`;
        ghost.style.top = `${m.clientY - (sy - rect.top)}px`;
        const cell = document.elementFromPoint(m.clientX, m.clientY)?.closest('.m-cell');
        if (cell !== target) { target?.classList.remove('drop'); target = cell; target?.classList.add('drop'); }
      };
      const up = async () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!ghost) return; // plain click
        ghost.remove();
        chip.classList.remove('drag-src');
        target?.classList.remove('drop');
        app._dragJustEnded = true;
        setTimeout(() => { app._dragJustEnded = false; }, 60);
        if (!target) return;
        const dDay = diffDays(fromDay, new Date(target.dataset.day + 'T00:00'));
        if (dDay) await rescheduleOcc(o, addDays(o.start, dDay), addDays(o.end, dDay));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });
}

/** Hide chips that don't fit and add "N more". */
function fitMonthCells(el) {
  for (const cell of el.querySelectorAll('.m-cell')) {
    const chips = [...cell.querySelectorAll('.chip')];
    if (!chips.length) continue;
    const cs = getComputedStyle(cell);
    const gap = parseFloat(cs.rowGap) || 0;
    const avail = cell.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - cell.querySelector('.dn').offsetHeight;
    const chipH = chips[0].offsetHeight + gap;
    const fit = Math.max(0, Math.floor((avail + gap) / chipH));
    if (chips.length <= fit) continue;
    // Too many: keep as many chips as fit above a small "+N more" line.
    const more = document.createElement('div');
    more.className = 'more';
    more.dataset.goto = cell.dataset.day;
    more.textContent = '+0 more';
    cell.append(more);
    const moreH = more.offsetHeight + gap;
    const show = Math.max(0, Math.floor((avail - moreH + gap) / chipH));
    chips.slice(show).forEach((c) => c.remove());
    more.textContent = isNarrow() ? `+${chips.length - show}` : `+${chips.length - show} more`;
  }
}

// ── Shared click handling (tick boxes, events, "more", day numbers) ──

export function wireViewClicks(el) {
  el.addEventListener('click', (e) => {
    if (app._dragJustEnded) return; // a drag shouldn't also open the event
    const push = e.target.closest('[data-push]');
    if (push) {
      e.stopPropagation();
      const o = app.occMap.get(push.dataset.push);
      if (o) pushToTomorrow(o);
      return;
    }
    const ck = e.target.closest('[data-done]');
    if (ck) {
      e.stopPropagation();
      const o = app.occMap.get(ck.dataset.done);
      if (o) toggleDone(o);
      return;
    }
    const occEl = e.target.closest('[data-occ]');
    if (occEl) {
      e.stopPropagation();
      const o = app.occMap.get(occEl.dataset.occ);
      if (o) openDetails(o);
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) { e.stopPropagation(); goToDay(new Date(go.dataset.goto + 'T00:00')); }
  });
}
