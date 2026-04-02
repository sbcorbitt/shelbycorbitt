export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = ['shelbycorbitt.com', 'www.shelbycorbitt.com', 'localhost'];
  const isAllowed = allowed.some(d => origin.includes(d) || referer.includes(d));
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  try {
    // Fetch latest CNN live updates
    const newsRes = await fetch('https://www.cnn.com/2026/04/01/science/live-news/artemis-2-nasa-launch', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArtemisTracker/1.0)' }
    });
    const newsHtml = await newsRes.text();

    // Extract text content - grab paragraphs
    const paragraphs = newsHtml.match(/<p[^>]*>(.*?)<\/p>/gs) || [];
    const text = paragraphs
      .map(p => p.replace(/<[^>]+>/g, '').trim())
      .filter(p => p.length > 50 && p.length < 500)
      .slice(0, 15)
      .join(' ');

    // Mission math
    const launchTime = new Date('2026-04-01T22:35:00Z'); // 6:35pm EDT
    const now = new Date();
    const elapsedMs = now - launchTime;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    // Rough trajectory estimates based on published mission profile
    // Day 1: Earth orbit, TLI burn, ~200-5000 miles
    // Days 2-4: Translunar coast, reaching ~230,000 miles
    // Day 4-5: Lunar flyby at ~4,100 miles from Moon
    // Days 5-8: Return coast
    // Day 10: Splashdown
    let distFromEarth, distFromMoon, phase;
    const dayNum = Math.floor(elapsedHours / 24) + 1;

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
      phase = 'Post-flyby return coast';
    } else if (elapsedHours < 216) {
      const progress = (elapsedHours - 132) / 84;
      distFromEarth = Math.round(230000 - (progress * 228000));
      distFromMoon = Math.round(58600 + (progress * 180000));
      phase = 'Return coast toward Earth';
    } else {
      distFromEarth = Math.round(2000 - ((elapsedHours - 216) * 80));
      distFromMoon = 239000;
      phase = 'Final approach and reentry';
    }

    // Ask Claude to narrate
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are narrating NASA's Artemis II mission for a general audience — people who are curious but not space experts. The mission launched April 1, 2026 at 6:35pm EDT. It's a 10-day crewed lunar flyby with astronauts Reid Wiseman, Victor Glover, Christina Koch, and Jeremy Hansen aboard Orion (nicknamed Integrity).

Current mission status:
- Mission elapsed time: ${Math.floor(elapsedHours)} hours, ${Math.floor((elapsedHours % 1) * 60)} minutes
- Mission day: ${dayNum} of 10
- Current phase: ${phase}
- Estimated distance from Earth: ${distFromEarth.toLocaleString()} miles
- Estimated distance from Moon: ${distFromMoon.toLocaleString()} miles

Recent news snippets: ${text.slice(0, 800)}

Write a warm, excited, plain-English narration of what's happening right now. 3-4 sentences max. Make it feel alive — like you're texting a friend who just asked "what are they doing up there?" No jargon. No bullet points. Just a conversational paragraph that makes someone feel the wonder of this moment.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const narration = claudeData.content?.[0]?.text || 'Unable to generate narration.';

    res.status(200).json({
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
