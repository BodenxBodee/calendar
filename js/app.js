// App entry point: start-up, sign-in, top bar, shortcuts.

import { createStore, COLORS } from './store.js';
import { app, $, $$, esc, toast, showDialog, confirmDialog, closeOnBackdrop, isNarrow } from './ctx.js';
import { renderView, viewTitle, step, wireViewClicks } from './views.js';
import { initEditor } from './editor.js';
import { initSettings, openSettings } from './settings.js';
import { initQuickAdd, openQuickAdd, closeQuickAdd } from './quickadd.js';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ───────────────────────────── Rendering ─────────────────────────────

let renderQueued = false;
app.render = () => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNow(); });
};

function renderNow() {
  if (!app.store?.user || $('#app').hidden) return;
  $('#title').textContent = viewTitle();
  document.title = `Calendar – ${viewTitle()}`;
  $$('#view-seg button').forEach((b) => {
    const on = b.dataset.view === app.view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  renderView($('#view'));
  renderCalList();
  renderSync();
}

app.setView = (v) => {
  app.view = v;
  LS.set('cal-view', v);
  app.render();
};

// ───────────────────────────── Calendars list ─────────────────────────────

function renderCalList() {
  const cals = [...app.store.calendars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  $('#cal-list').innerHTML = cals.map((c) => `
    <li><label style="--c:${esc(c.color)}"><input type="checkbox" data-toggle="${esc(c.id)}" ${c.hidden ? '' : 'checked'}><span>${esc(c.name)}</span></label>
    <button class="icon-btn small" data-edit-cal="${esc(c.id)}" aria-label="Edit ${esc(c.name)}" title="Edit"><svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></button></li>`).join('');
}

let calColor = COLORS[6].value;
async function openCalendarDialog(cal) {
  const dlg = $('#cal-dlg');
  $('#cal-dlg-title').textContent = cal ? 'Edit calendar' : 'New calendar';
  $('#c-name').value = cal ? cal.name : '';
  calColor = cal ? cal.color : COLORS[(app.store.calendars.length + 3) % COLORS.length].value;
  const drawSwatches = () => {
    $('#c-colors').innerHTML = COLORS.map((c) => `<button type="button" style="--c:${c.value}" class="${c.value === calColor ? 'on' : ''}" data-color="${c.value}" title="${c.name}" aria-label="${c.name}"></button>`).join('');
  };
  drawSwatches();
  $('#c-colors').onclick = (e) => { const b = e.target.closest('[data-color]'); if (b) { calColor = b.dataset.color; drawSwatches(); } };
  $('#c-delete').hidden = !cal || app.store.calendars.length <= 1;
  $('#c-delete').onclick = async () => {
    dlg.close('cancel');
    const n = app.store.events.filter((e) => e.calendarId === cal.id).length;
    if (await confirmDialog(`Delete “${cal.name}” and its ${n} event${n === 1 ? '' : 's'}? This can’t be undone.`)) {
      await app.store.deleteCalendar(cal.id);
      toast('Calendar deleted');
    }
  };
  const r = await showDialog(dlg);
  if (r !== 'ok') return;
  const name = $('#c-name').value.trim();
  if (!name) return;
  await app.store.saveCalendar(cal ? { ...cal, name, color: calColor } : { name, color: calColor, order: app.store.calendars.length });
}

function wireCalList() {
  $('#cal-list').addEventListener('change', (e) => {
    const id = e.target.dataset.toggle;
    const cal = id && app.store.calendarById(id);
    if (cal) app.store.saveCalendar({ ...cal, hidden: !e.target.checked });
  });
  $('#cal-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit-cal]');
    if (b) { toggleCalendars(false); openCalendarDialog(app.store.calendarById(b.dataset.editCal)); }
  });
  $('#add-cal-btn').onclick = () => { toggleCalendars(false); openCalendarDialog(null); };
  closeOnBackdrop($('#cal-dlg'));
}

// ───────────────────────────── Sync status ─────────────────────────────

function renderSync() {
  const st = app.store.status;
  const label = { synced: 'Synced', saving: 'Saving…', offline: 'Offline – will sync later', local: 'Local only' }[st] || '';
  const el = $('#sync');
  el.className = `sync ${st}`;
  el.innerHTML = `<span>${label}</span>`;
  el.title = st === 'local' ? 'Saved on this device only (Firebase not set up yet)' : label;
}

// ───────────────────────────── Top bar ─────────────────────────────

function toggleCalendars(open) {
  const pop = $('#cals-pop');
  const show = open ?? pop.hidden;
  pop.hidden = !show;
  $('#cals-btn').setAttribute('aria-expanded', show);
  $('#cals-btn').classList.toggle('on', show);
}

function wireShell() {
  $('#today-btn').onclick = () => { app.cursor = new Date(); app.render(); };
  $('#prev-btn').onclick = () => { step(-1); app.render(); };
  $('#next-btn').onclick = () => { step(1); app.render(); };
  $('#view-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) app.setView(b.dataset.view);
  });
  $('#settings-btn').onclick = () => { toggleCalendars(false); openSettings(); };
  $('#create-btn').onclick = (e) => {
    e.stopPropagation();
    toggleCalendars(false);
    if (!$('#qa').hidden) { closeQuickAdd(); return; }
    // On the Today screen, events without a typed date go on the day you're looking at.
    openQuickAdd(app.view === 'today' ? app.cursor : null);
  };
  $('#cals-btn').onclick = (e) => { e.stopPropagation(); toggleCalendars(); };
  document.addEventListener('click', (e) => {
    if (!$('#cals-pop').hidden && !e.target.closest('.pop-wrap') && !e.target.closest('dialog')) toggleCalendars(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleCalendars(false); });
  wireViewClicks($('#view'));
  wireCalList();

  let lastW = innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(innerWidth - lastW) > 0 || app.view === 'month') { lastW = innerWidth; app.render(); }
  });

  // Re-render when coming back to the app (e.g. the next day).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) app.render(); });

  // Keyboard shortcuts (like Google Calendar).
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    const map = { a: 'today', m: 'month' };
    if (map[k]) { app.setView(map[k]); e.preventDefault(); }
    else if (k === 't') $('#today-btn').click();
    else if (k === 'j' || k === 'n' || e.key === 'ArrowRight') $('#next-btn').click();
    else if (k === 'k' || k === 'p' || e.key === 'ArrowLeft') $('#prev-btn').click();
    else if (k === 'c') { e.preventDefault(); $('#create-btn').click(); }
  });

  // Swipe left/right to move between days/weeks/months on touch screens.
  let sx = 0, sy = 0, st = 0;
  const view = $('#view');
  view.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (app.view !== 'month') return; // day/week scroll sideways, so swipe is only for month
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) {
      step(dx < 0 ? 1 : -1);
      app.render();
    }
  }, { passive: true });
}

