const ALLOWED_ORIGINS = new Set([
  'https://shelbycorbitt.com',
  'https://www.shelbycorbitt.com',
]);

function isAllowedOrigin(origin, referer) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (origin.includes('localhost') || referer.includes('localhost')) return true;
  try { return ALLOWED_ORIGINS.has(new URL(referer).origin); } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (!isAllowedOrigin(origin, referer)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const KV_URL = process.env.vibecheck_KV_REST_API_URL;
  const KV_TOKEN = process.env.vibecheck_KV_REST_API_TOKEN;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const allowed = await checkRateLimit(ip, 'prompt', KV_URL, KV_TOKEN, 10, 60);
  if (!allowed) return res.status(429).json({ error: 'Too many requests.' });

  const { scenario } = req.body;
  if (!scenario) return res.status(400).json({ error: 'No scenario provided' });
  if (typeof scenario !== 'string' || scenario.length > 4000) {
    return res.status(400).json({ error: 'Invalid scenario.' });
  }

  let messages, system;

  try {
    const parsed = JSON.parse(scenario);
    if (parsed.type === 'agent_response') {
      if (typeof parsed.system === 'string') {
        system = parsed.system.slice(0, 3000);
      }
      if (typeof parsed.user === 'string') {
        messages = [{ role: 'user', content: parsed.user.slice(0, 2000) }];
      }
    }
  } catch (e) {
    messages = [{ role: 'user', content: scenario }];
  }

  if (!messages) return res.status(400).json({ error: 'Invalid request.' });

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages
  };
  if (system) body.system = system;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

async function checkRateLimit(ip, endpoint, url, token, limit, windowSec) {
  if (!url || !token) return true;
  try {
    const key = `rl:${endpoint}:${ip}`;
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['SET', key, '0', 'NX', 'EX', String(windowSec)],
        ['INCR', key]
      ])
    });
    const data = await res.json();
    const count = data[1]?.result ?? 0;
    return count <= limit;
  } catch {
    return true;
  }
}
