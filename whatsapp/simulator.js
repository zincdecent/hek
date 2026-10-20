/* Chat simulator — this page plays the customer's phone, so the bot talks back to you */

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

const thread = $('sim-thread');

const customer = () => ({
  wa_id: $('sim-number').value.trim() || '923001234567',
  name: $('sim-name').value.trim(),
});

function bubble(message) {
  // In the simulator the customer's own messages sit on the right.
  const mine = message.sender === 'customer';
  const label = !mine && message.sender === 'agent' ? '<span class="tag agent">Agent</span>' : '';
  return `<div class="msg ${mine ? 'out' : 'in'}">${label}${esc(message.body).replace(/\n/g, '<br>')}<span class="time">${fmtTime(message.created_at)}</span></div>`;
}

function append(message) {
  thread.querySelector('.empty')?.remove();
  thread.insertAdjacentHTML('beforeend', bubble(message));
  thread.scrollTop = thread.scrollHeight;
}

function showTyping() {
  thread.insertAdjacentHTML('beforeend', '<div class="msg in" id="sim-typing"><span class="typing"><span></span><span></span><span></span></span></div>');
  thread.scrollTop = thread.scrollHeight;
}

const hideTyping = () => $('sim-typing')?.remove();

function setThread(messages) {
  thread.innerHTML = messages.length
    ? messages.map(bubble).join('')
    : '<div class="empty">Say hello — the agent replies instantly.</div>';
  thread.scrollTop = thread.scrollHeight;
}

async function loadHistory() {
  try {
    const { conversations } = await API('/api/conversations');
    const match = conversations.find((c) => c.wa_id === customer().wa_id);
    if (!match) {
      setThread([]);
      return;
    }
    const { messages } = await API(`/api/conversations/${match.id}/messages`);
    setThread(messages);
  } catch (err) {
    setThread([]);
  }
}

async function loadBotInfo() {
  try {
    const { settings, ai_configured } = await API('/api/settings');
    $('sim-bot-name').textContent = settings.bot_name || 'Assistant';
    $('sim-status').textContent = settings.enabled ? 'online · replies instantly' : 'paused · bot replies are off';
    $('sim-mode').textContent = ai_configured
      ? 'AI replies are live for this agent.'
      : 'Demo mode: no AI key is configured, so replies come from the knowledge base.';
  } catch (err) {
    $('sim-mode').textContent = 'Console unreachable.';
  }
}

async function send(body) {
  append({ sender: 'customer', direction: 'in', body, created_at: new Date().toISOString() });
  showTyping();

  try {
    const result = await API('/api/chat', { method: 'POST', body: JSON.stringify({ ...customer(), body }) });
    hideTyping();

    if (result.greeting) append(result.greeting);
    if (result.reply) append(result.reply);
    if (!result.bot_replied) {
      append({
        sender: 'agent',
        direction: 'out',
        body: result.reason === 'bot_disabled'
          ? '(bot replies are switched off — turn them on in the console)'
          : '(this chat is assigned to a human teammate)',
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    hideTyping();
    append({ sender: 'agent', direction: 'out', body: `(error: ${err.message})`, created_at: new Date().toISOString() });
  }
}

$('sim-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const body = $('sim-input').value.trim();
  if (!body) return;
  $('sim-input').value = '';
  send(body);
});

$('sim-new').addEventListener('click', async () => {
  try {
    await API('/api/chat/reset', { method: 'POST', body: JSON.stringify({ wa_id: customer().wa_id }) });
    setThread([]);
  } catch (err) {
    alert(err.message);
  }
});

$('sim-number').addEventListener('change', loadHistory);
$('sim-name').addEventListener('change', loadHistory);

loadBotInfo();
loadHistory();
