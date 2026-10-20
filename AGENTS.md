# Working in this repo (Base44 sandbox notes)

## What this project is
A dependency-free static site: `index.html` (player app) and `admin.html` (admin
dashboard). No backend, no build step, no package manager, no test tooling.
Both pages are plain HTML/CSS/JS that talk to an **external Firebase project**
from the browser (Auth + Firestore), using the committed web config near the top
of each file's script block. There are no server-side environment variables and
no secrets to supply — the Firebase web config is client-side config, not a
credential, and it is already committed.

Data model in Firestore: `users/{uid}`, `tournaments`, `tournaments/{id}/participants`.

## Running it
```bash
docker compose -f docker-compose.base44.yml up -d --build
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/           # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin.html # 200
```
`nginx:alpine` serves the working tree bind-mounted read-only at
`/usr/share/nginx/html`; because the source is served straight from disk there is
no rebuild needed after an edit (just reload the page).

## Quirks worth knowing
- `.base44/nginx.conf` replaces nginx's **main** config. The repo lives in a
  sandbox home dir with mode `0700`, which the stock unprivileged `user nginx;`
  worker cannot traverse (every request returned 403), so that config keeps the
  workers as root. It also denies dotfiles (`.git`, `.base44`) and sends
  `Cache-Control: no-store` so edits are never cached.
- The app has **two separate HTML documents, not SPA routes**. `/admin.html` is a
  real second page: `pushState`-style navigation (including the preview helper's
  `navigate`) will not load it — open the URL, or load it in an iframe to inspect
  it, e.g. `https://3000-$BASE44_PUBLIC_HOST_SUFFIX/admin.html`.
- Firebase SDKs (v9 compat + modules) and Chart.js load from public CDNs, so the
  sandbox needs outbound network; the pages are blank-ish if those are blocked.

## Verifying it works
The app opens on a signed-out state (login / sign-up toggle on `index.html`,
admin login on `admin.html`). Confirm in a browser that:
- `document.title` is `Tournament App` on `/` and `Tournament Admin Panel` on
  `/admin.html`;
- the auth card is visible while the dashboard element stays hidden;
- the login ⇄ sign-up toggle on `/` switches the visible form;
- no console errors and no failed requests on either page.
Anything past the login screen (dashboard, tournaments, participants) needs a
real account in the Firebase project and is not verifiable without one.
