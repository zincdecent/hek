'use strict';

const router = require('express').Router();
const { pool } = require('../db');

const STATUSES = ['bot', 'human', 'closed'];

const LIST_QUERY = `
  SELECT c.*,
         (SELECT body       FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
         (SELECT sender     FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
         (SELECT created_at FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
         (SELECT count(*)::int FROM messages m WHERE m.contact_id = c.id)                          AS message_count,
         (SELECT count(*)::int FROM messages m WHERE m.contact_id = c.id AND m.direction = 'out')  AS reply_count
    FROM contacts c
   WHERE EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id)
   ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(LIST_QUERY);
    res.json({ conversations: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/messages', async (req, res, next) => {
  try {
    const { rows: contacts } = await pool.query('SELECT * FROM contacts WHERE id = $1', [req.params.id]);
    if (!contacts.length) return res.status(404).json({ error: 'not found' });

    const { rows: messages } = await pool.query(
      'SELECT * FROM messages WHERE contact_id = $1 ORDER BY created_at ASC, id ASC',
      [req.params.id]
    );

    res.json({ conversation: contacts[0], messages });
  } catch (err) {
    next(err);
  }
});

/** Human agent reply — does not change who owns the conversation. */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body is required' });

    const { rows: contacts } = await pool.query('SELECT * FROM contacts WHERE id = $1', [req.params.id]);
    if (!contacts.length) return res.status(404).json({ error: 'not found' });

    const { rows } = await pool.query(
      `INSERT INTO messages (contact_id, direction, sender, body)
       VALUES ($1, 'out', 'agent', $2)
       RETURNING *`,
      [req.params.id, body]
    );

    await pool.query('UPDATE contacts SET last_message_at = now() WHERE id = $1', [req.params.id]);

    res.status(201).json({ message: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const updates = [];
    const values = [];

    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
      }
      values.push(status);
      updates.push(`status = $${values.length}`);
    }

    if (req.body?.name !== undefined) {
      values.push(String(req.body.name).trim());
      updates.push(`name = $${values.length}`);
    }

    if (!updates.length) return res.status(400).json({ error: 'nothing to update' });

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ conversation: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** Deletes the conversation and its messages (cascade). */
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: Number(req.params.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
