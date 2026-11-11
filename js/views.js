// Renders the main area: Day and Week (time runs left → right) and Month.

import {
  DAY_MS, addDays, startOfDay, startOfWeek, startOfMonth, sameDay, diffDays, toDateKey,
  fmt, fmtTimeShort, fmtTimeRange, fmtHourLabel, weekdayNames,
} from './dates.js';
import { app, esc, colorOf, occurrences, isNarrow, isDone, isAutoDone, toggleDone } from './ctx.js';
import { openDetails, openEditor } from './editor.js';

// ── Ranges & titles ──

export function viewRange(view = app.view, cursor = app.cursor) {
  const ws = app.store.settings.weekStart ?? 0;
  switch (view) {
    case 'day': { const s = startOfDay(cursor); return { start: s, end: addDays(s, 1) }; }
    case 'week': { const s = startOfWeek(cursor, ws); return { start: s, end: addDays(s, 7) }; }
    default: {
      const first = startOfMonth(cursor);
      const s = startOfWeek(first, ws);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      const weeks = Math.ceil((diffDays(s, last) + 1) / 7);
      return { start: s, end: addDays(s, weeks * 7) };
    }
  }
}

export function viewTitle() {
  const c = app.cursor;
  const { start, end } = viewRange();
  const last = addDays(end, -1);
  if (isNarrow()) {
    // Phones: keep it short — "Nov", "Nov 11", or "Nov 2027" when not this year.
    const d = app.view === 'week' ? addDays(start, 3) : c;
    const thisYear = d.getFullYear() === new Date().getFullYear();
    if (app.view === 'day') return fmt(c, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
    return fmt(d, { month: 'short', ...(thisYear ? {} : { year: 'numeric' }) });
  }
  switch (app.view) {
    case 'day': return innerWidth > 1200
      ? fmt(c, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : fmt(c, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    case 'week':
      if (start.getMonth() === last.getMonth()) return fmt(start, { month: 'long', year: 'numeric' });
      if (start.getFullYear() === last.getFullYear()) return `${fmt(start, { month: 'short' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`;
      return `${fmt(start, { month: 'short', year: 'numeric' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`;
    default: return fmt(c, { month: 'long', year: 'numeric' });
  }
}

export function step(dir) {
  const c = app.cursor;
  switch (app.view) {
    case 'day': app.cursor = addDays(c, dir); break;
    case 'week': app.cursor = addDays(c, 7 * dir); break;
    default: app.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  }
}

export function goToDay(date) {
  app.cursor = startOfDay(date);
  app.setView('day');
}

// ── Shared bits ──

const isAllDayLike = (o) => o.allDay || o.end - o.start >= DAY_MS;

/** Round tick-box used to complete an event. */
function check(o) {
  const done = isDone(o);
  const auto = isAutoDone(o);
  const tip = auto ? 'Completed automatically (time has passed)' : done ? 'Mark not complete' : 'Mark complete';
  return `<span class="ck${done ? ' on' : ''}${auto ? ' auto' : ''}" data-done="${esc(o.id)}" role="checkbox" aria-checked="${done}" title="${tip}">` +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>';
}

export function renderView(el) {
  app.occMap.clear();
  if (app.view === 'day' || app.view === 'week') renderTimeline(el, app.view === 'day' ? 1 : 7);
  else renderMonth(el);
}

// ─────────────────────── Day / Week: hours across the top ───────────────────────

/** Puts overlapping events into separate horizontal lanes. Returns the lane count. */
function assignLanes(segs, minVisMinutes) {
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  const ends = [];
  for (const seg of segs) {
    const visEnd = Math.max(seg.e, seg.s + minVisMinutes);
    let i = ends.findIndex((e) => e <= seg.s);
    if (i === -1) { i = ends.length; ends.push(visEnd); } else ends[i] = visEnd;
    seg.lane = i;
  }
  return ends.length;
}

function renderTimeline(el, nDays) {
  const { start, end } = viewRange();
  const today = new Date();
  const occs = occurrences(start, end);
  const days = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  const narrow = isNarrow();
  const HW = nDays === 1 ? (narrow ? 84 : 120) : (narrow ? 64 : 96); // pixels per hour
  const LANE = nDays === 1 ? (narrow ? 58 : 66) : (narrow ? 38 : 46); // height of one event row
  const minVis = (100 / HW) * 60; // minutes that 100px covers, so short events still show a title
  const wd = weekdayNames('short');

  const prev = el.querySelector('.tl');
  const sameLayout = el.dataset.layout === `${app.view}:${toDateKey(start)}`;
  const prevLeft = prev?.scrollLeft, prevTop = prev?.scrollTop;

  let hours = '';
  for (let h = 0; h < 24; h++) hours += `<div class="tl-hour"><span>${fmtHourLabel(h)}</span></div>`;

  let rows = '';
  for (const d of days) {
    const dEnd = addDays(d, 1);
    const isToday = sameDay(d, today);

    // All-day events go in the label column on the left.
    const allDay = occs.filter((o) => isAllDayLike(o) && o.start < dEnd && o.end > d);
    const adChips = allDay.map((o) => `<div class="chip bar${isDone(o) ? ' done' : ''}" style="--c:${colorOf(o.event)}" data-occ="${esc(o.id)}" title="${esc(o.event.title)}">${check(o)}<span class="tt">${esc(o.event.title || '(No title)')}</span></div>`).join('');

    // Timed events become blocks positioned by time.
    const segs = occs.filter((o) => !isAllDayLike(o) && o.start < dEnd && o.end > d).map((o) => {
      const s = Math.max(o.start, d), e = Math.min(o.end, dEnd);
      return { o, s: (s - d) / 60000, e: Math.max((e - d) / 60000, (s - d) / 60000) };
    });
    const lanes = assignLanes(segs, minVis);
    let blocks = '';
    for (const seg of segs) {
      const { o } = seg;
      const left = (seg.s / 60) * HW;
      // At least ~100px wide so the title is readable (lanes already leave room for this).
      const width = Math.max(((seg.e - seg.s) / 60) * HW, ((minVis) / 60) * HW) - 4;
      const top = 8 + seg.lane * (LANE + 6);
      const title = esc(o.event.title || '(No title)');
      const time = fmtTimeRange(o.start, o.end);
      blocks += `<div class="tev${isDone(o) ? ' done' : ''}" data-occ="${esc(o.id)}"
        style="left:${left}px;width:${width}px;top:${top}px;height:${LANE}px;--c:${colorOf(o.event)}" title="${title}, ${esc(time)}">
        ${check(o)}<div class="tx"><div class="t">${title}</div><div class="s">${esc(time)}${o.event.location && nDays === 1 ? ` · ${esc(o.event.location)}` : ''}</div></div></div>`;
    }
    if (isToday) blocks += `<div class="now" style="left:${((today - d) / 3600000) * HW}px"></div>`;
    const trackH = 16 + Math.max(lanes, 1) * (LANE + 6);

    rows += `<div class="tl-row${isToday ? ' today' : ''}">
      <div class="tl-label" data-day="${toDateKey(d)}">
        <div class="tl-date" data-goto="${toDateKey(d)}"><span class="wd">${wd[d.getDay()]}</span><span class="dn">${d.getDate()}</span></div>
        <div class="tl-allday">${adChips}</div>
      </div>
      <div class="tl-track" data-day="${toDateKey(d)}" style="min-height:${trackH}px">${blocks}</div>
    </div>`;
  }

  el.innerHTML = `<div class="tl ${nDays === 1 ? 'tl-day' : 'tl-week'}" style="--hw:${HW}px">
    <div class="tl-inner">
      <div class="tl-head"><div class="tl-corner"></div><div class="tl-hours">${hours}</div></div>
      ${rows}
    </div></div>`;
  el.dataset.layout = `${app.view}:${toDateKey(start)}`;

  const scroller = el.querySelector('.tl');
  if (sameLayout && prevLeft != null) { scroller.scrollLeft = prevLeft; scroller.scrollTop = prevTop; }
  else {
    const inRange = today >= start && today < end;
    scroller.scrollLeft = Math.max(0, (inRange ? today.getHours() + today.getMinutes() / 60 - 1 : 7.5) * HW);
  }
  wireTimeline(el, HW);
}

function wireTimeline(el, HW) {
  // Click empty space in the all-day area to make an all-day event.
  el.querySelectorAll('.tl-allday').forEach((a) => {
    a.onclick = (e) => {
      if (e.target.closest('[data-occ],[data-done]')) return;
      const day = new Date(a.parentElement.dataset.day + 'T00:00');
      openEditor({ start: day, end: day, allDay: true });
    };
  });

  // Click (touch) or click-and-drag (mouse) on a track to create a timed event.
  el.querySelectorAll('.tl-track').forEach((track) => {
    const day = new Date(track.dataset.day + 'T00:00');
    const minsAt = (clientX) => {
      const x = clientX - track.getBoundingClientRect().left;
      return Math.max(0, Math.min(24 * 60, Math.floor((x / HW) * 60 / 15) * 15));
    };
    const at = (m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);

    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.tev')) return;
      e.preventDefault();
      const m0 = Math.floor(minsAt(e.clientX) / 30) * 30;
      let m1 = m0 + 30;
      const ghost = document.createElement('div');
      ghost.className = 'ghost';
      track.append(ghost);
      const draw = () => {
        const a = Math.min(m0, m1), b = Math.max(m0, m1);
        ghost.style.left = `${(a / 60) * HW}px`;
        ghost.style.width = `${((b - a) / 60) * HW}px`;
        ghost.textContent = fmtTimeRange(at(a), at(b));
      };
      draw();
      let moved = false;
      const move = (ev) => {
        const m = minsAt(ev.clientX);
        const nm = m >= m0 ? Math.max(m0 + 15, Math.ceil(m / 15) * 15) : m;
        if (nm !== m1) { m1 = nm; moved = true; draw(); }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ghost.remove();
        const a = Math.min(m0, m1);
        let b = Math.max(m0, m1);
        if (!moved) b = a + 60;
        openEditor({ start: at(a), end: at(b) });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    track.addEventListener('click', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.tev')) return;
      if (e.pointerType === undefined && matchMedia('(hover: hover)').matches) return; // handled by pointerdown
      const m = Math.floor(minsAt(e.clientX) / 30) * 30;
      openEditor({ start: at(m), end: at(m + 60) });
    });
  });

  // Keep the "now" line moving, and refresh when events pass (auto-complete).
  clearInterval(app._nowTimer);
  app._nowTimer = setInterval(() => {
    const now = new Date();
    const line = el.querySelector('.now');
    if (line) {
      const day = new Date(line.parentElement.dataset.day + 'T00:00');
      if (!sameDay(day, now)) { app.render(); return; }
      line.style.left = `${((now - day) / 3600000) * HW}px`;
    }
    // Something just finished? Re-draw so it shows as completed.
    const justEnded = [...app.occMap.values()].some((o) => o.end <= now && o.end > now - 60000);
    if (justEnded) app.render();
  }, 60000);
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

  el.querySelectorAll('.m-cell').forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest('[data-occ],[data-goto],[data-done]')) return;
      const day = new Date(c.dataset.day + 'T00:00');
      if (isNarrow()) { goToDay(day); return; }
      openEditor({ start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9), end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10) });
    };
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
