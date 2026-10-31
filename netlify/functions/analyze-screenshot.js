const https = require('https');

exports.handler = async function(event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Set it in Netlify Site settings > Environment variables.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const { image, mediaType } = body;

  if (!image || !mediaType) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'image (base64) and mediaType are required' })
    };
  }

  const prompt = `You are analyzing a screenshot of a ticket platform (Ticketmaster, AXS, StubHub, Live Nation, Eventbrite, or similar) showing a user's past concert/event history.

Extract every concert/show/event visible in the screenshot. For each show, provide:
- artist: The performing artist or band name (the headliner, not the opener)
- venue: The venue name
- date: The date in YYYY-MM-DD format
- city: The city where the venue is located

Return ONLY a JSON array with no additional text, markdown, or explanation. Example format:
[
  {"artist": "Radiohead", "venue": "Madison Square Garden", "date": "2023-07-15", "city": "New York"},
  {"artist": "Foo Fighters", "venue": "The Forum", "date": "2023-08-20", "city": "Los Angeles"}
]

Important rules:
- If a date is partially visible or ambiguous, make your best guess and include it
- If you cannot determine a field, use an empty string "" for that field
- Do NOT include non-concert events (sports, comedy specials, theater, etc.) unless they are clearly musical performances
- If the screenshot shows no events or is not a ticket platform screenshot, return an empty array []
- For festivals, use the festival name as the artist (e.g., "Bonnaroo 2023")
- Normalize artist names to their common/official form (e.g., "The Rolling Stones" not "ROLLING STONES")
- Dates must always be YYYY-MM-DD format regardless of how they appear in the screenshot`;

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-5-5',
    // Thinking counts toward max_tokens, and this model thinks by default.
    max_tokens: 16000,
    // Plain extraction, and this function has to answer inside Netlify's
    // synchronous limit. The model's default effort is high.
    output_config: { effort: 'low' },
    fallbacks: 'default',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: image,
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ]
  });

  return new Promise((resolve) => {
    const options = {
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
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          if (res.statusCode !== 200) {
            console.error('Anthropic API error', res.statusCode, data);
            resolve({
              statusCode: res.statusCode,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: 'Couldn\'t read that screenshot right now. Please try again in a few minutes.', details: parsed })
            });
            return;
          }

          // Extract text content from Claude's response
          const textContent = parsed.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('');

          // Parse the JSON array from Claude's response
          const jsonMatch = textContent.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            resolve({
              statusCode: 422,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: 'Could not extract show data from screenshot', raw: textContent })
            });
            return;
          }

          let shows;
          try {
            shows = JSON.parse(jsonMatch[0]);
          } catch (parseErr) {
            resolve({
              statusCode: 422,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: 'Failed to parse show data JSON', raw: jsonMatch[0] })
            });
            return;
          }

          if (!Array.isArray(shows)) {
            shows = [];
          }
          resolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ shows })
          });
        } catch (error) {
          resolve({
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Failed to parse response', details: error.message })
          });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request to Anthropic failed', error.message);
      resolve({
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Couldn\'t read that screenshot right now. Please try again in a few minutes.', details: error.message })
      });
    });

    req.write(requestBody);
    req.end();
  });
};
