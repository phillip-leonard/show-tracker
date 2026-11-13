/**
 * analyze-tickets — Claude reads photos of ticket stubs, wristbands or
 * mobile tickets and returns the shows on them.
 *
 * POST body:   { images: [{ base64, mediaType }] }   1–10 images, JPEG/PNG/WebP/GIF, ≤4 MB each
 * Auth header: Authorization: Bearer {idToken}  — required when
 *              REQUIRE_AUTH_AI=true; see lib/aiScan.js for the limits
 *              that apply with and without one.
 * Response:    200 { shows: [{ artist, venue, date, city }] }
 *              400/413 bad image · 401 sign in · 429 daily limit ·
 *              422 nothing readable · 502 couldn't reach the model
 */

const { handleScan, readTicketImages } = require('./lib/aiScan');
const { corsHeaders } = require('./lib/cors');

const PROMPT = `You are analyzing photos of physical concert ticket stubs, wristbands, laminates, or digital ticket screenshots.

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

exports.handler = async function (event) {
  return handleScan(event, {
    headers: corsHeaders(event, { methods: 'POST, OPTIONS' }),
    readImages: readTicketImages,
    prompt: PROMPT,
    failMessage: 'Couldn\'t read your tickets right now. Please try again in a few minutes.',
    noShowsMessage: 'No shows detected in the ticket images. Try different or clearer images.',
  });
};
