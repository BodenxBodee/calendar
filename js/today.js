// "Today" screen: what's on now / next with a live countdown, progress,
// a swipeable list (right = complete, left = tomorrow), free time and a peek at tomorrow.

import { DAY_MS, addDays, startOfDay, sameDay, fmt, fmtTimeShort, fmtTimeRange } from './dates.js';
import { app, esc, colorOf, calOf, occurrences, isDone, isManualDone, toggleDone } from './ctx.js';
import { parseQuick, addQuick, describeQuick } from './quickadd.js';
import { pushToTomorrow } from './editor.js';
import { check } from './views.js';

const isAllDayLike = (o) => o.allDay || o.end - o.start >= DAY_MS;
const byTime = (a, b) => (isAllDayLike(b) - isAllDayLike(a)) || a.start - b.start;

function countdown(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'less than a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''}`;
}

function timeLabel(o, day) {
  const dEnd = addDays(day, 1);
  if (isAllDayLike(o)) return 'All day';
  if (o.start < day) return `Until ${fmtTimeShort(o.end)}`;
  if (o.end > dEnd) return `${fmtTimeShort(o.start)} →`;
  return fmtTimeShort(o.start);
}

/** Free gaps between 8am and 10pm (from now, if it's today), at least 30 min long. */
function freeTime(day, timed, now) {
  let from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8);
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 22);
  if (sameDay(day, now) && now > from) from = new Date(Math.ceil(now / (15 * 60000)) * 15 * 60000);
  if (from >= to) return [];
  const busy = timed.map((o) => [Math.max(o.start, from), Math.min(o.end, to)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cur = +from;
  for (const [s, e] of busy) {
    if (s - cur >= 30 * 60000) gaps.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (to - cur >= 30 * 60000) gaps.push([cur, +to]);
  return gaps.map(([s, e]) => [new Date(s), new Date(e)]);
}

function ring(done, total) {
  const r = 26, c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return `<svg class="td-ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="bg"/>
    <circle cx="32" cy="32" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"/>
  </svg>`;
}

function row(o, day) {
  const ev = o.event;
  const cal = calOf(ev);
  const sub = [ev.location, cal.name].filter(Boolean).map(esc).join(' · ');
  return `<div class="td-wrap">
    <div class="td-bg"><span class="l">✓ Complete</span><span class="r">Tomorrow →</span></div>
    <div class="td-row${isDone(o) ? ' done' : ''}" data-occ="${esc(o.id)}" style="--c:${colorOf(ev)}">
      ${check(o)}
      <div class="td-time">${esc(timeLabel(o, day))}${!isAllDayLike(o) && o.start >= day ? `<span>${esc(fmtTimeShort(o.end))}</span>` : ''}</div>
      <div class="td-main"><div class="t">${esc(ev.title || '(No title)')}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>
      <button class="icon-btn small td-push" data-push="${esc(o.id)}" title="Move to tomorrow" aria-label="Move to tomorrow">
        <svg viewBox="0 0 24 24"><path d="M4 11h11.17l-4.58-4.59L12 5l7 7-7 7-1.41-1.41L15.17 13H4z"/></svg></button>
    </div></div>`;
}

export function renderToday(el) {
  const now = new Date();
  const day = startOfDay(app.cursor);
  const isToday = sameDay(day, now);
  const occs = occurrences(day, addDays(day, 1)).sort(byTime);
  const timed = occs.filter((o) => !isAllDayLike(o));
  const doneN = occs.filter(isDone).length;

  // Hero card: what's happening now, or next.
  let hero = '';
  if (isToday) {
    const cur = timed.find((o) => o.start <= now && o.end > now && !isManualDone(o));
    const next = timed.find((o) => o.start > now && !isManualDone(o));
    const h = cur || next;
    if (h) {
      const pct = cur ? Math.min(100, Math.max(0, ((now - cur.start) / (cur.end - cur.start)) * 100)) : 0;
      hero = `<div class="td-hero" data-occ="${esc(h.id)}" style="--c:${colorOf(h.event)}">
        <div class="lbl">${cur ? 'Happening now' : 'Up next'}</div>
        <div class="ttl">${esc(h.event.title || '(No title)')}</div>
        <div class="cd" data-cd="${cur ? +cur.end : +next.start}" data-pre="${cur ? 'Ends in ' : 'Starts in '}">${cur ? 'Ends in ' : 'Starts in '}${countdown((cur ? cur.end : next.start) - now)}</div>
        <div class="when">${esc(fmtTimeRange(h.start, h.end))}${h.event.location ? ` · ${esc(h.event.location)}` : ''}</div>
        ${cur ? `<div class="bar" data-s="${+cur.start}" data-e="${+cur.end}"><span style="width:${pct}%"></span></div>` : ''}
      </div>`;
    } else {
      hero = `<div class="td-hero empty"><div class="lbl">Up next</div><div class="ttl">${occs.length ? 'Nothing else scheduled today' : 'Nothing scheduled today'}</div>
        <div class="when">${occs.length && doneN === occs.length ? 'Everything’s done. Nice work.' : 'Enjoy the free time.'}</div></div>`;
    }
  }

  const progress = `<div class="td-progress">
      ${ring(doneN, occs.length)}
      <div><div class="big">${doneN}<span>/${occs.length}</span></div><div class="muted">${occs.length ? 'completed' : 'events'}</div></div>
    </div>`;

  const gaps = freeTime(day, timed, now);
  const free = gaps.length
    ? gaps.slice(0, 4).map(([s, e]) => `<span class="gap">${esc(e.getHours() === 22 && e.getMinutes() === 0 ? `After ${fmtTimeShort(s)}` : fmtTimeRange(s, e))}</span>`).join('')
    : '<span class="muted">No free gaps between 8am and 10pm</span>';

  let tomorrow = '';
  if (isToday) {
    const t0 = addDays(day, 1);
    const tOccs = occurrences(t0, addDays(t0, 1)).sort(byTime);
    tomorrow = `<section class="td-sec">
      <h3>Tomorrow <span class="muted">${esc(fmt(t0, { weekday: 'long', month: 'short', day: 'numeric' }))}</span></h3>
      ${tOccs.length ? `<div class="td-peek">${tOccs.slice(0, 6).map((o) => `<div class="pk" data-occ="${esc(o.id)}" style="--c:${colorOf(o.event)}"><span class="dot"></span><span class="tm">${esc(timeLabel(o, t0))}</span><span class="tt">${esc(o.event.title || '(No title)')}</span></div>`).join('')}${tOccs.length > 6 ? `<div class="pk more" data-goto-today="1">+${tOccs.length - 6} more</div>` : ''}</div>`
        : '<p class="muted">Nothing yet.</p>'}
    </section>`;
  }

  const qaVal = el.querySelector('#td-qa-input')?.value || '';
  const hadFocus = document.activeElement?.id === 'td-qa-input';

  el.innerHTML = `<div class="today">
    <div class="td-col">
      <form class="td-qa" id="td-qa" autocomplete="off">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        <input id="td-qa-input" placeholder="${isToday ? 'Add to today… e.g. “Call mom 5pm”' : `Add to ${esc(fmt(day, { weekday: 'long' }))}…`}" enterkeyhint="done" spellcheck="false" aria-label="Quick add">
      </form>
      <div class="td-qa-preview" id="td-qa-preview"></div>
      <div class="td-top">${hero}${progress}</div>
      <section class="td-sec">
        <h3>${isToday ? 'Today' : esc(fmt(day, { weekday: 'long', month: 'long', day: 'numeric' }))} <span class="muted">${occs.length} event${occs.length === 1 ? '' : 's'}</span></h3>
        ${occs.length ? `<div class="td-list">${occs.map((o) => row(o, day)).join('')}</div><p class="td-tip muted">Tip: swipe right to complete, left to push to tomorrow.</p>`
          : '<p class="muted td-empty">No events. Type one above to add it.</p>'}
      </section>
      <section class="td-sec"><h3>Free time</h3><div class="td-free">${free}</div></section>
      ${tomorrow}
    </div></div>`;
  delete el.dataset.layout;

  const input = el.querySelector('#td-qa-input');
  input.value = qaVal;
  if (hadFocus) input.focus();
  wireToday(el, day);
}

function wireToday(el, day) {
  // Inline quick add (defaults to the day being viewed)
  const input = el.querySelector('#td-qa-input');
  const prev = el.querySelector('#td-qa-preview');
  const parse = () => (input.value.trim() ? parseQuick(input.value, day, app.store.calendars) : null);
  const showPreview = () => {
    const p = parse();
    if (!p) { prev.textContent = ''; return; }
    const { when, repeat } = describeQuick(p);
    prev.textContent = `“${p.title}” · ${when}${repeat ? ` · ${repeat}` : ''}`;
  };
  input.addEventListener('input', showPreview);
  showPreview();
  el.querySelector('#td-qa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = parse();
    if (!p) return;
    input.value = '';
    prev.textContent = '';
    await addQuick(p);
  });

  el.querySelectorAll('[data-goto-today]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); app.cursor = addDays(day, 1); app.render(); }; });

  // Swipe gestures on touch screens
  el.querySelectorAll('.td-row').forEach((rowEl) => wireSwipe(rowEl));

  // Live countdown; full refresh when something starts or ends.
  clearInterval(app._todayTimer);
  const boundaries = [...app.occMap.values()].flatMap((o) => [+o.start, +o.end]);
  let last = Date.now();
  app._todayTimer = setInterval(() => {
    const now = Date.now();
    el.querySelectorAll('[data-cd]').forEach((c) => { c.textContent = c.dataset.pre + countdown(Number(c.dataset.cd) - now); });
    const bar = el.querySelector('.td-hero .bar');
    if (bar) bar.firstElementChild.style.width = `${Math.min(100, ((now - bar.dataset.s) / (bar.dataset.e - bar.dataset.s)) * 100)}%`;
    const crossed = boundaries.some((b) => b > last && b <= now) || !sameDay(new Date(last), new Date(now));
    last = now;
    const busy = document.activeElement?.id === 'td-qa-input' || document.querySelector('dialog[open]') || el.querySelector('.td-row.swiping');
    if (crossed && !busy) app.render();
  }, 30000);
}

function wireSwipe(rowEl) {
  const wrap = rowEl.parentElement;
  let sx = 0, sy = 0, dx = 0, tracking = false, swiping = false, pid = null;
  const reset = () => {
    rowEl.style.transition = 'transform .2s ease';
    rowEl.style.transform = '';
    wrap.classList.remove('go-done', 'go-push', 'sw');
    rowEl.classList.remove('swiping');
    setTimeout(() => { rowEl.style.transition = ''; }, 220);
  };
  rowEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('.ck, .td-push')) return;
    sx = e.clientX; sy = e.clientY; dx = 0; tracking = true; swiping = false; pid = e.pointerId;
  });
  rowEl.addEventListener('pointermove', (e) => {
    if (!tracking || e.pointerId !== pid) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!swiping) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        swiping = true;
        rowEl.classList.add('swiping');
        wrap.classList.add('sw');
        try { rowEl.setPointerCapture(pid); } catch { /* ignore */ }
      } else if (Math.abs(dy) > 12) { tracking = false; return; }
    }
    if (swiping) {
      const damp = Math.sign(dx) * Math.min(Math.abs(dx), 160 + Math.max(0, Math.abs(dx) - 160) * 0.25);
      rowEl.style.transform = `translateX(${damp}px)`;
      wrap.classList.toggle('go-done', dx > 80);
      wrap.classList.toggle('go-push', dx < -80);
    }
  });
  const end = () => {
    if (!tracking) return;
    tracking = false;
    if (!swiping) return;
    rowEl._swiped = true;
    setTimeout(() => { rowEl._swiped = false; }, 400);
    const o = app.occMap.get(rowEl.dataset.occ);
    if (o && dx > 80) {
      rowEl.style.transition = 'transform .18s ease';
      rowEl.style.transform = 'translateX(100%)';
      setTimeout(() => { reset(); toggleDone(o); }, 170);
    } else if (o && dx < -80) {
      rowEl.style.transition = 'transform .18s ease';
      rowEl.style.transform = 'translateX(-100%)';
      setTimeout(() => { reset(); pushToTomorrow(o); }, 170);
    } else reset();
  };
  rowEl.addEventListener('pointerup', end);
  rowEl.addEventListener('pointercancel', () => { tracking = false; if (swiping) reset(); });
  // A swipe shouldn't also count as a tap that opens the event.
  rowEl.addEventListener('click', (e) => { if (rowEl._swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
}
