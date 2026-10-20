'use strict';

const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const { rows: totals } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM contacts c WHERE EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id)) AS conversations,
        (SELECT count(*)::int FROM messages)                                 AS messages,
        (SELECT count(*)::int FROM messages WHERE direction = 'in')          AS inbound,
        (SELECT count(*)::int FROM messages WHERE direction = 'out')         AS outbound,
        (SELECT count(*)::int FROM messages WHERE sender = 'bot')            AS bot_replies,
        (SELECT count(*)::int FROM messages WHERE sender = 'agent')          AS agent_replies,
        (SELECT count(*)::int FROM contacts WHERE status = 'human')          AS handoffs,
        (SELECT count(*)::int FROM knowledge_base)                           AS knowledge_entries
    `);

    const { rows: daily } = await pool.query(`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             count(*) FILTER (WHERE direction = 'in')::int  AS inbound,
             count(*) FILTER (WHERE direction = 'out')::int AS outbound
        FROM messages
       WHERE created_at >= now() - interval '6 days'
       GROUP BY 1
       ORDER BY 1
    `);

    const { rows: recent } = await pool.query(`
      SELECT id, wa_id, name, status, last_message_at
        FROM contacts
       WHERE EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = contacts.id)
       ORDER BY COALESCE(last_message_at, created_at) DESC
       LIMIT 5
    `);

    res.json({ totals: totals[0], daily, recent });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
