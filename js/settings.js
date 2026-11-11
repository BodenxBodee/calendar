// Settings dialog: account, notifications, preferences, import, backup, install help.

import { vapidPublicKey } from './config.js';
import { COLORS, newId } from './store.js';
import { parseICS } from './ics.js';
import { app, $, esc, toast, closeOnBackdrop } from './ctx.js';

export const APP_VERSION = '1.0.0';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ── Notifications ──

export function pushSupport() {
  if (app.store.mode !== 'firebase') return { ok: false, why: 'Notifications work once syncing is set up (SETUP.md).' };
  if (!vapidPublicKey) return { ok: false, why: 'The reminder sender isn’t set up yet (SETUP.md, step 6).' };
  if (isIOS() && !isStandalone()) return { ok: false, why: 'On iPhone/iPad, first add this app to your Home Screen (Share → Add to Home Screen), then open it from there.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, why: 'This browser doesn’t support notifications.' };
  return { ok: true };
}

export async function enablePush({ silent = false } = {}) {
  const sup = pushSupport();
  if (!sup.ok) { if (!silent) toast(sup.why, null, 8000); return false; }
  if (silent && Notification.permission !== 'granted') return false;
  const perm = silent ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') { if (!silent) toast('Notifications are blocked. Allow them in your browser/system settings.', null, 8000); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) });
    await app.store.savePushSubscription(sub);
    if (!silent) toast('Notifications are on for this device');
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) toast(`Couldn’t turn on notifications: ${e.message}`, null, 8000);
    return false;
  }
}

async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Test notification', { body: 'Notifications are working on this device.', icon: 'icons/icon-192.png', badge: 'icons/badge-72.png' });
}

// ── Import (.ics) ──

async function importFiles(files, dest) {
  const store = app.store;
  const existing = new Set(store.events.map((e) => e.icsUid).filter(Boolean));
  let added = 0, skipped = 0, calendars = 0;
  for (const file of files) {
    const { name, events } = parseICS(await file.text());
    let calId = dest;
    if (dest === 'new') {
      const calName = name || file.name.replace(/\.ics$/i, '').replace(/_/g, ' ').replace(/@.*$/, '') || 'Imported';
      const same = store.calendars.find((c) => c.name.toLowerCase() === calName.toLowerCase());
      if (same) calId = same.id; // re-importing: reuse the calendar made last time
      else {
        const cal = await store.saveCalendar({
          name: calName,
          color: COLORS[(store.calendars.length + 3) % COLORS.length].value,
          order: store.calendars.length,
        });
        calId = cal.id; calendars++;
      }
    }
    const batch = [];
    for (const ev of events) {
      if (ev.icsUid && existing.has(ev.icsUid)) { skipped++; continue; }
      if (ev.icsUid) existing.add(ev.icsUid);
      batch.push({ ...ev, id: newId(), calendarId: calId, createdAt: Date.now() });
    }
    await store.saveEvents(batch);
    added += batch.length;
  }
  toast(`Imported ${added} event${added === 1 ? '' : 's'}${calendars ? ` into ${calendars} new calendar${calendars === 1 ? '' : 's'}` : ''}${skipped ? ` (${skipped} already here, skipped)` : ''}`, null, 8000);
}

// ── Backup ──

