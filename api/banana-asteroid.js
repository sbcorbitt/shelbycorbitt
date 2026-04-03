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

    const neoRes = await fetch(
      `https://api.nasa.gov/neo/rest/v1/feed?start_date=${today}&end_date=${today}&api_key=${NASA_KEY}`
    );
    const neoData = await neoRes.json();
    const allAsteroids = Object.values(neoData.near_earth_objects || {}).flat();

    if (!allAsteroids.length) {
      return res.status(200).json({ asteroids: [], date: today });
    }

    const scored = allAsteroids.map(a => {
      const approach = a.close_approach_data?.[0];
      const distKm = parseFloat(approach?.miss_distance?.kilometers || '999999999');
      const diamMax = a.estimated_diameter?.meters?.estimated_diameter_max || 0;
      const velocity = parseFloat(approach?.relative_velocity?.kilometers_per_second || '0');
      const score = (1 / (distKm / 1000000)) * 40 + (diamMax / 1000) * 40 + velocity * 20;
      return { raw: a, score, distKm, diamMax, velocity };
    });

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);

    const asteroids = top3.map(({ raw, distKm, diamMax, velocity }) => {
      const approach = raw.close_approach_data?.[0];
      const diamMin = raw.estimated_diameter?.meters?.estimated_diameter_min || 0;
      const avgDiam = (diamMin + diamMax) / 2;
      const bananas = Math.round(avgDiam / 0.18);
      const discoveryYear = raw.name.match(/\d{4}/)?.[0] || '';
      return {
        name: raw.name.replace(/[()]/g, '').trim(),
        discovery_year: discoveryYear,
        diameter_m: Math.round(avgDiam),
        bananas,
        distance_km: Math.round(distKm),
        distance_moon: parseFloat((distKm / 384400).toFixed(2)),
        velocity_kms: parseFloat(velocity.toFixed(1)),
        approach_date: approach?.close_approach_date_full || today,
        hazardous: raw.is_potentially_hazardous_asteroid
      };
    });

    const summaryPrompt = asteroids.map((a, i) =>
      `Asteroid ${i + 1}: ${a.name}
Diameter: ${a.diameter_m}m (${a.bananas.toLocaleString()} bananas end to end)
Distance: ${a.distance_km.toLocaleString()} km (${a.distance_moon} lunar distances)
Velocity: ${a.velocity_kms} km/s
Hazardous: ${a.hazardous ? 'Yes' : 'No'}`
    ).join('\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are writing content for "Banana Asteroid" — a deadpan daily asteroid tracker where everything is measured in bananas.

For each of the 3 asteroids below, provide:
1. A ridiculous banana-themed nickname (e.g. "The Big Peel", "Slightly Concerning Fruit", "Banana Hammock 9000") — funny but not try-hard
2. A 2-3 sentence deadpan scientific summary. Rules: no emojis, no exclamation points, understatement as humor, treat bananas as a legitimate scientific unit, tone like a bored scientist filing routine paperwork

${summaryPrompt}

Return ONLY valid JSON, no markdown:
[
  {"nickname": "...", "summary": "..."},
  {"nickname": "...", "summary": "..."},
  {"nickname": "...", "summary": "..."}
]`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text?.trim() || '[]';
    const generated = JSON.parse(raw);
    asteroids.forEach((a, i) => {
      a.nickname = generated[i]?.nickname || 'The Unnamed One';
      a.summary = generated[i]?.summary || 'Summary unavailable.';
    });

    res.status(200).json({ asteroids, date: today });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
