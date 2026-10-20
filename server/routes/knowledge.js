'use strict';

const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM knowledge_base ORDER BY id');
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const keywords = String(req.body?.keywords || '').trim();

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const { rows } = await pool.query(
      'INSERT INTO knowledge_base (title, content, keywords) VALUES ($1, $2, $3) RETURNING *',
      [title, content, keywords]
    );

    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const keywords = String(req.body?.keywords || '').trim();

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const { rows } = await pool.query(
      `UPDATE knowledge_base
          SET title = $1, content = $2, keywords = $3, updated_at = now()
        WHERE id = $4
        RETURNING *`,
      [title, content, keywords, req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM knowledge_base WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: Number(req.params.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
