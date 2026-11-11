// Renders the main area: Day, Week, Month and Schedule (agenda) views.

import {
  DAY_MS, addDays, startOfDay, startOfWeek, startOfMonth, sameDay, diffDays, toDateKey,
  fmt, fmtTimeShort, fmtTimeRange, fmtHourLabel, weekdayNames,
} from './dates.js';
import { app, esc, colorOf, occurrences, isNarrow } from './ctx.js';
import { openDetails, openEditor } from './editor.js';

// ── Ranges & titles ──

export function viewRange(view = app.view, cursor = app.cursor) {
  const ws = app.store.settings.weekStart ?? 0;
  switch (view) {
    case 'day': { const s = startOfDay(cursor); return { start: s, end: addDays(s, 1) }; }
    case 'week': { const s = startOfWeek(cursor, ws); return { start: s, end: addDays(s, 7) }; }
    case 'month': {
      const first = startOfMonth(cursor);
      const s = startOfWeek(first, ws);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      const weeks = Math.ceil((diffDays(s, last) + 1) / 7);
      return { start: s, end: addDays(s, weeks * 7) };
    }
    default: { const s = startOfDay(cursor); return { start: s, end: addDays(s, app.agendaDays) }; }
  }
}

export function viewTitle() {
  const c = app.cursor;
  const narrow = isNarrow();
  const { start, end } = viewRange();
  const last = addDays(end, -1);
  switch (app.view) {
    case 'day': return narrow ? fmt(c, { month: 'short', day: 'numeric', year: 'numeric' }) : fmt(c, { month: 'long', day: 'numeric', year: 'numeric' });
    case 'week':
      if (start.getMonth() === last.getMonth()) return fmt(start, { month: narrow ? 'short' : 'long', year: 'numeric' });
      if (start.getFullYear() === last.getFullYear()) return `${fmt(start, { month: 'short' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`;
      return `${fmt(start, { month: 'short', year: 'numeric' })} – ${fmt(last, { month: 'short', year: 'numeric' })}`;
    case 'month': return fmt(c, { month: narrow ? 'short' : 'long', year: 'numeric' });
    default: return fmt(c, { month: narrow ? 'short' : 'long', year: 'numeric' });
  }
}

export function step(dir) {
  const c = app.cursor;
  switch (app.view) {
    case 'day': app.cursor = addDays(c, dir); break;
    case 'week': app.cursor = addDays(c, 7 * dir); break;
    case 'month': app.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1); break;
    default: app.cursor = addDays(c, 30 * dir); app.agendaDays = 60;
  }
}

export function goToDay(date) {
  app.cursor = startOfDay(date);
  app.setView('day');
}

// ── Main render ──

const isPast = (o) => o.end < new Date();

export function renderView(el) {
  app.occMap.clear();
  if (app.view === 'month') renderMonth(el);
  else if (app.view === 'agenda') renderAgenda(el);
  else renderTimeGrid(el, app.view === 'day' ? 1 : 7);
}

// ───────────────────────── Day / Week (time grid) ─────────────────────────

const isAllDayLike = (o) => o.allDay || o.end - o.start >= DAY_MS;

function layoutColumns(segs) {
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], cols = [], clusterEnd = -Infinity;
  const finish = () => { cluster.forEach((x) => { x.cols = cols.length; }); cluster = []; cols = []; };
  for (const seg of segs) {
    const visEnd = Math.max(seg.e, seg.s + 25); // minutes; short events still need room
    if (cluster.length && seg.s >= clusterEnd) { finish(); clusterEnd = -Infinity; }
    let i = cols.findIndex((end) => end <= seg.s);
    if (i === -1) { i = cols.length; cols.push(visEnd); } else cols[i] = visEnd;
    seg.col = i;
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, visEnd);
  }
  finish();
}

