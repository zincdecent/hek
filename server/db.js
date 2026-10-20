'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://bot:bot_dev_password@db:5432/whatsapp_bot',
  max: 10,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bot_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  bot_name         TEXT NOT NULL DEFAULT 'Tournament Assistant',
  business_name    TEXT NOT NULL DEFAULT 'Smash Tournament App',
  system_prompt    TEXT NOT NULL DEFAULT '',
  model            TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature      REAL NOT NULL DEFAULT 0.6,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  greeting         TEXT NOT NULL DEFAULT '',
  fallback_message TEXT NOT NULL DEFAULT '',
  handoff_message  TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bot_settings_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id              SERIAL PRIMARY KEY,
  wa_id           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'bot',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  CONSTRAINT contacts_status_check CHECK (status IN ('bot', 'human', 'closed'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender     TEXT NOT NULL CHECK (sender IN ('customer', 'bot', 'agent')),
  body       TEXT NOT NULL,
  ai_mode    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_contact_idx ON messages (contact_id, created_at);
`;

const SEED_SETTINGS = {
  bot_name: 'Tournament Assistant',
  business_name: 'Smash Tournament App',
  system_prompt:
    'You are {bot_name}, the WhatsApp support assistant for {business_name}.\n' +
    'Answer questions about tournaments, registration, schedules, match results, fees and refunds using the knowledge base below.\n' +
    'Keep replies short and WhatsApp-friendly: 2 to 4 sentences, warm and clear, at most one emoji.\n' +
    'Never invent details that are not in the knowledge base. If you do not know the answer, or the person asks for a human, say you will pass them to the team.',
  model: 'gpt-4o-mini',
  temperature: 0.6,
  enabled: true,
  greeting:
    "Hi! 👋 I'm the Smash Tournament App assistant. Ask me about tournaments, schedules, registration, fees or results.",
  fallback_message:
    "Good question! I don't have that in my notes yet — I've flagged it for our team and a human will reply here shortly.",
  handoff_message: 'Let me pass you to a human teammate 🙌',
};

const SEED_KNOWLEDGE = [
  {
    title: 'Tournament schedule',
    keywords: 'schedule, when, time, date, saturday, upcoming, next tournament',
    content:
      'Weekly smash tournaments run every Saturday from 6:00 PM to 9:00 PM at the City Sports Complex. Doors open 30 minutes early for warm-ups.',
  },
  {
    title: 'Registration and entry fee',
    keywords: 'register, registration, join, entry fee, price, cost, sign up',
    content:
      'Entry is PKR 1,500 per player per category. Register inside the app under Tournaments → Register, or send us your name, category and city here on WhatsApp.',
  },
  {
    title: 'Categories',
    keywords: 'category, singles, doubles, mixed, beginner, level',
    content:
      'We run singles, doubles and mixed doubles at beginner, intermediate and open levels. Beginners are always welcome and no ranking is required to enter.',
  },
  {
    title: 'Match results',
    keywords: 'result, score, standings, winner, points, table',
    content:
      'Results and standings are posted in the app under Results within 2 hours of a match finishing. You also get a WhatsApp summary after your last match of the day.',
  },
  {
    title: 'Payments',
    keywords: 'payment, pay, card, easypaisa, jazzcash, receipt',
    content:
      'You can pay by card in the app or in cash at the venue. Your entry is confirmed once payment is recorded, and a receipt appears under My Tournaments.',
  },
  {
    title: 'Refunds and cancellations',
    keywords: 'refund, cancel, cancellation, reschedule, postpone',
    content:
      'Cancel up to 24 hours before your first match for a full refund. Cancellations inside 24 hours, or tournaments we postpone, are moved to a credit for the next event.',
  },
  {
    title: 'Support hours and contact',
    keywords: 'support, hours, contact, human, call, phone, talk to someone',
    content:
      'Our team answers here from 10:00 AM to 8:00 PM daily. Outside those hours the assistant still replies instantly and a human follows up the next morning.',
  },
];

async function waitForDb(attempts = 20, delayMs = 2000) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db] not ready (${i}/${attempts}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function initDb() {
  await waitForDb();
  await pool.query(SCHEMA);

  await pool.query(
    `INSERT INTO bot_settings (id, bot_name, business_name, system_prompt, model, temperature, enabled,
                               greeting, fallback_message, handoff_message)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      SEED_SETTINGS.bot_name,
      SEED_SETTINGS.business_name,
      SEED_SETTINGS.system_prompt,
      SEED_SETTINGS.model,
      SEED_SETTINGS.temperature,
      SEED_SETTINGS.enabled,
      SEED_SETTINGS.greeting,
      SEED_SETTINGS.fallback_message,
      SEED_SETTINGS.handoff_message,
    ]
  );

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM knowledge_base');
  if (rows[0].n === 0) {
    for (const entry of SEED_KNOWLEDGE) {
      await pool.query(
        'INSERT INTO knowledge_base (title, content, keywords) VALUES ($1, $2, $3)',
        [entry.title, entry.content, entry.keywords]
      );
    }
    console.log(`[db] seeded ${SEED_KNOWLEDGE.length} knowledge base entries`);
  }
}

const ping = () => pool.query('SELECT 1');

module.exports = { pool, initDb, ping };
