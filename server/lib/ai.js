'use strict';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MAX_HISTORY = 10;

const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

function renderSettings(settings) {
  return {
    bot_name: settings.bot_name || 'Assistant',
    business_name: settings.business_name || 'our team',
    system_prompt: settings.system_prompt || '',
    fallback_message: settings.fallback_message || 'Sorry, I could not find that. Let me pass you to the team.',
    handoff_message: settings.handoff_message || '',
  };
}

function buildSystemPrompt(settings, knowledge) {
  const s = renderSettings(settings);
  const prompt = s.system_prompt
    .replace(/\{bot_name\}/g, s.bot_name)
    .replace(/\{business_name\}/g, s.business_name);

  const kb = knowledge
    .map((entry) => `- ${entry.title}: ${entry.content}`)
    .join('\n');

  return [
    prompt,
    `Your name is ${s.bot_name} and you work for ${s.business_name}.`,
    s.handoff_message ? `If the person asks for a human, reply with: "${s.handoff_message}"` : '',
    kb ? `Knowledge base:\n${kb}` : 'The knowledge base is empty, so keep replies general and offer to pass the person to the team.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Keyword-scored answer from the knowledge base, used when no AI key is configured. */
function demoReply(settings, knowledge, text) {
  const words = String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  let best = null;
  let bestScore = 0;

  for (const entry of knowledge) {
    const haystack = `${entry.title} ${entry.keywords || ''} ${entry.content}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (haystack.includes(word)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (best && bestScore >= 1) return best.content;
  return renderSettings(settings).fallback_message;
}

/**
 * Generates the bot reply for one incoming message.
 * Returns { text, mode } where mode is 'ai', 'demo' (no key) or 'fallback' (upstream error).
 */
async function generateReply({ settings, knowledge, history, latest }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { text: demoReply(settings, knowledge, latest), mode: 'demo' };
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(settings, knowledge) },
    ...history.slice(-MAX_HISTORY).map((m) => ({
      role: m.direction === 'in' ? 'user' : 'assistant',
      content: m.body,
    })),
    { role: 'user', content: latest },
  ];

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        temperature: Number(settings.temperature ?? 0.6),
        max_tokens: 320,
        messages,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${response.status} ${detail.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty completion');

    return { text, mode: 'ai' };
  } catch (err) {
    console.error('[ai] reply failed:', err.message);
    return {
      text: renderSettings(settings).fallback_message,
      mode: 'fallback',
      error: err.message,
    };
  }
}

module.exports = { generateReply, aiConfigured };