function renderTimeGrid(el, nDays) {
  const { start, end } = viewRange();
  const today = new Date();
  const occs = occurrences(start, end);
  const days = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  const wdNames = weekdayNames('short');
  const prevScroll = el.querySelector('.tg-scroll')?.scrollTop;
  const sameLayout = el.dataset.layout === `${app.view}:${toDateKey(start)}`;

  // Header
  let head = '<div class="tg-gutter"></div>';
  for (const d of days) {
    head += `<div class="tg-dayhead${sameDay(d, today) ? ' today' : ''}" data-day="${toDateKey(d)}">
      <div class="wd">${wdNames[d.getDay()]}</div><div class="dn">${d.getDate()}</div></div>`;
  }

  // All-day row
  const allDay = occs.filter(isAllDayLike);
  let ad = '<div class="gl"></div>';
  const MAX_AD = nDays === 1 ? 8 : 3;
  for (const d of days) {
    const dEnd = addDays(d, 1);
    const items = allDay.filter((o) => o.start < dEnd && o.end > d);
    let chips = '';
    items.slice(0, items.length > MAX_AD ? MAX_AD - 1 : MAX_AD).forEach((o) => {
      const contL = o.start < d && !sameDay(d, start);
      const contR = o.end > dEnd && !sameDay(d, days[days.length - 1]);
      chips += `<div class="chip bar${contL ? ' cont-l' : ''}${contR ? ' cont-r' : ''}${isPast(o) ? ' past' : ''}" style="--c:${colorOf(o.event)}" data-occ="${esc(o.id)}" title="${esc(o.event.title)}">${esc(o.event.title || '(No title)')}</div>`;
    });
    if (items.length > MAX_AD) chips += `<div class="more" data-goto="${toDateKey(d)}">${items.length - MAX_AD + 1} more</div>`;
    ad += `<div class="ad" data-day="${toDateKey(d)}">${chips}</div>`;
  }

  // Hours gutter
  let hours = '<div class="tg-hours">';
  for (let h = 0; h < 24; h++) hours += `<div><span>${fmtHourLabel(h)}</span></div>`;
  hours += '</div>';

  // Columns with timed events
  const H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 48;
  let cols = '';
  for (const d of days) {
    const dEnd = addDays(d, 1);
    const segs = occs.filter((o) => !isAllDayLike(o) && o.start < dEnd && o.end > d).map((o) => {
      const s = Math.max(o.start, d), e = Math.min(o.end, dEnd);
      return { o, s: (s - d) / 60000, e: Math.max((e - d) / 60000, (s - d) / 60000) };
    });
    layoutColumns(segs);
    let html = '';
    for (const seg of segs) {
      const { o } = seg;
      const top = (seg.s / 60) * H;
      const height = Math.max(((seg.e - seg.s) / 60) * H - 2, 16);
      const w = 100 / seg.cols;
      const short = height < 34;
      const title = esc(o.event.title || '(No title)');
      const time = fmtTimeRange(o.start, o.end);
      html += `<div class="tev${short ? ' short' : ''}${isPast(o) ? ' past' : ''}" data-occ="${esc(o.id)}"
        style="top:${top}px;height:${height}px;left:calc(${seg.col * w}% + 1px);width:calc(${w}% - 4px);background:${colorOf(o.event)}"
        title="${title}, ${esc(time)}">
        ${short ? `<span class="t">${title}</span><span class="s">${fmtTimeShort(o.start)}</span>`
          : `<div class="t">${title}</div><div class="s">${esc(time)}</div>${o.event.location && height > 50 ? `<div class="s">${esc(o.event.location)}</div>` : ''}`}
      </div>`;
    }
    if (sameDay(d, today)) html += `<div class="now" style="top:${((today - d) / 3600000) * H}px"></div>`;
    cols += `<div class="tg-col" data-day="${toDateKey(d)}">${html}</div>`;
  }

  el.innerHTML = `<div class="tg" style="--days:${nDays}">
    <div class="tg-head">${head}</div>
    <div class="tg-allday">${ad}</div>
    <div class="tg-scroll"><div class="tg-body">${hours}${cols}</div></div>
  </div>`;
  el.dataset.layout = `${app.view}:${toDateKey(start)}`;

  const scroller = el.querySelector('.tg-scroll');
  if (sameLayout && prevScroll != null) scroller.scrollTop = prevScroll;
  else {
    const inRange = today >= start && today < end;
    scroller.scrollTop = Math.max(0, ((inRange ? today.getHours() + today.getMinutes() / 60 - 1.5 : 7.5) * H));
  }

  wireGrid(el, H);
}

