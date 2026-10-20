# AGENTS.md

Notes for anyone (human or agent) working in this repository.

## What this repo is

A static site — `index.html` (player-facing tournament app) and `admin.html` (tournament
admin panel), both plain HTML + vanilla JS talking to Firebase. There is no build step.

On top of that, this branch adds the **WhatsApp bot agent**:

| Part | Where |
| --- | --- |
| API + static server | `server/` (Express, `pg`) |
| Bot console | `whatsapp/admin.html` + `whatsapp/admin.js` → served at `/bot` |
| Chat simulator | `whatsapp/simulator.html` + `whatsapp/simulator.js` → served at `/simulator` |
| Database | Postgres, schema created and seeded on boot by `server/db.js` |

The Express server is the only web entry point (port 3000). It also serves the original
`index.html` at `/` and `admin.html` at `/admin.html`, so the existing app keeps working.

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml logs -f app
```

- `app` runs `npm install` on startup (dependencies live in the `bot_node_modules`
  volume) and then `nodemon`, so server edits reload automatically. Static HTML/CSS/JS
  edits are served straight from the bind mount — refresh the page.
- `db` is Postgres; the schema and default knowledge entries are created idempotently on
  every boot (`server/db.js`). No migration step to run.
- Health: `curl localhost:3000/api/health` returns `{"ok":true,"db":"up"}`.

## How the bot works

1. `POST /api/chat` (`{ wa_id, name?, body }`) stores the inbound message, creates the
   contact on first sight and, when the bot owns the chat, generates a reply.
2. A brand-new contact first gets the configured **greeting** as its own stored message.
3. `server/lib/ai.js` builds the prompt from Bot Settings + the knowledge base + the last
   10 messages, then calls the OpenAI-compatible API with `OPENAI_API_KEY`.
4. **No `OPENAI_API_KEY` = demo mode**: the same reply path runs, but answers are picked
   from the knowledge base by keyword overlap (or the fallback message). The console shows
   a "Demo mode" badge. Nothing breaks without the key.
5. Reply mode is stored per message in `messages.ai_mode` (`ai`, `demo`, `fallback`,
   `greeting`) and shown as a tag in the console.

Conversation ownership is a single `contacts.status` value: `bot` (automated), `human`
(handed off — the bot stays quiet) or `closed`.

## Gotchas

- Never hardcode the preview host; the app binds `0.0.0.0` and does not filter Host or
  Origin, so no extra allowlist is needed for the sandbox proxy.
- `OPENAI_API_KEY` must only come from `/run/base44/app.env` — do not add it to compose
  `environment:` or a repo `.env`, or a later dashboard change would be ignored.
- The bot console and simulator have no authentication (this is a local simulator, not a
  public deployment). Do not expose them publicly as-is.
- Deleting a contact cascades to its messages; `POST /api/chat/reset` clears one simulated
  chat by `wa_id`.
