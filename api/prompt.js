export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { scenario } = req.body;
  if (!scenario) return res.status(400).json({ error: 'No scenario provided' });

  let messages, system;

  // Check if this is an agent response call (has type field in JSON)
  try {
    const parsed = JSON.parse(scenario);
    if (parsed.type === 'agent_response') {
      system = parsed.system;
      messages = [{ role: 'user', content: parsed.user }];
    }
  } catch (e) {
    // Not JSON, treat as a plain prompt generation request
    messages = [{ role: 'user', content: scenario }];
  }

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages
  };
  if (system) body.system = system;

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
}