function wireGrid(el, H) {
  el.querySelectorAll('.tg-dayhead').forEach((h) => { h.onclick = () => goToDay(new Date(h.dataset.day + 'T00:00')); });
  el.querySelectorAll('.ad').forEach((a) => {
    a.onclick = (e) => {
      if (e.target.closest('[data-occ],[data-goto]')) return;
      const day = new Date(a.dataset.day + 'T00:00');
      openEditor({ start: day, end: day, allDay: true });
    };
  });

  // Click (touch) or click-and-drag (mouse) on empty space to create an event.
  el.querySelectorAll('.tg-col').forEach((col) => {
    const day = new Date(col.dataset.day + 'T00:00');
    const minsAt = (clientY) => {
      const y = clientY - col.getBoundingClientRect().top;
      return Math.max(0, Math.min(24 * 60, Math.floor((y / H) * 60 / 15) * 15));
    };
    const at = (m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);

    col.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.tev')) return;
      e.preventDefault();
      const m0 = Math.floor(minsAt(e.clientY) / 30) * 30;
      let m1 = m0 + 30;
      const ghost = document.createElement('div');
      ghost.className = 'ghost';
      col.append(ghost);
      const draw = () => {
        const a = Math.min(m0, m1), b = Math.max(m0, m1);
        ghost.style.top = `${(a / 60) * H}px`;
        ghost.style.height = `${((b - a) / 60) * H}px`;
        ghost.textContent = fmtTimeRange(at(a), at(b));
      };
      draw();
      let moved = false;
      const move = (ev) => {
        const m = minsAt(ev.clientY);
        const nm = m >= m0 ? Math.max(m0 + 15, Math.ceil(m / 15) * 15) : m;
        if (nm !== m1) { m1 = nm; moved = true; draw(); }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ghost.remove();
        let a = Math.min(m0, m1), b = Math.max(m0, m1);
        if (!moved) b = a + 60;
        openEditor({ start: at(a), end: at(b) });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    col.addEventListener('click', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.tev')) return;
      if (e.pointerType === undefined && matchMedia('(hover: hover)').matches) return; // handled by pointerdown
      const m = Math.floor(minsAt(e.clientY) / 30) * 30;
      openEditor({ start: at(m), end: at(m + 60) });
    });
  });

  // Keep the red "now" line moving.
  clearInterval(app._nowTimer);
  app._nowTimer = setInterval(() => {
    const now = new Date();
    const line = el.querySelector('.now');
    if (!line) return;
    const col = line.parentElement;
    const day = new Date(col.dataset.day + 'T00:00');
    if (!sameDay(day, now)) { app.render(); return; }
    line.style.top = `${((now - day) / 3600000) * H}px`;
  }, 60000);
}

// ───────────────────────────── Month ─────────────────────────────

