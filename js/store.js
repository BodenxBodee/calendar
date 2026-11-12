// Data layer. Two interchangeable back ends with the same interface:
//   LocalStore    – saves in this browser only (used until Firebase is set up)
//   FirebaseStore – Firestore with offline cache + real-time sync across devices
//
// Firestore layout (all private to the signed-in user):
//   users/{uid}                     { email, tz, settings, eventsChangedAt }
//   users/{uid}/calendars/{id}      { name, color, hidden, order }
//   users/{uid}/events/{id}         event (see recurrence.js)

import { firebaseConfig } from './config.js';

const FIREBASE_VERSION = '10.14.1';
const FB = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;

// Event colours chosen to sit well on the mocha/bordeaux theme (white text stays readable).
export const COLORS = [
  { name: 'Bordeaux', value: '#8c1d2f' }, { name: 'Rose', value: '#b4566a' },
  { name: 'Clay', value: '#b5623f' }, { name: 'Ochre', value: '#b0832f' },
  { name: 'Olive', value: '#767a3e' }, { name: 'Sage', value: '#6b8765' },
  { name: 'Pine', value: '#3f6b5e' }, { name: 'Brick', value: '#9b3b2f' },
  { name: 'Wine', value: '#6d2233' }, { name: 'Plum', value: '#74466b' },
  { name: 'Mocha', value: '#7a5c4a' }, { name: 'Taupe', value: '#8c7765' },
];

export const DEFAULT_SETTINGS = { weekStart: 0 };

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };

export const isFirebaseConfigured = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId);

class BaseStore {
  constructor() {
    this.user = null;
    this.calendars = [];
    this.events = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.status = 'synced';
    this.ready = false; // first data has arrived
    this._listeners = new Set();
  }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(type) { for (const fn of this._listeners) fn(type); }
  calendarById(id) { return this.calendars.find((c) => c.id === id); }
  eventById(id) { return this.events.find((e) => e.id === id); }
  defaultCalendarId() {
    const c = [...this.calendars].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    return c ? c.id : null;
  }
}

// ───────────────────────────── Local (this browser only) ─────────────────────

const LS_KEY = 'calendar-local-v1';

class LocalStore extends BaseStore {
  constructor() { super(); this.mode = 'local'; this.status = 'local'; }

  async init() {
    this._load();
    window.addEventListener('storage', (e) => { if (e.key === LS_KEY) { this._load(); this.emit('data'); } });
    this.user = { local: true, uid: 'local', email: null, displayName: 'This device' };
    this.ready = true;
    this.emit('auth');
    this.emit('data');
  }

  _load() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { /* ignore */ }
    this.calendars = d.calendars || [{ id: 'personal', name: 'Personal', color: '#8c1d2f', order: 0 }];
    this.events = d.events || [];
    this.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  }

  _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ calendars: this.calendars, events: this.events, settings: this.settings }));
    } catch (e) { console.error(e); alert('Could not save: browser storage is full or unavailable.'); }
    this.emit('data');
  }

  _upsert(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  }

  async saveEvent(ev) { ev.id ||= newId(); ev.updatedAt = Date.now(); this._upsert(this.events, ev); this._save(); return ev; }
  async saveEvents(evs) { for (const ev of evs) { ev.id ||= newId(); ev.updatedAt = Date.now(); this._upsert(this.events, ev); } this._save(); }
  async deleteEvent(id) { this.events = this.events.filter((e) => e.id !== id); this._save(); }
  async saveCalendar(cal) { cal.id ||= newId(); this._upsert(this.calendars, cal); this._save(); return cal; }
  async deleteCalendar(id) {
    this.calendars = this.calendars.filter((c) => c.id !== id);
    this.events = this.events.filter((e) => e.calendarId !== id);
    this._save();
  }
  async saveSettings(patch) { Object.assign(this.settings, patch); this._save(); }
  async signOut() {}
}

// ───────────────────────────── Firebase (synced) ─────────────────────────────

class FirebaseStore extends BaseStore {
  constructor() { super(); this.mode = 'firebase'; this._unsubs = []; }

