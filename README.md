# Gift Wallet (ארנק מתנות)

A Hebrew, mobile-first app for keeping track of the household's gift cards (BuyMe, Tav Hazahav and the like), store credits, vouchers and coupons: balance, expiry date, code and barcode, with a shared history of who used what. A photo of a credit-note receipt or a screenshot of an SMS or email fills in the details by itself (on-device text recognition). It installs on the phone's home screen, works offline at the register, and can sync between phones through a Google Sheet in your own account, end-to-end encrypted.

## Recovery — fresh machine setup

### Prerequisites

- [ ] Node 20+ (only for running locally and for tests; the app itself has no build step)
- [ ] A browser (Chrome, Edge or Safari)
- [ ] For sync between phones: a personal Google account (one-time setup, about 5 minutes)

### Environment setup

1. Clone: `git clone git@github.com:saginizar/gift-wallet.git`
2. No dependencies to install. All third-party code is vendored in `js/vendor/` and `fonts/`.
3. There is no `.env` to fill in: the app has no secrets. The sync key is created on the first phone and only ever stored on the household's devices.

### Secret locations

| What | Where it lives |
|---|---|
| Household sync key | Generated in the app on the first device; stored in each paired device's IndexedDB. Shown as the pairing link/code under Settings > Sync > חיבור מכשיר נוסף. Losing every device means the synced copy cannot be decrypted, so keep a JSON backup (Settings > ייצוא גיבוי). |
| Sync backend URL | The Apps Script web-app URL (`https://script.google.com/macros/s/…/exec`), part of the pairing code. |
| Backend auth | Only a SHA-256 hash of the device token, in the script's Script Properties (`AUTH_HASH`). |

### Run locally

```bash
npm start          # http://localhost:8080
npm run dev        # same, plus an emulated sync backend at http://localhost:8080/mock-gas/exec
npm test           # unit tests (stamps sw.js first)
```

`npm run dev` lets you try sync without Google: paste `http://localhost:8080/mock-gas/exec` as the backend URL. A second "device" is `http://127.0.0.1:8080/` (a different origin, so separate storage).

End-to-end test in a real browser (two phones, sync, offline, dark mode), with `npm run dev` running in another terminal:

```bash
npm install --no-save playwright-core
npm run e2e        # screenshots in outputs/e2e/
```

It uses the installed Edge or Chrome; set `E2E_BROWSER` to a browser executable to override.

### Deploy (GitHub Pages)

The app is plain static files served from the repo root.

1. After changing any app file run `npm run stamp` (also runs before `npm test`). It writes the file list and a content hash into `sw.js`; the new hash is what makes installed phones pick up the update.
2. Push to `main`.
3. One-time: GitHub repo > Settings > Pages > Source: *Deploy from a branch*, branch `main`, folder `/`. The app is then at `https://saginizar.github.io/gift-wallet/`.

`.nojekyll` keeps GitHub Pages from running Jekyll over the files.

### Sync backend (Google Sheet + Apps Script), one time

The same steps are shown inside the app under Settings > Sync, with a button that copies the script.

1. On a computer, signed in to the personal Google account: open https://sheets.new and name it, e.g. "ארנק מתנות".
2. Extensions > Apps Script. Replace the editor content with `backend/Code.gs`. Save.
3. Deploy > New deployment > type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and authorise. Google shows "Google hasn't verified this app": Advanced > Go to … This is expected for your own script.
4. Copy the **Web app URL** (ends with `/exec`) and paste it in the app on the first phone: Settings > Sync > המכשיר הראשון > חיבור.
5. On that phone: Settings > חיבור מכשיר נוסף. Scan the QR with the second phone's camera, or send the link. On iPhone, if the app is already on the home screen, open it there and paste the code (home-screen apps do not share storage with Safari).

Scopes the script asks for: this spreadsheet only (`@OnlyCurrentDoc`), sending email (opt-in reminders), and creating its own daily trigger (reminders).

To start over with a new key (for example if every paired device was lost): open the script, run `resetAll` once, then connect a device again. Data on the sheet is wiped; restore from a JSON backup.

Updating the script later: paste the new `Code.gs`, then Deploy > Manage deployments > edit (pencil) > Version: *New version* > Deploy. That keeps the same URL, so phones need no change.

## Project structure

