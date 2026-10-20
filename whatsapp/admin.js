/* WhatsApp bot agent — admin console (dashboard, inbox, knowledge base, settings, playground) */

const API = (path, options = {}) =>
  fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  });

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

let settings = null;
let aiConfigured = false;
let conversations = [];
let activeId = null;
let knowledge = [];
let editingId = null;
let chart = null;

const PLAYGROUND = { wa_id: 'playground', name: 'Playground test' };
const TITLES = {
  dashboard: ['Dashboard', 'Bot activity at a glance'],
  inbox: ['Inbox', 'Every chat the agent is handling'],
  knowledge: ['Knowledge Base', 'What the agent knows'],
  settings: ['Bot Settings', 'Tone, model and behaviour'],
  playground: ['Playground', 'Try the agent before your customers do'],
};

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2600);
}

const avatarOf = (item) => esc(((item.name || item.wa_id || '?').trim()[0] || '?').toUpperCase());
const nameOf = (item) => esc(item.name || item.wa_id);
const statusBadge = (status) => {
  if (status === 'human') return '<span class="badge human">Human</span>';
  if (status === 'closed') return '<span class="badge muted">Closed</span>';
  return '<span class="badge ok">Bot</span>';
};
const modeTag = (mode) => {
  if (!mode) return '';
  const label = { ai: 'AI reply', demo: 'Demo reply', fallback: 'Fallback', greeting: 'Greeting' }[mode] || mode;
  return `<span class="tag ${esc(mode)}">${esc(label)}</span>`;
};

