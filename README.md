# Calendar

A personal calendar app, synced across iPhone/iPad, Mac and Windows, running entirely on free services.

- **Live:** https://bodenxbodee.github.io/calendar/
- **Try it locally:** `python3 devserver.py`, then open http://localhost:8080
- **Setting it up from scratch:** see [SETUP.md](SETUP.md)

## How it's built

- Plain HTML/CSS/JavaScript with no build step. It's an installable web app (PWA) hosted on GitHub Pages.
- **Firebase Firestore** stores events, syncs them in real time and keeps working offline. **Firebase Auth** handles sign-in with Google.
- Updates install themselves: bump `VERSION` in `sw.js` when changing app files, and each device switches to the new version the next time the app is opened.

| File | Purpose |
|---|---|
| `js/config.js` | Firebase settings |
| `js/app.js` | Start-up, sign-in, top bar, shortcuts, auto-updates |
| `js/views.js` | Day and Week (time runs left → right) and Month |
| `js/editor.js` | Event details and the edit form (repeat rules, completing events) |
| `js/settings.js` | Settings, import, backup |
| `js/store.js` | Data layer (local mode or Firebase) |
| `js/recurrence.js` | Repeat-rule expansion |
| `js/ics.js` | Google Calendar `.ics` import |
| `sw.js` | Offline cache and automatic updates |
| `firestore.rules` | Database security rules (pasted into the Firebase console) |

## Keyboard shortcuts

`c` create · `t` today · `d` / `w` / `m` day/week/month · `j`/`k` or ←/→ next/previous
