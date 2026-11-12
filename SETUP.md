# Setting up your calendar

This turns the calendar from "works on this computer only" into "synced on all your devices". Everything here is **free**, and you'll never be asked for a credit card. If a page ever asks you to upgrade or add billing, stop: you've taken a wrong turn.

Total time: about 20–30 minutes, once.

| Step | What | Where |
|---|---|---|
| 1 | Try the app on your Mac | Terminal |
| 2 | Create a Firebase project | console.firebase.google.com |
| 3 | Turn on the database | Firebase |
| 4 | Turn on "Sign in with Google" | Firebase |
| 5 | Connect the app to Firebase | `js/config.js` |
| 6 | Put the app online | github.com |
| 7 | Install on each device | iPhone/iPad, Mac, Windows |

---

## 1. Try it on your Mac

Open **Terminal**, then run:

```bash
cd ~/Desktop/"Claude Projects/Calendar App" && python3 devserver.py
```

Open <http://localhost:8080> in your browser. The app runs in **local mode**: events are saved in that browser only. Press `Ctrl+C` in Terminal to stop it.

---

## 2. Create a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
3. Name it, e.g. `my-calendar`. Click **Continue**.
4. Turn **off** "Google Analytics" (not needed). Click **Create project**, wait, then **Continue**.

You're now on the project's home page. You are on the free **Spark** plan; leave it that way.

---

## 3. Turn on the database (Firestore)

1. In the left menu: **Build → Firestore Database → Create database**.
2. **Location:** pick the one closest to you (e.g. `us-central` / `nam5` in the US, `eur3` in Europe). This can't be changed later. Click **Next**.
3. Choose **Start in production mode**. Click **Create**.
4. When it opens, click the **Rules** tab at the top.
5. Delete everything in the box and paste the contents of the `firestore.rules` file from this folder.
6. In what you pasted, replace `your_email@gmail.com` with **the Google account you'll sign in with** (all lowercase), keeping the quotes. This makes sure nobody else can use your calendar.
7. Click **Publish**.

---

## 4. Turn on "Sign in with Google"

1. Left menu: **Build → Authentication → Get started**.
2. In the **Sign-in method** tab, click **Google**.
3. Flip **Enable** on, choose your email as the "support email", click **Save**.
4. *(Optional, as a backup way in)* also enable **Email/Password**.

---

## 5. Connect the app to Firebase

1. Click the **gear icon** (top-left, next to "Project Overview") → **Project settings**.
2. Scroll to **Your apps** and click the **`</>`** (Web) icon.
3. App nickname: `calendar`. **Don't** tick "Firebase Hosting". Click **Register app**.
4. You'll see a code block containing `const firebaseConfig = { apiKey: "…", authDomain: "…", … }`.
5. Open `js/config.js` from this folder in TextEdit (or any editor) and copy each value into the matching line between the quotes. Save.

These values aren't secret: they're meant to be inside web apps. Your data is protected by the rules from step 3.

Reload <http://localhost:8080>. You should now see a **Sign in with Google** screen. Sign in. The dot in the top bar should say **Synced**.

---

## 6. Put the app online (GitHub Pages)

1. Create a free account at <https://github.com/signup> if you don't have one.
2. Create a new repository at <https://github.com/new>:
   - Name: `calendar`
   - Visibility: **Public** (required for free hosting; your *events* are not in it, they live in Firebase)
   - Don't add a README. Click **Create repository**.
3. Upload this folder to it. (Claude can do this for you with git, or use **uploading an existing file** on the empty repo page and drag in everything in this folder *except* `node_modules` if present.)
4. In the repository: **Settings → Pages**. Under "Build and deployment": Source **Deploy from a branch**, Branch **main**, folder **/ (root)**. Click **Save**.
5. After a minute or two, the page shows your address: `https://YOUR-USERNAME.github.io/calendar/`.
6. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → type `YOUR-USERNAME.github.io` → **Add**.

Open your new address and sign in. That's your calendar, on the internet, synced.

---

## 7. Install on each device

**iPhone / iPad**
1. Open your `https://YOUR-USERNAME.github.io/calendar/` address in **Safari** (all lowercase).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Calendar from the Home Screen** and sign in.

**Mac**: Safari → **File → Add to Dock**, or Chrome → the install icon at the right of the address bar.

**Windows**: Edge or Chrome → the install icon in the address bar → **Install**.

**Android**: Chrome → ⋮ menu → **Install app**.

---

## Bringing over your Google Calendar events

1. On a computer, open Google Calendar → **⚙ Settings → Import & export → Export**. A `.zip` downloads.
2. Double-click it to unzip. You get one `.ics` file per calendar.
3. In your calendar app: **gear → Import from Google Calendar → Choose .ics files…**

Importing the same file again won't create duplicates.

---

## Updating the app later

After changing any app file, open `sw.js`, bump `VERSION` (e.g. `v1.3.0` → `v1.3.1`), and upload the changed files to GitHub. Each device installs the new version by itself the next time the app is opened (on iPhone, sometimes only after fully closing and reopening it). Re-adding the app to the Home Screen is only needed to pick up a new app **icon**.

---

## Free limits (you won't hit these)

- **Firestore:** 50,000 reads, 20,000 writes and 1 GB of storage per day/month. A busy personal calendar uses well under 1%.
- **GitHub Pages:** 100 GB of traffic per month.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "This web address isn't allowed to sign in" | Step 6.6: add `YOUR-USERNAME.github.io` to Authorized domains. |
| Signed in, but "account isn't allowed" | The email in your Firestore rules (step 3) doesn't match the account, or has a typo / capital letters. |
| Changes don't show on a device | Fully close the app (swipe it away) and reopen it, once or twice. |
| A website update doesn't go live | GitHub → **Actions** → "pages build and deployment". If it shows "Startup failure", that's GitHub's side: click **Re-run all jobs**, or upload again later. |