function renderMonth(el) {
  const { start, end } = viewRange();
  const today = new Date();
  const month = app.cursor.getMonth();
  const occs = occurrences(start, end);
  const ws = app.store.settings.weekStart ?? 0;
  const names = weekdayNames(isNarrow() ? 'narrow' : 'short');
  const nDays = diffDays(start, end);

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
      const past = isPast(o) ? ' past' : '';
      if (isAllDayLike(o)) {
        const contL = o.start < d && d.getDay() !== ws;
        const contR = o.end > dEnd && dEnd.getDay() !== ws;
        chips += `<div class="chip bar${contL ? ' cont-l' : ''}${contR ? ' cont-r' : ''}${past}" style="--c:${colorOf(o.event)}" data-occ="${esc(o.id)}" title="${title}">${title}</div>`;
      } else {
        chips += `<div class="chip dotted${past}" style="--c:${colorOf(o.event)}" data-occ="${esc(o.id)}" title="${title}"><span class="tm">${fmtTimeShort(o.start)}</span><span class="tt">${title}</span></div>`;
      }
    }
    const label = d.getDate() === 1 && !isNarrow() ? fmt(d, { month: 'short', day: 'numeric' }) : d.getDate();
    cells += `<div class="m-cell${d.getMonth() !== month ? ' other' : ''}${sameDay(d, today) ? ' today' : ''}" data-day="${toDateKey(d)}">
      <div class="dn"><span data-goto="${toDateKey(d)}">${label}</span></div>${chips}</div>`;
  }

  el.innerHTML = `<div class="month"><div class="m-head">${head}</div><div class="m-grid" style="grid-template-rows:repeat(${nDays / 7}, minmax(0,1fr))">${cells}</div></div>`;
  delete el.dataset.layout;
  fitMonthCells(el);

  el.querySelectorAll('.m-cell').forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest('[data-occ],[data-goto]')) return;
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
    const avail = cell.clientHeight - cell.querySelector('.dn').offsetHeight - 2;
    const chipH = chips[0].offsetHeight + 1;
    const fit = Math.max(0, Math.floor(avail / chipH));
    if (chips.length <= fit) continue;
    const show = Math.max(0, fit - 1);
    chips.slice(show).forEach((c) => c.remove());
    const more = document.createElement('div');
    more.className = 'more';
    more.dataset.goto = cell.dataset.day;
    more.textContent = show === 0 && isNarrow() ? `+${chips.length}` : `${chips.length - show} more`;
    cell.append(more);
  }
}

// ───────────────────────────── Schedule ─────────────────────────────

function renderAgenda(el) {
  const { start, end } = viewRange();
  const today = new Date();
  const occs = occurrences(start, end);
  let html = '';
  const nDays = diffDays(start, end);
  for (let i = 0; i < nDays; i++) {
    const d = addDays(start, i);
    const dEnd = addDays(d, 1);
    const items = occs.filter((o) => o.start < dEnd && o.end > d);
    if (!items.length) continue;
    items.sort((a, b) => (isAllDayLike(b) - isAllDayLike(a)) || a.start - b.start);
    let list = '';
    for (const o of items) {
      let tm;
      if (o.allDay) tm = 'All day';
      else if (o.start >= d && o.end <= dEnd) tm = fmtTimeRange(o.start, o.end);
      else if (o.start < d && o.end > dEnd) tm = 'All day';
      else if (o.start < d) tm = `Until ${fmtTimeShort(o.end)}`;
      else tm = `${fmtTimeShort(o.start)} –`;
      list += `<div class="ag-ev${isPast(o) ? ' past' : ''}" data-occ="${esc(o.id)}" style="--c:${colorOf(o.event)}">
        <span class="dot"></span><span class="tm">${esc(tm)}</span>
        <span class="tt">${esc(o.event.title || '(No title)')}${o.event.location ? `<div class="loc">${esc(o.event.location)}</div>` : ''}</span></div>`;
    }
    html += `<div class="ag-day${sameDay(d, today) ? ' today' : ''}">
      <div class="ag-date" data-goto="${toDateKey(d)}"><span class="dn">${d.getDate()}</span><span class="wd">${fmt(d, { month: 'short' })}, ${fmt(d, { weekday: 'short' })}</span></div>
      <div class="ag-list">${list}</div></div>`;
  }
  if (!html) html = `<div class="ag-empty">Nothing planned between ${fmt(start, { month: 'short', day: 'numeric' })} and ${fmt(addDays(end, -1), { month: 'short', day: 'numeric', year: 'numeric' })}.</div>`;
  html += `<button class="btn ag-more" id="ag-more">Show more</button>`;
  const prev = el.querySelector('.agenda')?.scrollTop;
  el.innerHTML = `<div class="agenda">${html}</div>`;
  if (el.dataset.layout === `agenda:${toDateKey(start)}` && prev) el.querySelector('.agenda').scrollTop = prev;
  el.dataset.layout = `agenda:${toDateKey(start)}`;
  el.querySelector('#ag-more').onclick = () => { app.agendaDays += 60; app.render(); };
}

// ── Shared click handling (event chips, "more", day numbers) ──

export function wireViewClicks(el) {
  el.addEventListener('click', (e) => {
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
