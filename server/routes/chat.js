'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { generateReply } = require('../lib/ai');

async function upsertContact(waId, name) {
  const { rows } = await pool.query(
    `INSERT INTO contacts (wa_id, name, last_message_at)
     VALUES ($1, $2, now())
     ON CONFLICT (wa_id) DO UPDATE
       SET name = CASE WHEN EXCLUDED.name = '' THEN contacts.name ELSE EXCLUDED.name END,
           last_message_at = now()
     RETURNING *`,
    [waId, name]
  );
  return rows[0];
}

async function addMessage(contactId, direction, sender, body, aiMode = null) {
  const { rows } = await pool.query(
    `INSERT INTO messages (contact_id, direction, sender, body, ai_mode)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [contactId, direction, sender, body, aiMode]
  );
  await pool.query('UPDATE contacts SET last_message_at = now() WHERE id = $1', [contactId]);
  return rows[0];
}

async function historyBefore(contactId, messageId) {
  const { rows } = await pool.query(
    `SELECT direction, sender, body FROM messages
      WHERE contact_id = $1 AND id < $2
      ORDER BY id DESC LIMIT 10`,
    [contactId, messageId]
  );
  return rows.reverse();
}

/**
 * Incoming WhatsApp message (the simulator plays the customer).
 * Stores the inbound message and, when the bot owns the chat, generates and stores a reply.
 */
router.post('/', async (req, res, next) => {
  try {
    const waId = String(req.body?.wa_id || '').trim();
    const body = String(req.body?.body || '').trim();
    const name = String(req.body?.name || '').trim();

    if (!waId) return res.status(400).json({ error: 'wa_id is required' });
    if (!body) return res.status(400).json({ error: 'body is required' });

    const contact = await upsertContact(waId, name);
    const inbound = await addMessage(contact.id, 'in', 'customer', body);

    const { rows: settingRows } = await pool.query('SELECT * FROM bot_settings WHERE id = 1');
    const settings = settingRows[0];

    if (!settings.enabled) {
      return res.json({ contact, inbound, reply: null, bot_replied: false, reason: 'bot_disabled' });
    }
    if (contact.status !== 'bot') {
      return res.json({ contact, inbound, reply: null, bot_replied: false, reason: contact.status });
    }

    const { rows: knowledge } = await pool.query('SELECT * FROM knowledge_base ORDER BY id');
    const history = await historyBefore(contact.id, inbound.id);

    // First ever message from this contact: greet before answering.
    let greeting = null;
    if (history.length === 0 && settings.greeting) {
      greeting = await addMessage(contact.id, 'out', 'bot', settings.greeting, 'greeting');
    }

    const { text, mode, error } = await generateReply({ settings, knowledge, history, latest: body });
    const reply = await addMessage(contact.id, 'out', 'bot', text, mode);

    res.status(201).json({
      contact,
      inbound,
      greeting,
      reply,
      bot_replied: true,
      ai_mode: mode,
      ai_error: error || null,
    });
  } catch (err) {
    next(err);
  }
});

/** Clears a simulated chat so the same number can start over. */
router.post('/reset', async (req, res, next) => {
  try {
    const waId = String(req.body?.wa_id || '').trim();
    if (!waId) return res.status(400).json({ error: 'wa_id is required' });

    const { rowCount } = await pool.query('DELETE FROM contacts WHERE wa_id = $1', [waId]);
    res.json({ reset: waId, deleted: rowCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