```
index.html, manifest.webmanifest, sw.js   PWA shell (sw.js asset list is generated)
css/app.css                               All styles (RTL via logical properties, light/dark)
js/main.js                                Boot: storage, sync engine, render
js/lib/                                   Logic, no DOM; unit tested in Node
  model.js        types, derived balance/status, filters, totals
  store.js        in-memory state + IndexedDB persistence, activity log, LWW merge
  db.js           IndexedDB adapter (and an in-memory one for tests)
  sync.js         push/pull protocol, pairing codes, photo and reminder upload
  crypto.js       HKDF + AES-GCM (WebCrypto)
  parse-text.js   pulls amount/code/expiry/store out of a pasted SMS or email
  ocr.js          on-device text recognition (Tesseract.js), loaded on first scan
  ocr-text.js     rebuilds OCR lines in reading order (Hebrew mixed with numbers)
  code128.js      Code 128 barcode encoder (checked against JsBarcode fixtures)
  reminders.js    .ics export, Google Calendar links, reminder summary
  backup.js       JSON backup/restore, CSV export
  catalog.js      Israeli stores with Hebrew/English spellings
js/ui/                                    Preact + htm components, one file per screen
js/vendor/                                Preact+htm standalone, qrcode-generator (MIT),
                                          tesseract/ (Tesseract.js 7, Apache-2.0)
ocr/                                      Tesseract engine (WebAssembly) + Hebrew/English models
tests/fixtures/ocr/                       Receipt photo, SMS and email screenshots for OCR tests
backend/Code.gs                           Google Apps Script sync backend
scripts/serve.mjs                         Local static server (+ --mock-backend)
scripts/mock-gas.mjs                      Apps Script emulator that runs Code.gs unchanged
scripts/stamp-sw.mjs                      Writes the precache list + version into sw.js
scripts/e2e.mjs                           Browser end-to-end test (two phones)
scripts/make-icons.mjs                    Renders icons/icon.svg to PNGs (needs @resvg/resvg-js)
scripts/make-ocr-fixtures.mjs             Renders the OCR test images in a real browser
tests/                                    node:test unit tests (source, committed)
```

## Key decisions

- **Static PWA instead of a server on this laptop.** The laptop's Windows Firewall is managed by group policy (inbound blocked, local rules ignored, an explicit block rule for Node.js), so phones cannot reach a local server. GitHub Pages gives a stable HTTPS origin, which a service worker, the camera and WebCrypto all require.
- **Local-first.** Every device keeps the full wallet in IndexedDB and works with no connection; sync is optional and catches up when the network is back.
- **Sync through the household's own Google Sheet**, not a third-party service. Records are encrypted on the device (AES-GCM, key from HKDF over a random 256-bit household key); the sheet holds ciphertext and the script holds only a hash of the auth token. The pairing link carries the key in the URL fragment, which is never sent to a server.
- **Balance is derived, never stored.** A card has an initial amount; purchases, top-ups and corrections are ledger entries. Two phones recording purchases offline therefore add up correctly after sync, and any entry can be undone.
- **Last write wins per record**, ordered by `(updatedAt, deviceId)`, with timestamps that never move backwards for a record (so a phone with a slow clock still wins with a newer edit). The backend refuses older versions and returns the current one.
- **Email reminders are opt-in** because they need a plaintext summary on the sheet (store and title, balance, expiry, owner; never codes or PINs). The opt-in is a synced household setting, so whichever phone syncs keeps the list current. Without it, reminders come from the calendar (.ics / Google Calendar link per card or for all cards).
- **Emptying the bin wins.** If one phone purges a card while the other restores or edits it, the purge is kept on both; purchases stay in the ledger (notes blanked) so a restore can never come back with a wrong balance.
- **Text recognition runs on the phone** (Tesseract.js, English + Hebrew "best_int" models). The image never leaves the device and there is no API key or cost. The ~5 MB engine is fetched from this site (not a CDN) the first time someone scans and kept in its own cache, so app updates do not re-download it. Two passes: the whole image with English+Hebrew, then every number re-read alone with a digits-only model, because the Hebrew model tends to merge digits inside Hebrew lines ("189.90" read as "0"). Lines are rebuilt from word positions, since Tesseract's own order is unreliable when Hebrew and numbers mix.
- **No build step.** Preact + htm as a vendored ES module keeps the deploy to "push the files", and the precache list is generated so offline updates stay correct.
