// Reminder sender. GitHub Actions runs this every ~5 minutes (free).
// It reads your events from Firestore and sends push notifications that are due.
//
// To keep within Firestore's free daily limits it doesn't re-read every event
// on every run: it keeps a 48-hour "queue" of upcoming reminders and only
// rebuilds it when the app reports a change (or every 12 hours).
//
// Needs these GitHub secrets (SETUP.md, step 6):
//   FIREBASE_SERVICE_ACCOUNT  – JSON key for your Firebase project
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY – push-notification key pair
//   VAPID_SUBJECT (optional)  – "mailto:you@example.com"

import admin from 'firebase-admin';
import webpush from 'web-push';
import { buildQueue, dueItems } from './queue.js';

const REBUILD_EVERY_MS = 12 * 3600 * 1000;

const { FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
if (!FIREBASE_SERVICE_ACCOUNT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.log('Reminder sender is not set up yet (missing GitHub secrets). Nothing to do.');
  process.exit(0);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch {
  console.error('The Firebase key secret is not the contents of the .json key file. ' +
    'Open the downloaded file in TextEdit, copy ALL of the text (it starts with { and contains "service_account"), ' +
    'and paste that into the GitHub secret.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:calendar-reminders@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function processUser(userDoc) {
  const now = Date.now();
  const data = userDoc.data() || {};
  const tz = data.tz || 'UTC';
  process.env.TZ = tz; // local-time math (repeat rules, 9am all-day) in the user's zone

  const qRef = userDoc.ref.collection('private').doc('reminderQueue');
  const q = (await qRef.get()).data() || { items: [], sent: {}, builtAt: 0 };
  q.sent ||= {};
  let dirty = false;

  const changedAt = data.eventsChangedAt?.toMillis?.() || 0;
  if (changedAt >= q.builtAt || now - q.builtAt > REBUILD_EVERY_MS) {
    const snap = await userDoc.ref.collection('events').get();
    const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    q.items = buildQueue(events, now, tz);
    q.builtAt = now;
    dirty = true;
    console.log(`User ${userDoc.id}: rebuilt queue from ${events.length} events → ${q.items.length} upcoming reminders`);
  }

  const due = dueItems(q.items, q.sent, now);
  if (due.length) {
    const subs = await userDoc.ref.collection('pushSubs').get();
    if (subs.empty) console.log(`User ${userDoc.id}: ${due.length} due but no devices have notifications turned on`);
    for (const item of due) {
      let delivered = 0;
      for (const s of subs.docs) {
        try {
          await webpush.sendNotification(s.data().sub, JSON.stringify({
            title: item.title, body: item.body, tag: item.key, at: item.at, url: './',
          }), { TTL: 3600, urgency: 'high' });
          delivered++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await s.ref.delete(); // device unsubscribed / app removed
            console.log(`Removed expired device subscription ${s.id}`);
          } else {
            console.error(`Push failed (${e.statusCode || ''}): ${e.body || e.message}`);
          }
        }
      }
      q.sent[item.key] = item.at;
      dirty = true;
      console.log(`Sent "${item.title}" to ${delivered} device(s), ${Math.round((now - item.at) / 1000)}s after scheduled time`);
    }
  }

  // Forget sent-markers older than 3 days.
  for (const [k, at] of Object.entries(q.sent)) if (at < now - 3 * 86400000) { delete q.sent[k]; dirty = true; }
  // Drop queue items that are well in the past.
  const before = q.items.length;
  q.items = q.items.filter((i) => i.at > now - 2 * 3600 * 1000);
  if (q.items.length !== before) dirty = true;

  if (dirty) await qRef.set(q);
}

const users = await db.collection('users').get();
let failed = 0;
for (const u of users.docs) {
  try { await processUser(u); } catch (e) { failed++; console.error(`User ${u.id} failed:`, e); }
}
console.log(`Done. ${users.size} user(s) checked.`);
process.exit(failed ? 1 : 0);