  async init() {
    const [appM, authM, fs] = await Promise.all([
      import(`${FB}firebase-app.js`),
      import(`${FB}firebase-auth.js`),
      import(`${FB}firebase-firestore.js`),
    ]);
    this.A = authM; this.F = fs;
    const app = appM.initializeApp(firebaseConfig);
    this.auth = authM.getAuth(app);
    try {
      this.db = fs.initializeFirestore(app, {
        ignoreUndefinedProperties: true,
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch (e) {
      console.warn('Offline cache unavailable, using memory cache', e);
      this.db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    }
    window.addEventListener('online', () => this._updateStatus());
    window.addEventListener('offline', () => this._updateStatus());

    await new Promise((resolve) => {
      authM.onAuthStateChanged(this.auth, (u) => {
        this._teardown();
        if (u) {
          this.user = { uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL, emailVerified: u.emailVerified, providers: u.providerData.map((p) => p.providerId) };
          this._subscribe();
        } else {
          this.user = null; this.calendars = []; this.events = []; this.ready = false;
        }
        this.emit('auth');
        resolve();
      });
    });
  }

  _teardown() { this._unsubs.forEach((u) => u()); this._unsubs = []; }

  _userRef() { return this.F.doc(this.db, 'users', this.user.uid); }
  _col(name) { return this.F.collection(this._userRef(), name); }

  _subscribe() {
    const { onSnapshot, setDoc, serverTimestamp } = this.F;
    const uref = this._userRef();
    let gotCals = false, gotEvents = false;
    const markReady = () => { if (gotCals && gotEvents && !this.ready) { this.ready = true; this.emit('data'); } };

    // Note the last time this account was used (handy for spotting stray sign-ins).
    setDoc(uref, { email: this.user.email || null, tz: tz(), lastSeen: serverTimestamp() }, { merge: true }).catch(this._err);

    this._unsubs.push(onSnapshot(uref, (snap) => {
      const d = snap.data() || {};
      this.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      this.emit('data');
    }, this._err));

    this._unsubs.push(onSnapshot(this._col('calendars'), (snap) => {
      this.calendars = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (snap.empty && !snap.metadata.fromCache && !this._creatingDefault) {
        this._creatingDefault = true;
        this.saveCalendar({ id: 'personal', name: 'Personal', color: '#8c1d2f', order: 0 });
      }
      gotCals = true; markReady(); this.emit('data');
    }, this._err));

    this._unsubs.push(onSnapshot(this._col('events'), { includeMetadataChanges: true }, (snap) => {
      this._pending = snap.metadata.hasPendingWrites;
      this._fromCache = snap.metadata.fromCache;
      if (snap.docChanges().length || !gotEvents) {
        this.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        gotEvents = true; markReady(); this.emit('data');
      }
      this._updateStatus();
    }, this._err));
  }

  _updateStatus() {
    const s = !navigator.onLine ? 'offline' : this._pending ? 'saving' : 'synced';
    if (s !== this.status) { this.status = s; this.emit('status'); }
  }

  _err = (e) => {
    console.error(e);
    if (e && e.code === 'permission-denied') {
      this.emit('denied');
    }
  };

  // Writes are applied to the local cache instantly (and show up on screen);
  // they reach the server whenever the device is online. We don't await the
  // server so the app stays fast offline.
  _commit(batch) { batch.commit().catch(this._err); this._pending = true; this._updateStatus(); }

  _touch(batch) { batch.set(this._userRef(), { eventsChangedAt: this.F.serverTimestamp() }, { merge: true }); }

  async saveEvent(ev) {
    ev.id ||= newId();
    ev.updatedAt = Date.now();
    const { id, ...data } = ev;
    const b = this.F.writeBatch(this.db);
    b.set(this.F.doc(this._col('events'), id), data);
    this._touch(b);
    this._commit(b);
    return ev;
  }

  async saveEvents(evs) {
    for (let i = 0; i < evs.length; i += 400) {
      const b = this.F.writeBatch(this.db);
      for (const ev of evs.slice(i, i + 400)) {
        ev.id ||= newId(); ev.updatedAt = Date.now();
        const { id, ...data } = ev;
        b.set(this.F.doc(this._col('events'), id), data);
      }
      this._touch(b);
      this._commit(b);
    }
  }

  async deleteEvent(id) {
    const b = this.F.writeBatch(this.db);
    b.delete(this.F.doc(this._col('events'), id));
    this._touch(b);
    this._commit(b);
  }

  async saveCalendar(cal) {
    cal.id ||= newId();
    const { id, ...data } = cal;
    this.F.setDoc(this.F.doc(this._col('calendars'), id), data).catch(this._err);
    return cal;
  }

  async deleteCalendar(id) {
    const evIds = this.events.filter((e) => e.calendarId === id).map((e) => e.id);
    for (let i = 0; i < evIds.length; i += 400) {
      const b = this.F.writeBatch(this.db);
      evIds.slice(i, i + 400).forEach((eid) => b.delete(this.F.doc(this._col('events'), eid)));
      this._touch(b);
      this._commit(b);
    }
    this.F.deleteDoc(this.F.doc(this._col('calendars'), id)).catch(this._err);
  }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    this.F.setDoc(this._userRef(), { settings: this.settings }, { merge: true }).catch(this._err);
    this.emit('data');
  }

  // ── Sign-in ──
  signInWithGoogle() {
    const p = new this.A.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    return this.A.signInWithPopup(this.auth, p);
  }
  signInWithEmail(email, pw) { return this.A.signInWithEmailAndPassword(this.auth, email, pw); }
  async signUpWithEmail(email, pw) {
    const cred = await this.A.createUserWithEmailAndPassword(this.auth, email, pw);
    await this.A.sendEmailVerification(cred.user);
    return cred;
  }
  resetPassword(email) { return this.A.sendPasswordResetEmail(this.auth, email); }
  async reloadUser() { await this.auth.currentUser?.reload(); await this.auth.currentUser?.getIdToken(true); }
  signOut() { return this.A.signOut(this.auth); }
}

export function createStore() {
  return isFirebaseConfigured() ? new FirebaseStore() : new LocalStore();
}