/* ------------------------------------------------------------------ views */
function showView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${name}`));
  document.querySelectorAll('.nav button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === name));
  const [title, sub] = TITLES[name];
  $('view-title').textContent = title;
  $('view-sub').textContent = sub;

  if (name === 'dashboard') loadDashboard();
  if (name === 'inbox') loadConversations();
  if (name === 'knowledge') loadKnowledge();
  if (name === 'settings') loadSettings();
  if (name === 'playground') loadPlayground();
}

/* -------------------------------------------------------------- dashboard */
async function loadDashboard() {
  try {
    const { totals, daily, recent } = await API('/api/stats');
    renderStats(totals);
    renderChart(daily);
    $('recent-list').innerHTML = recent.length
      ? recent
          .map(
            (c) => `<div class="conv" data-open="${c.id}">
              <div class="avatar">${avatarOf(c)}</div>
              <div>
                <div class="name">${nameOf(c)}</div>
                <div class="preview">${esc(c.wa_id)}</div>
              </div>
              <div class="meta">${statusBadge(c.status)}</div>
            </div>`
          )
          .join('')
      : '<div class="empty">No conversations yet — open the simulator and send a message.</div>';

    $('recent-list')
      .querySelectorAll('[data-open]')
      .forEach((row) =>
        row.addEventListener('click', () => {
          activeId = Number(row.dataset.open);
          showView('inbox');
        })
      );
  } catch (err) {
    toast(err.message, true);
  }
}

function renderStats(t) {
  const cards = [
    ['Conversations', t.conversations, 'fa-comments'],
    ['Messages', t.messages, 'fa-envelope'],
    ['Bot replies', t.bot_replies, 'fa-robot'],
    ['Human handoffs', t.handoffs, 'fa-headset'],
  ];

  $('stats-grid').innerHTML = cards
    .map(
      ([label, value, icon]) => `<div class="card stat">
        <div class="icon"><i class="fas ${icon}"></i></div>
        <div>
          <div class="value">${value ?? 0}</div>
          <div class="label">${label}</div>
        </div>
      </div>`
    )
    .join('');
}

function renderChart(daily) {
  const byDay = Object.fromEntries(daily.map((row) => [row.day, row]));
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date.toISOString().slice(0, 10));
  }

  const labels = days.map((day) => new Date(`${day}T00:00:00`).toLocaleDateString([], { weekday: 'short' }));
  const inbound = days.map((day) => byDay[day]?.inbound ?? 0);
  const outbound = days.map((day) => byDay[day]?.outbound ?? 0);

  if (chart) chart.destroy();
  chart = new Chart($('chart-canvas'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Incoming', data: inbound, backgroundColor: '#128c7e', borderRadius: 5, maxBarThickness: 26 },
        { label: 'Replies', data: outbound, backgroundColor: '#25d366', borderRadius: 5, maxBarThickness: 26 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef1f3' } },
        x: { grid: { display: false } },
      },
    },
  });
}

/* ------------------------------------------------------------------ inbox */
async function loadConversations() {
  try {
    const data = await API('/api/conversations');
    conversations = data.conversations;
    renderConvList();

    if (!conversations.length) {
      activeId = null;
      renderThread(null, []);
      $('thread-head').innerHTML = '<div><div class="who">No conversations yet</div><div class="num">Send a message from the chat simulator to start one.</div></div>';
      return;
    }

    if (!conversations.some((c) => c.id === activeId)) activeId = conversations[0].id;
    await openConversation(activeId);
  } catch (err) {
    toast(err.message, true);
  }
}

function renderConvList() {
  $('conv-list').innerHTML = conversations.length
    ? conversations
        .map(
          (c) => `<div class="conv ${c.id === activeId ? 'active' : ''}" data-conv="${c.id}">
            <div class="avatar">${avatarOf(c)}</div>
            <div>
              <div class="name">${nameOf(c)}</div>
              <div class="preview">${c.last_sender === 'customer' ? '' : '<i class="fas fa-check"></i> '}${esc(c.last_body || '')}</div>
            </div>
            <div class="meta">
              <span>${fmtTime(c.last_at)}</span>
              ${statusBadge(c.status)}
            </div>
          </div>`
        )
        .join('')
    : '<div class="empty">No conversations yet.</div>';

  $('conv-list')
    .querySelectorAll('[data-conv]')
    .forEach((row) => row.addEventListener('click', () => openConversation(Number(row.dataset.conv))));
}

async function openConversation(id) {
  activeId = id;
  renderConvList();
  try {
    const { conversation, messages } = await API(`/api/conversations/${id}/messages`);
    renderThreadHead(conversation);
    renderThread(conversation, messages);
  } catch (err) {
    toast(err.message, true);
  }
}

function renderThreadHead(conversation) {
  $('thread-head').innerHTML = `
    <div>
      <div class="who">${nameOf(conversation)}</div>
      <div class="num">${esc(conversation.wa_id)}</div>
    </div>
    <div class="actions">
      <select class="select" id="thread-status" style="width:150px">
        <option value="bot" ${conversation.status === 'bot' ? 'selected' : ''}>Bot replies</option>
        <option value="human" ${conversation.status === 'human' ? 'selected' : ''}>Human takeover</option>
        <option value="closed" ${conversation.status === 'closed' ? 'selected' : ''}>Closed</option>
      </select>
      <button class="btn btn-danger btn-sm" id="thread-delete"><i class="fas fa-trash"></i> Delete</button>
    </div>`;

  $('thread-status').addEventListener('change', async (event) => {
    try {
      await API(`/api/conversations/${conversation.id}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) });
      toast('Conversation updated');
      await loadConversations();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('thread-delete').addEventListener('click', async () => {
    if (!window.confirm(`Delete the conversation with ${conversation.name || conversation.wa_id}?`)) return;
    try {
      await API(`/api/conversations/${conversation.id}`, { method: 'DELETE' });
      activeId = null;
      toast('Conversation deleted');
      await loadConversations();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function bubble(message) {
  const outgoing = message.direction === 'out';
  const tag = outgoing && message.sender === 'bot' ? modeTag(message.ai_mode) : outgoing ? '<span class="tag agent">Agent</span>' : '';
  return `<div class="msg ${outgoing ? 'out' : 'in'}">${tag}${esc(message.body).replace(/\n/g, '<br>')}<span class="time">${fmtTime(message.created_at)}</span></div>`;
}

function renderThread(conversation, messages, container = $('thread')) {
  if (!messages.length) {
    container.innerHTML = '<div class="empty">No messages in this conversation yet.</div>';
    return;
  }

  let day = '';
  container.innerHTML = messages
    .map((message) => {
      const currentDay = message.created_at.slice(0, 10);
      const separator = currentDay !== day ? `<div class="day-sep">${fmtDay(message.created_at)}</div>` : '';
      day = currentDay;
      return separator + bubble(message);
    })
    .join('');

  container.scrollTop = container.scrollHeight;
}

async function sendAgentReply() {
  const input = $('reply-input');
  const body = input.value.trim();
  if (!body || !activeId) return;
  if (!body) return;

  try {
    await API(`/api/conversations/${activeId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    input.value = '';
    await openConversation(activeId);
    await loadConversations();
  } catch (err) {
    toast(err.message, true);
  }
}

/* --------------------------------------------------------- knowledge base */
async function loadKnowledge() {
  try {
    const data = await API('/api/knowledge');
    knowledge = data.entries;
    renderKnowledge();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderKnowledge() {
  $('kb-table').innerHTML = knowledge.length
    ? `<table class="data">
        <thead><tr><th style="width:26%">Title</th><th>Answer</th><th style="width:120px"></th></tr></thead>
        <tbody>
          ${knowledge
            .map(
              (entry) => `<tr>
                <td><strong>${esc(entry.title)}</strong><div class="kw">${esc(entry.keywords || '')}</div></td>
                <td>${esc(entry.content)}</td>
                <td class="row">
                  <button class="btn btn-ghost btn-sm" data-edit="${entry.id}"><i class="fas fa-pen"></i></button>
                  <button class="btn btn-danger btn-sm" data-del="${entry.id}"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : '<div class="empty">No entries yet — the bot will fall back to its fallback reply.</div>';

  $('kb-table')
    .querySelectorAll('[data-edit]')
    .forEach((btn) => btn.addEventListener('click', () => startEditKnowledge(Number(btn.dataset.edit))));

  $('kb-table')
    .querySelectorAll('[data-del]')
    .forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this knowledge entry?')) return;
        try {
          await API(`/api/knowledge/${btn.dataset.del}`, { method: 'DELETE' });
          if (editingId === Number(btn.dataset.del)) resetKnowledgeForm();
          toast('Entry deleted');
          await loadKnowledge();
        } catch (err) {
          toast(err.message, true);
        }
      })
    );
}

function startEditKnowledge(id) {
  const entry = knowledge.find((item) => item.id === id);
  if (!entry) return;
  editingId = id;
  $('kb-title').value = entry.title;
  $('kb-content').value = entry.content;
  $('kb-keywords').value = entry.keywords || '';
  $('kb-form-title').textContent = `Editing “${entry.title}”`;
  $('kb-submit').innerHTML = '<i class="fas fa-save"></i> Save entry';
  $('kb-cancel').classList.remove('hidden');
  $('kb-title').focus();
}

function resetKnowledgeForm() {
  editingId = null;
  $('kb-title').value = '';
  $('kb-content').value = '';
  $('kb-keywords').value = '';
  $('kb-form-title').textContent = 'Add a knowledge entry';
  $('kb-submit').innerHTML = '<i class="fas fa-plus"></i> Add entry';
  $('kb-cancel').classList.add('hidden');
}

async function submitKnowledge() {
  const payload = {
    title: $('kb-title').value.trim(),
    content: $('kb-content').value.trim(),
    keywords: $('kb-keywords').value.trim(),
  };

  if (!payload.title || !payload.content) {
    toast('Title and answer are required', true);
    return;
  }

  try {
    if (editingId) {
      await API(`/api/knowledge/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Entry updated');
    } else {
      await API('/api/knowledge', { method: 'POST', body: JSON.stringify(payload) });
      toast('Entry added');
    }
    resetKnowledgeForm();
    await loadKnowledge();
  } catch (err) {
    toast(err.message, true);
  }
}

/* --------------------------------------------------------------- settings */
async function loadSettings() {
  try {
    const data = await API('/api/settings');
    settings = data.settings;
    aiConfigured = data.ai_configured;

    $('ai-badge').className = `badge ${aiConfigured ? 'ok' : 'demo'}`;
    $('ai-badge').innerHTML = aiConfigured
      ? '<i class="fas fa-bolt"></i> AI replies live'
      : '<i class="fas fa-triangle-exclamation"></i> Demo mode — no AI key';

    $('brand-sub').textContent = settings.bot_name || 'Automated chat bot';

    $('set-enabled').checked = settings.enabled;
    $('set-bot-name').value = settings.bot_name || '';
    $('set-business').value = settings.business_name || '';
    $('set-model').value = settings.model || '';
    $('set-temperature').value = settings.temperature ?? 0.6;
    $('set-prompt').value = settings.system_prompt || '';
    $('set-greeting').value = settings.greeting || '';
    $('set-fallback').value = settings.fallback_message || '';
    $('set-handoff').value = settings.handoff_message || '';

    $('settings-ai').innerHTML = aiConfigured
      ? `<h3>AI replies are live</h3>
         <p class="hint" style="margin:0">Requests are signed with the OPENAI_API_KEY configured for this app, using the model <strong>${esc(settings.model)}</strong>. Conversation history and the knowledge base are sent with every message.</p>`
      : `<h3>Demo mode</h3>
         <p class="hint" style="margin:0">No <strong>OPENAI_API_KEY</strong> is configured, so the agent answers from the knowledge base with keyword matching instead of an AI model. Add the key to your app secrets and every reply becomes AI-generated — nothing else changes.</p>`;
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveSettings() {
  const payload = {
    enabled: $('set-enabled').checked,
    bot_name: $('set-bot-name').value.trim(),
    business_name: $('set-business').value.trim(),
    model: $('set-model').value.trim(),
    temperature: Number($('set-temperature').value),
    system_prompt: $('set-prompt').value,
    greeting: $('set-greeting').value,
    fallback_message: $('set-fallback').value,
    handoff_message: $('set-handoff').value,
  };

  try {
    await API('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    toast('Settings saved');
    await loadSettings();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ------------------------------------------------------------- playground */
async function loadPlayground() {
  try {
    const listing = await API('/api/conversations');
    const existing = listing.conversations.find((c) => c.wa_id === PLAYGROUND.wa_id);
    if (!existing) {
      $('pg-thread').innerHTML = '<div class="empty">Send a message to start testing the agent.</div>';
      return;
    }
    const { conversation, messages } = await API(`/api/conversations/${existing.id}/messages`);
    renderThread(conversation, messages, $('pg-thread'));
  } catch (err) {
    toast(err.message, true);
  }
}

async function sendPlayground() {
  const input = $('pg-input');
  const body = input.value.trim();
  if (!body) return;

  const pending = document.createElement('div');
  pending.className = 'msg in';
  pending.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  const thread = $('pg-thread');
  thread.querySelector('.empty')?.remove();
  thread.appendChild(pending);
  thread.scrollTop = thread.scrollHeight;

  try {
    const result = await API('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ wa_id: PLAYGROUND.wa_id, name: PLAYGROUND.name, body }),
    });
    pending.remove();
    await loadPlayground();
    if (!result.bot_replied) toast(result.reason === 'bot_disabled' ? 'Bot replies are switched off' : 'This chat is handled by a human', true);
  } catch (err) {
    pending.remove();
    toast(err.message, true);
  } finally {
    input.value = '';
  }
}

/* ------------------------------------------------------------------- boot */
document.querySelectorAll('.nav button').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));
$('reply-send').addEventListener('click', sendAgentReply);
$('reply-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendAgentReply();
  }
});
$('kb-submit').addEventListener('click', submitKnowledge);
$('kb-cancel').addEventListener('click', resetKnowledgeForm);
$('settings-save').addEventListener('click', saveSettings);
$('pg-send').addEventListener('click', sendPlayground);
$('pg-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPlayground();
  }
});
$('pg-reset').addEventListener('click', async () => {
  try {
    await API('/api/chat/reset', { method: 'POST', body: JSON.stringify({ wa_id: PLAYGROUND.wa_id }) });
    toast('Playground cleared');
    await loadPlayground();
  } catch (err) {
    toast(err.message, true);
  }
});

(async function boot() {
  await loadSettings();
  showView('dashboard');
})();
