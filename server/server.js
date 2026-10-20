'use strict';

const path = require('path');
const express = require('express');

const { initDb, ping } = require('./db');
const settingsRouter = require('./routes/settings');
const knowledgeRouter = require('./routes/knowledge');
const conversationsRouter = require('./routes/conversations');
const chatRouter = require('./routes/chat');
const statsRouter = require('./routes/stats');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');
const WHATSAPP_DIR = path.join(ROOT, 'whatsapp');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------- API routes
app.get('/api/health', async (req, res) => {
  try {
    await ping();
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

app.use('/api/settings', settingsRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/stats', statsRouter);

// ------------------------------------------------------------- Page + assets
app.get('/bot', (req, res) => res.sendFile(path.join(WHATSAPP_DIR, 'admin.html')));
app.get('/simulator', (req, res) => res.sendFile(path.join(WHATSAPP_DIR, 'simulator.html')));
app.use('/whatsapp', express.static(WHATSAPP_DIR));

// The original app pages keep working exactly as before.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));

// ------------------------------------------------------------------- Errors
app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

async function start() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