function downloadBackup() {
  const { calendars, events, settings } = app.store;
  const blob = new Blob([JSON.stringify({ app: 'calendar', version: 1, exportedAt: new Date().toISOString(), calendars, events, settings }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calendar-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t a calendar backup.'); return; }
  if (!data || data.app !== 'calendar' || !Array.isArray(data.events)) { toast('That file isn’t a calendar backup.'); return; }
  for (const c of data.calendars || []) await app.store.saveCalendar(c);
  await app.store.saveEvents(data.events);
  toast(`Restored ${data.events.length} events and ${(data.calendars || []).length} calendars`, null, 8000);
}

// ── Dialog ──

export function openSettings() {
  const { store } = app;
  const s = store.settings;
  const u = store.user || {};
  const sup = pushSupport();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const cals = [...store.calendars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const remOpt = (v, cur, label) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;

  $('#settings-body').innerHTML = `
    <section>
      <h3>Account</h3>
      ${store.mode === 'local'
        ? `<p><strong>Local mode:</strong> your events are stored only in this browser on this device. Follow <em>SETUP.md</em> to connect Firebase and sync across devices.</p>`
        : `<div class="account">${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : ''}
            <div><div>${esc(u.displayName || '')}</div><div class="muted">${esc(u.email || '')}</div></div>
            <div class="spacer"></div><button class="btn" id="s-signout">Sign out</button></div>`}
    </section>

    <section>
      <h3>Notifications on this device</h3>
      ${sup.ok
        ? `<p>${perm === 'granted' ? 'Allowed. Reminders will pop up on this device.' : 'Turn on to get reminders on this device, even when the app is closed.'} Reminders can arrive up to ~5 minutes late.</p>
           <div class="row"><button class="btn btn-primary" id="s-push">${perm === 'granted' ? 'Re-register this device' : 'Turn on notifications'}</button>
           ${perm === 'granted' ? '<button class="btn" id="s-test">Show a test notification</button>' : ''}</div>`
        : `<p>${esc(sup.why)}</p>`}
    </section>

    <section>
      <h3>Preferences</h3>
      <label class="setting">Week starts on
        <select id="s-week">${remOpt(0, s.weekStart, 'Sunday')}${remOpt(1, s.weekStart, 'Monday')}${remOpt(6, s.weekStart, 'Saturday')}</select></label>
      <label class="setting">Default notification (timed events)
        <select id="s-rem">${remOpt(-1, s.defaultReminder ?? -1, 'None')}${[0, 5, 10, 15, 30, 60, 1440].map((m) => remOpt(m, s.defaultReminder, m === 0 ? 'At time of event' : m === 1440 ? '1 day before' : m >= 60 ? `${m / 60} hour before` : `${m} minutes before`)).join('')}</select></label>
      <label class="setting">Default notification (all-day events)
        <select id="s-remad">${remOpt(-1, s.defaultAllDayReminder ?? -1, 'None')}${remOpt(0, s.defaultAllDayReminder, 'On the day at 9am')}${remOpt(1440, s.defaultAllDayReminder, 'The day before at 9am')}</select></label>
    </section>

    <section>
      <h3>Import from Google Calendar</h3>
      <p>In Google Calendar on a computer: Settings → Import &amp; export → <strong>Export</strong>. Unzip the download; you’ll get one <code>.ics</code> file per calendar. Choose them here. Importing the same file twice won’t create duplicates.</p>
      <label class="setting">Put events in
        <select id="s-imp-dest"><option value="new">A new calendar per file</option>${cals.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
      <div class="row"><input type="file" id="s-imp-file" accept=".ics,text/calendar" multiple hidden>
        <button class="btn btn-primary" id="s-imp">Choose .ics files…</button></div>
    </section>

    <section>
      <h3>Backup</h3>
      <p>Download a copy of all your calendars and events. Good to do now and then.</p>
      <div class="row"><button class="btn" id="s-backup">Download backup</button>
        <input type="file" id="s-restore-file" accept=".json,application/json" hidden>
        <button class="btn" id="s-restore">Restore from backup…</button></div>
    </section>

    <section>
      <h3>Install on your devices</h3>
      <p><strong>iPhone / iPad:</strong> open this page in Safari → Share button → <em>Add to Home Screen</em>.<br>
      <strong>Mac:</strong> Safari → File → <em>Add to Dock</em> (or Chrome → install icon in the address bar).<br>
      <strong>Windows:</strong> Edge or Chrome → install icon in the address bar → <em>Install</em>.</p>
    </section>

    <section><p>Version ${APP_VERSION} · ${store.mode === 'local' ? 'Local mode' : 'Synced with Firebase'}</p></section>`;

  const b = $('#settings-body');
  b.querySelector('#s-signout')?.addEventListener('click', async () => { $('#settings-dlg').close(); await store.signOut(); });
  b.querySelector('#s-push')?.addEventListener('click', async () => { await enablePush(); openSettings(); });
  b.querySelector('#s-test')?.addEventListener('click', testNotification);
  b.querySelector('#s-week').onchange = (e) => store.saveSettings({ weekStart: Number(e.target.value) });
  b.querySelector('#s-rem').onchange = (e) => store.saveSettings({ defaultReminder: Number(e.target.value) });
  b.querySelector('#s-remad').onchange = (e) => store.saveSettings({ defaultAllDayReminder: Number(e.target.value) });
  b.querySelector('#s-imp').onclick = () => b.querySelector('#s-imp-file').click();
  b.querySelector('#s-imp-file').onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const btn = b.querySelector('#s-imp');
    btn.disabled = true; btn.textContent = 'Importing…';
    try { await importFiles(files, b.querySelector('#s-imp-dest').value); }
    catch (err) { console.error(err); toast(`Import failed: ${err.message}`, null, 8000); }
    btn.disabled = false; btn.textContent = 'Choose .ics files…';
    e.target.value = '';
  };
  b.querySelector('#s-backup').onclick = downloadBackup;
  b.querySelector('#s-restore').onclick = () => b.querySelector('#s-restore-file').click();
  b.querySelector('#s-restore-file').onchange = async (e) => { if (e.target.files[0]) await restoreBackup(e.target.files[0]); e.target.value = ''; };

  const dlg = $('#settings-dlg');
  if (!dlg.open) dlg.showModal();
}

export function initSettings() {
  const dlg = $('#settings-dlg');
  closeOnBackdrop(dlg);
  dlg.querySelector('[data-act=close]').onclick = () => dlg.close();
}
