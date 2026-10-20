# hek

Tournament app (static site) plus a **WhatsApp automated chat bot agent**.

## WhatsApp bot agent

- **Bot console** — `http://localhost:3000/bot`: dashboard, conversation inbox with human
  takeover, knowledge base editor, bot settings and a test playground.
- **Chat simulator** — `http://localhost:3000/simulator`: a WhatsApp-style phone view that
  plays the customer, so you can talk to the agent end to end without any WhatsApp account.

The agent stores every conversation in Postgres and answers with an AI model. Without an
`OPENAI_API_KEY` it runs in demo mode, answering from the knowledge base by keyword match —
the console shows which mode is active.

### Run it

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

Existing pages are untouched: `/` serves `index.html`, `/admin.html` serves the tournament
admin panel.

See `AGENTS.md` for the API and internals.
