export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = ['shelbycorbitt.com', 'www.shelbycorbitt.com', 'localhost'];
  const isAllowed = allowed.some(d => origin.includes(d) || referer.includes(d));
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  try {
    const launchTime = new Date('2026-04-01T22:35:00Z');
    const splashdownTime = new Date('2026-04-11T18:00:00Z'); // ~day 10
    const now = new Date();
    const elapsedMs = now - launchTime;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    // Mission complete state
    if (now >= splashdownTime) {
      return res.status(200).json({
        missionComplete: true,
        narration: "Artemis II is home. On April 11, 2026, Reid Wiseman, Victor Glover, Christina Koch, and Jeremy Hansen splashed down safely in the Pacific Ocean, completing humanity's first crewed lunar mission since 1972. What a ride."
      });
    }

    // Fetch NASA blog for context (public domain)
    let newsContext = '';
    try {
      const newsRes = await fetch('https://www.nasa.gov/blogs/missions/2026/04/01/live-artemis-ii-launch-day-updates/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArtemisTracker/1.0)' }
      });
      const html = await newsRes.text();
      const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gs) || [];
      newsContext = paragraphs
        .map(p => p.replace(/<[^>]+>/g, '').trim())
        .filter(p => p.length > 60 && p.length < 400)
        .slice(0, 10)
        .join(' ');
    } catch (e) {
      newsContext = '';
    }

    // Trajectory estimates from NASA published mission profile
    const dayNum = Math.floor(elapsedHours / 24) + 1;
    let distFromEarth, distFromMoon, phase;

    if (elapsedHours < 6) {
      distFromEarth = Math.round(200 + (elapsedHours * 800));
      distFromMoon = 239000;
      phase = 'Earth orbit and early translunar coast';
    } else if (elapsedHours < 96) {
      const progress = (elapsedHours - 6) / 90;
      distFromEarth = Math.round(5000 + (progress * 225000));
      distFromMoon = Math.round(239000 - (progress * 180000));
      phase = 'Translunar coast toward the Moon';
    } else if (elapsedHours < 108) {
      distFromEarth = Math.round(230000 + ((elapsedHours - 96) * 800));
      distFromMoon = Math.round(59000 - ((elapsedHours - 96) * 4500));
      phase = 'Approaching lunar flyby';
    } else if (elapsedHours < 120) {
      distFromEarth = Math.round(238000 + ((elapsedHours - 108) * 200));
      distFromMoon = Math.round(6600 - ((elapsedHours - 108) * 200));
      phase = 'Lunar flyby — closest approach to the Moon';
    } else if (elapsedHours < 132) {
      distFromEarth = Math.round(240200 - ((elapsedHours - 120) * 800));
      distFromMoon = Math.round(4100 + ((elapsedHours - 120) * 4500));
      phase = 'Post-flyby — maximum distance from Earth';
    } else if (elapsedHours < 216) {
      const progress = (elapsedHours - 132) / 84;
      distFromEarth = Math.round(230000 - (progress * 228000));
      distFromMoon = Math.round(58600 + (progress * 180000));
      phase = 'Return coast toward Earth';
    } else {
      distFromEarth = Math.round(Math.max(100, 2000 - ((elapsedHours - 216) * 80)));
      distFromMoon = 239000;
      phase = 'Final approach and reentry';
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `You are narrating NASA's Artemis II mission for a general audience. The mission launched April 1, 2026 at 6:35pm EDT. It's a 10-day crewed lunar flyby with astronauts Reid Wiseman, Victor Glover, Christina Koch, and Jeremy Hansen aboard Orion (nicknamed Integrity).

Mission status right now:
- Elapsed time: ${Math.floor(elapsedHours)} hours ${Math.floor((elapsedHours % 1) * 60)} minutes
- Day ${dayNum} of 10
- Phase: ${phase}
- ~${distFromEarth.toLocaleString()} miles from Earth
- ~${distFromMoon.toLocaleString()} miles from the Moon
${newsContext ? `\nRecent NASA context: ${newsContext.slice(0, 600)}` : ''}

Write 2-3 warm, conversational sentences about what's happening right now — like texting a curious friend. No jargon, no bullet points. Make them feel the wonder of this moment.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const narration = claudeData.content?.[0]?.text || 'Unable to generate narration right now.';

    res.status(200).json({
      missionComplete: false,
      narration,
      elapsedHours: Math.floor(elapsedHours),
      elapsedMinutes: Math.floor((elapsedHours % 1) * 60),
      dayNum,
      distFromEarth,
      distFromMoon,
      phase
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
