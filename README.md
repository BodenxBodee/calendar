# Calendar

A personal calendar app, similar to Google Calendar. It syncs across iPhone/iPad, Mac and Windows, and runs entirely on free services.

- **Setup:** see [SETUP.md](SETUP.md)
- **Try it locally:** `python3 devserver.py`, then open http://localhost:8080

## How it's built

- Plain HTML/CSS/JavaScript with no build step. It's an installable web app (PWA) hosted on GitHub Pages.
- **Firebase Firestore** stores events, syncs them in real time, and keeps working offline. **Firebase Auth** handles sign-in with Google.
- **Reminders:** `.github/workflows/reminders.yml` runs `reminders/send.js` about every 5 minutes on GitHub Actions and sends Web Push notifications.

| File | Purpose |
|---|---|
| `js/config.js` | Your Firebase settings and push public key |
| `js/app.js` | Start-up, sign-in, sidebar, shortcuts |
| `js/views.js` | Day, Week, Month and Schedule views |
| `js/editor.js` | Event details and the edit form (including repeat rules) |
| `js/settings.js` | Settings, notifications, import, backup |
| `js/store.js` | Data layer (local mode or Firebase) |
| `js/recurrence.js` | Repeat-rule expansion (also used by the reminder sender) |
| `js/ics.js` | Google Calendar `.ics` import |
| `sw.js` | Offline cache and push notification display |
| `reminders/` | The reminder sender that runs on GitHub |
| `firestore.rules` | Database security rules (paste into the Firebase console) |
| `keys.html` | Generates the push-notification key pair |

## Keyboard shortcuts

`c` create · `t` today · `d` / `w` / `m` / `a` day/week/month/schedule · `j`/`k` or ←/→ next/previous
