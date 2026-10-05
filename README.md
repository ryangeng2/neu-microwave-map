# NEU Microwave Map

A 3D map of Northeastern's Boston campus where students mark where the microwaves are, floor by floor.

- **Anyone** can open the map and browse, no account needed.
- **Northeastern students** (verified `@northeastern.edu` email) can add microwaves, mark them "Still here" or "It's gone", and edit or delete their own.
- Pins float at the floor they're on inside see-through 3D buildings. Tap a building to see its floor stack.

Student-made, not affiliated with Northeastern University. Map © OpenStreetMap contributors, tiles by OpenFreeMap.

## How it's built

Plain HTML/CSS/JS, no build step.

| File | What it does |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Layout and theme (light + dark) |
| `app.js` | Map (MapLibre GL, OpenFreeMap tiles), list, floor stack, add/edit form, sign-in UI |
| `store.js` | Firebase Auth + Firestore, or a browser-only preview store when no config is set |
| `config.js` | Your Firebase web config goes here |
| `firestore.rules` | Database security rules (paste into the Firebase console) |

## Connect Firebase (one time, ~10 minutes)

Until this is done the site runs in **preview mode**: pins save only in your own browser.

1. Go to <https://console.firebase.google.com>, **Add project**, name it e.g. `neu-microwave-map`. Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (leave "Email link" off) → Save.
3. **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.
4. **Build → Firestore Database → Create database** → pick a location (e.g. `nam5`) → start in **production mode**.
5. **Firestore → Rules** → replace everything with the contents of `firestore.rules` → **Publish**.
6. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app (no Hosting needed) → copy the `firebaseConfig` object.
7. In `config.js`, replace `null` with that object:
   ```js
   export const firebaseConfig = {
     apiKey: "…",
     authDomain: "…firebaseapp.com",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…",
   };
   ```
   These values are meant to be public; the rules are what protect the data.
8. Commit and push. GitHub Pages redeploys in about a minute.

### Make yourself a moderator

Moderators can edit or delete any pin.

1. Sign up on the live site and verify your email.
2. Firebase console → **Authentication → Users** → copy your **User UID**.
3. **Firestore → Start collection** → ID `admins` → document ID = your UID → add any field (e.g. `note: "me"`) → Save.

### Optional: tidy the verification email

**Authentication → Templates → Email address verification** lets you change the sender name to "NEU Microwave Map". Outlook often files these emails under Junk, and the site tells students to check there.

## Run it locally

Any static server works, e.g.

```bash
py -m http.server 8080
```

then open <http://localhost:8080>.

## Limits on the free plan

- 1,000 verification emails a day, 50,000 reads and 20,000 writes a day. That's plenty for a campus.
- The "which building is this?" lookup uses the public Overpass API. When it's busy, students just type the building name (with autocomplete).
