export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = ['shelbycorbitt.com', 'www.shelbycorbitt.com', 'localhost'];
  if (!allowed.some(d => origin.includes(d) || referer.includes(d))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ error: 'Database not configured. Set up Vercel KV in your dashboard.' });
  }

  const { action } = req.body || {};

  try {
    if (action === 'create') {
      const { name, language, vibe } = req.body;
      if (!name || !language) return res.status(400).json({ error: 'Missing fields' });
      const code = generateCode();
      const userId = generateId();
      const room = {
        code,
        createdAt: Date.now(),
        users: { [userId]: { name, language, vibe: vibe || '' } },
        messages: []
      };
      await kvSet(`room:${code}`, room);
      return res.json({ ok: true, code, userId });
    }

    if (action === 'join') {
      const { code, name, language, vibe } = req.body;
      const roomKey = code.toUpperCase();
      const room = await kvGet(`room:${roomKey}`);
      if (!room) return res.status(404).json({ error: 'Room not found. Double-check the code.' });
      if (Object.keys(room.users).length >= 2) return res.status(400).json({ error: 'This room already has two people.' });
      const other = Object.values(room.users)[0];
      if (other.language === language) {
        const other_lang = language === 'en' ? 'English' : 'Español';
        return res.status(400).json({ error: `Your friend is already using ${other_lang}. Switch languages.` });
      }
      const userId = generateId();
      room.users[userId] = { name, language, vibe: vibe || '' };
      await kvSet(`room:${roomKey}`, room);
      return res.json({ ok: true, userId, room });
    }

    if (action === 'send') {
      const { code, userId, text } = req.body;
      if (!text?.trim()) return res.status(400).json({ error: 'Empty message' });
      const room = await kvGet(`room:${code}`);
      if (!room) return res.status(404).json({ error: 'Room expired or not found.' });
      const sender = room.users[userId];
      if (!sender) return res.status(403).json({ error: 'You are not in this room.' });
      const recipientEntry = Object.entries(room.users).find(([id]) => id !== userId);
      if (!recipientEntry) return res.status(400).json({ error: 'Still waiting for your friend to join.' });
      const recipient = recipientEntry[1];

      const recentMessages = room.messages.slice(-6).map(m =>
        `${m.senderName}: ${m.originalText}`
      ).join('\n');

      const translation = await translateWithClaude({
        text: text.trim(),
        senderName: sender.name,
        senderVibe: sender.vibe,
        senderLanguage: sender.language,
        targetLanguage: recipient.language,
        recentMessages
      });

      const message = {
        id: generateId(),
        senderId: userId,
        senderName: sender.name,
        originalText: text.trim(),
        originalLang: sender.language,
        translatedText: translation,
        translatedLang: recipient.language,
        timestamp: Date.now()
      };

      room.messages.push(message);
      if (room.messages.length > 60) room.messages = room.messages.slice(-60);
      await kvSet(`room:${code}`, room);
      return res.json({ ok: true, message });
    }

    if (action === 'poll') {
      const { code, since } = req.body;
      const room = await kvGet(`room:${code}`);
      if (!room) return res.status(404).json({ error: 'Room not found.' });
      const newMessages = room.messages.filter(m => m.timestamp > (since || 0));
      return res.json({ ok: true, messages: newMessages, users: room.users, userCount: Object.keys(room.users).length });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}

async function translateWithClaude({ text, senderName, senderVibe, senderLanguage, targetLanguage, recentMessages }) {
  const langNames = { en: 'English', es: 'Spanish' };
  const src = langNames[senderLanguage];
  const tgt = langNames[targetLanguage];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Translate this message from ${src} to ${tgt} for a chat between friends.

This is NOT a formal translation. Translate the personality and vibe — not just the words.

SENDER: ${senderName}
THEIR STYLE: ${senderVibe || 'casual and friendly'}
${recentMessages ? `\nRECENT MESSAGES (tone context):\n${recentMessages}\n` : ''}
MESSAGE: "${text}"

Rules:
- Use natural, informal ${tgt} — how friends actually text, not a textbook
- Keep the energy: lowercase stays lowercase, caps stay caps, no punctuation = casual
- If it's funny or sarcastic, make it land the same way in ${tgt}
- Use ${tgt} slang — find the real equivalent, not the formal word
- Match the punctuation style (??? = confused energy, !!! = hype)

Reply with ONLY the translated message. Nothing else.`
      }]
    })
  });

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || text;
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const json = await res.json();
  if (!json.result) return null;
  try { return JSON.parse(json.result); } catch { return null; }
}

async function kvSet(key, value) {
  await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', 604800])
  });
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}
