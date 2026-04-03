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

    // Fetch NEO data from NASA
    const neoRes = await fetch(
      `https://api.nasa.gov/neo/rest/v1/feed?start_date=${today}&end_date=${today}&api_key=${NASA_KEY}`
    );
    const neoData = await neoRes.json();

    const allAsteroids = Object.values(neoData.near_earth_objects || {}).flat();

    if (!allAsteroids.length) {
      return res.status(200).json({ asteroids: [], date: today });
    }

    // Score each asteroid for interestingness
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

    // Format asteroid data
    const asteroids = top3.map(({ raw, distKm, diamMax, velocity }) => {
      const approach = raw.close_approach_data?.[0];
      const diamMin = raw.estimated_diameter?.meters?.estimated_diameter_min || 0;
      const avgDiam = (diamMin + diamMax) / 2;
      const bananas = Math.round(avgDiam / 0.18); // avg banana ~18cm
      const approachDate = approach?.close_approach_date_full || today;
      return {
        name: raw.name.replace(/[()]/g, '').trim(),
        id: raw.id,
        diameter_m: Math.round(avgDiam),
        bananas,
        distance_km: Math.round(distKm),
        distance_moon: parseFloat((distKm / 384400).toFixed(2)),
        velocity_kms: parseFloat(velocity.toFixed(1)),
        approach_date: approachDate,
        hazardous: raw.is_potentially_hazardous_asteroid,
        nasa_url: raw.nasa_jpl_url
      };
    });

    // Generate deadpan summaries with Claude
    const summaryPrompt = asteroids.map((a, i) =>
      `Asteroid ${i + 1}: ${a.name}
Diameter: ${a.diameter_m}m (${a.bananas.toLocaleString()} bananas)
Distance: ${a.distance_km.toLocaleString()} km (${a.distance_moon} lunar distances)
Velocity: ${a.velocity_kms} km/s
Potentially hazardous: ${a.hazardous ? 'Yes' : 'No'}`
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
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Write deadpan scientific summaries for 3 near-Earth asteroids. Rules:
- No emojis
- No exclamation points
- Understatement as humor
- Facts first, then dry commentary
- Use banana as a legitimate unit of measurement where natural
- 2-3 sentences each
- Tone: like a bored scientist filing a routine report

${summaryPrompt}

Return ONLY a JSON array of 3 strings, one per asteroid, no markdown:
["summary1","summary2","summary3"]`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const summaryText = claudeData.content?.[0]?.text?.trim() || '["No summary available.","No summary available.","No summary available."]';
    const summaries = JSON.parse(summaryText);

    asteroids.forEach((a, i) => { a.summary = summaries[i] || 'Summary unavailable.'; });

    res.status(200).json({ asteroids, date: today });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
