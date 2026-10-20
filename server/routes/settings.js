'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { aiConfigured } = require('../lib/ai');

const TEXT_FIELDS = [
  'bot_name',
  'business_name',
  'system_prompt',
  'model',
  'greeting',
  'fallback_message',
  'handoff_message',
];

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bot_settings WHERE id = 1');
    res.json({
      settings: rows[0],
      ai_configured: aiConfigured(),
      model_source: 'settings',
    });
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const updates = [];
    const values = [];

    for (const field of TEXT_FIELDS) {
      if (body[field] === undefined) continue;
      values.push(String(body[field]));
      updates.push(`${field} = $${values.length}`);
    }

    if (body.temperature !== undefined) {
      const temp = Number(body.temperature);
      if (Number.isNaN(temp) || temp < 0 || temp > 2) {
        return res.status(400).json({ error: 'temperature must be between 0 and 2' });
      }
      values.push(temp);
      updates.push(`temperature = $${values.length}`);
    }

    if (body.enabled !== undefined) {
      values.push(Boolean(body.enabled));
      updates.push(`enabled = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'nothing to update' });
    }

    updates.push('updated_at = now()');

    const { rows } = await pool.query(
      `UPDATE bot_settings SET ${updates.join(', ')} WHERE id = 1 RETURNING *`,
      values
    );

    res.json({ settings: rows[0], ai_configured: aiConfigured() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
