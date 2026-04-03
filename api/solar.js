export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = ['shelbycorbitt.com', 'www.shelbycorbitt.com', 'localhost'];
  const isAllowed = allowed.some(d => origin.includes(d) || referer.includes(d));
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  try {
    const NASA_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const [flareRes, cmeRes] = await Promise.all([
      fetch(`https://api.nasa.gov/DONKI/FLR?startDate=${yesterday}&endDate=${today}&api_key=${NASA_KEY}`),
      fetch(`https://api.nasa.gov/DONKI/CME?startDate=${yesterday}&endDate=${today}&api_key=${NASA_KEY}`)
    ]);
    const flares = await flareRes.json();
    const cmes = await cmeRes.json();

    const classScore = { 'A': 1, 'B': 2, 'C': 3, 'M': 4, 'X': 5 };
    let peakScore = 0;
    let peakClass = 'none';

    if (Array.isArray(flares) && flares.length > 0) {
      flares.forEach(f => {
        const cls = (f.classType || '').charAt(0).toUpperCase();
        const score = classScore[cls] || 0;
        if (score > peakScore) { peakScore = score; peakClass = f.classType || cls; }
      });
    }

    const flareCount = Array.isArray(flares) ? flares.length : 0;
    const cmeCount = Array.isArray(cmes) ? cmes.length : 0;
    const level = peakScore === 0 ? 1 : peakScore <= 2 ? 2 : peakScore === 3 ? 3 : peakScore === 4 ? 4 : 5;

    const levelLabels = ['','Unbothered','Mildly Irritated','Having a Moment','Genuinely Upset','Absolutely Feral'];
    const levelDescs = ['','The sun is calm. Almost suspiciously so.','Minor activity detected. The sun is aware of you.','Moderate flares. The sun is expressing itself.','Significant flare activity. The sun has opinions.','Extreme solar activity. The sun has lost the plot entirely.'];

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Write a 2-sentence deadpan solar weather report. Rules: no emojis, no exclamation points, dry scientific understatement, treat the sun like a mildly unpredictable coworker.

Today's data:
- Solar flares detected: ${flareCount}
- Peak flare class: ${peakClass === 'none' ? 'none' : peakClass}
- Coronal mass ejections: ${cmeCount}
- Mood level: ${levelLabels[level]} (${level}/5)

Return only the 2-sentence summary, nothing else.`
        }]
      })
    });
    const claudeData = await claudeRes.json();
    const summary = claudeData.content?.[0]?.text?.trim() || 'Solar data unavailable. The sun is not commenting at this time.';

    res.status(200).json({ level, label: levelLabels[level], description: levelDescs[level], summary, flareCount, cmeCount, peakClass, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
