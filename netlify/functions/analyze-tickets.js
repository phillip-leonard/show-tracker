const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Set it in Netlify Site settings > Environment variables.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { images } = body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'images array is required (each with base64 and mediaType)' }) };
  }

  const prompt = `You are analyzing photos of physical concert ticket stubs, wristbands, laminates, or digital ticket screenshots.

Extract the concert/show information from each ticket image. For each ticket, provide:
- artist: The performing artist or band name (the headliner)
- venue: The venue name
- date: The date in YYYY-MM-DD format
- city: The city where the venue is located

Return ONLY a JSON array with no additional text, markdown, or explanation. Example format:
[
  {"artist": "Radiohead", "venue": "Madison Square Garden", "date": "2023-07-15", "city": "New York"},
  {"artist": "Foo Fighters", "venue": "The Forum", "date": "2023-08-20", "city": "Los Angeles"}
]

Important rules:
- Ticket stubs may be old, worn, or partially damaged — extract whatever info is legible
- If a date is partially visible or ambiguous, make your best guess
- If you cannot determine a field, use an empty string ""
- Look for artist names, venue names, dates, and cities in all parts of the ticket (front, back, edges)
- For festivals, use the festival name as the artist (e.g., "Bonnaroo 2023")
- Normalize artist names to their common/official form
- Dates must always be YYYY-MM-DD format regardless of how they appear on the ticket
- If multiple tickets are shown in a single image, extract data for each one separately
- Handle both physical paper tickets and digital/mobile ticket screenshots`;

  // Build content array with all images + prompt
  const content = [];
  for (const img of images) {
    if (img.base64 && img.mediaType) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        }
      });
    }
  }
  content.push({ type: 'text', text: prompt });

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-5-5',
    // Thinking counts toward max_tokens, and this model thinks by default.
    max_tokens: 16000,
    // Plain extraction, and this function has to answer inside Netlify's
    // synchronous limit. The model's default effort is high.
    output_config: { effort: 'low' },
    fallbacks: 'default',
    messages: [{ role: 'user', content }]
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          if (res.statusCode !== 200) {
            console.error('Anthropic API error', res.statusCode, data);
            resolve({ statusCode: res.statusCode, headers, body: JSON.stringify({ error: 'Couldn\'t read your tickets right now. Please try again in a few minutes.', details: parsed }) });
            return;
          }

          const textContent = parsed.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('');

          const jsonMatch = textContent.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            resolve({ statusCode: 422, headers, body: JSON.stringify({ error: 'Could not extract show data from ticket images', raw: textContent }) });
            return;
          }

          let shows;
          try {
            shows = JSON.parse(jsonMatch[0]);
          } catch (parseErr) {
            resolve({ statusCode: 422, headers, body: JSON.stringify({ error: 'Failed to parse show data JSON', raw: jsonMatch[0] }) });
            return;
          }

          if (!Array.isArray(shows)) shows = [];
          resolve({ statusCode: 200, headers, body: JSON.stringify({ shows }) });
        } catch (error) {
          resolve({ statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to parse response', details: error.message }) });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request to Anthropic failed', error.message);
      resolve({ statusCode: 500, headers, body: JSON.stringify({ error: 'Couldn\'t read your tickets right now. Please try again in a few minutes.', details: error.message }) });
    });

    req.write(requestBody);
    req.end();
  });
};
