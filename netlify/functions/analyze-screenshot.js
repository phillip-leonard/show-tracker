/**
 * analyze-screenshot — Claude reads a screenshot of a ticket site's past
 * events or order history and returns the shows in it.
 *
 * POST body:   { image, mediaType }   one image, JPEG/PNG/WebP/GIF, ≤4 MB
 * Auth header: Authorization: Bearer {idToken}  — required when
 *              REQUIRE_AUTH_AI=true; see lib/aiScan.js for the limits
 *              that apply with and without one.
 * Response:    200 { shows: [{ artist, venue, date, city }] }
 *              400/413 bad image · 401 sign in · 429 daily limit ·
 *              422 nothing readable · 502 couldn't reach the model
 */

const { handleScan, readScreenshotImage } = require('./lib/aiScan');
const { corsHeaders } = require('./lib/cors');

const PROMPT = `You are analyzing a screenshot of a ticket site or app (Ticketmaster, AXS, SeatGeek, StubHub, Live Nation, Eventbrite, DICE, Vivid Seats, See Tickets, a venue's own box office, or similar) showing a user's past events or order history.

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
- Order histories can list parking passes, upgrades, merch bundles and add-ons alongside tickets: skip those, and list each show once even if it has several orders
- If the screenshot shows no events or is not a ticket site screenshot, return an empty array []
- For festivals, use the festival name as the artist (e.g., "Bonnaroo 2023")
- Normalize artist names to their common/official form (e.g., "The Rolling Stones" not "ROLLING STONES")
- Dates must always be YYYY-MM-DD format regardless of how they appear in the screenshot`;

exports.handler = async function (event) {
  return handleScan(event, {
    headers: corsHeaders(event, { methods: 'POST, OPTIONS' }),
    readImages: readScreenshotImage,
    prompt: PROMPT,
    failMessage: 'Couldn\'t read that screenshot right now. Please try again in a few minutes.',
    noShowsMessage: 'No shows were found in this screenshot. Try one that shows your past events.',
  });
};