// ───────────────────────────── Sign-in ─────────────────────────────

function showScreen(which) {
  $('#splash').hidden = which !== 'splash';
  $('#auth-screen').hidden = which !== 'auth';
  $('#app').hidden = which !== 'app';
  $('#local-note').hidden = app.store?.mode !== 'local';
}

function authMsg(text, ok = false) {
  const m = $('#auth-msg');
  m.textContent = text || '';
  m.classList.toggle('ok', ok);
}

function friendlyAuthError(e) {
  const code = e?.code || '';
  const map = {
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/cancelled-popup-request': '',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
    'auth/unauthorized-domain': 'This web address isn’t allowed to sign in yet. Add it in Firebase → Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method isn’t turned on in Firebase → Authentication → Sign-in method.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email.',
    'auth/email-already-in-use': 'There’s already an account with that email. Try signing in instead.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/network-request-failed': 'No internet connection.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  };
  return code in map ? map[code] : (e?.message || 'Something went wrong.');
}

function wireAuth() {
  $('#google-btn').onclick = async () => {
    authMsg('');
    try { await app.store.signInWithGoogle(); } catch (e) { authMsg(friendlyAuthError(e)); }
  };
  let mode = 'in';
  $$('#email-form button[type=submit]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; }));
  $('#email-form').onsubmit = async (e) => {
    e.preventDefault();
    authMsg('');
    const email = $('#auth-email').value.trim(), pw = $('#auth-pw').value;
    try {
      if (mode === 'up') {
        await app.store.signUpWithEmail(email, pw);
        authMsg('Account created. We sent you a verification email. Click the link in it, then sign in here.', true);
        await app.store.signOut();
      } else {
        await app.store.signInWithEmail(email, pw);
      }
    } catch (err) { authMsg(friendlyAuthError(err)); }
  };
  $('#reset-pw').onclick = async () => {
    const email = $('#auth-email').value.trim();
    if (!email) { authMsg('Type your email above first.'); return; }
    try { await app.store.resetPassword(email); authMsg('Password reset email sent.', true); } catch (e) { authMsg(friendlyAuthError(e)); }
  };
}

let deniedShown = false;
async function onDenied() {
  if (deniedShown) return;
  deniedShown = true;
  const u = app.store.user || {};
  const msg = u.emailVerified === false
    ? 'Please verify your email first: click the link we emailed you, then sign in again.'
    : `The account ${u.email || ''} isn’t allowed to use this calendar. If it’s yours, check that its email is in your Firestore rules (SETUP.md, step 3).`;
  await app.store.signOut();
  showScreen('auth');
  authMsg(msg);
}

// ───────────────────────────── Start-up ─────────────────────────────

async function start() {
  app.view = LS.get('cal-view', 'today');
  // Phones open on the new Today screen once (after that, whatever you last used).
  if (isNarrow() && !LS.get('cal-today-intro', false)) { app.view = 'today'; LS.set('cal-today-intro', true); }
  if (!['today', 'month'].includes(app.view)) app.view = 'today'; // Day/Week were removed
  initEditor();
  initSettings();
  initQuickAdd();
  wireShell();
  wireAuth();

  const store = createStore();
  app.store = store;
  store.on((type) => {
    if (type === 'auth') {
      if (store.user) {
        deniedShown = false;
        showScreen('app');
        app.render();
      } else {
        showScreen('auth');
      }
    } else if (type === 'data') {
      app.render();
    } else if (type === 'status') {
      renderSync();
    } else if (type === 'denied') {
      onDenied();
    }
  });

  try {
    await store.init();
  } catch (e) {
    console.error(e);
    $('#splash').innerHTML = `<div style="text-align:center;padding:24px"><p>Couldn’t start the calendar.</p><p class="muted">${esc(navigator.onLine ? e.message : 'You’re offline and the app hasn’t been cached yet. Connect once and try again.')}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }

  registerServiceWorker();
}

// ── Offline support + updates ──

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // While testing on this computer, skip the offline cache so edits show up
  // immediately (add ?sw=1 to the address to test offline mode locally).
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !location.search.includes('sw=1')) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    return;
  }
  // Updates install by themselves: the new version downloads in the background,
  // takes over, and the page reloads once you're not in the middle of something.
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting) reg.waiting.postMessage('skipWaiting'); // an older version left one waiting
    const check = () => reg.update().catch(() => {});
    // Check whenever the app is opened or brought back to the front (iPhone keeps
    // Home Screen apps in memory, so "opening" is often just coming back to it).
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch((e) => console.warn('Service worker failed', e));

  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    // Don't yank the page away while an event or settings window is open.
    const reloadWhenIdle = () => {
      const typing = !$('#qa').hidden || document.activeElement?.id === 'td-qa-input';
      if (document.querySelector('dialog[open]') || typing) { setTimeout(reloadWhenIdle, 1500); return; }
      location.reload();
    };
    reloadWhenIdle();
  });
}

start();
