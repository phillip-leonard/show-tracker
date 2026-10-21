// netlify/functions/lib/setlistfmKey.js
//
// The one place the setlist.fm API key is read.
//
// Until 5.44.5, eleven functions read it as
// `process.env.SETLISTFM_API_KEY || '<a live key>'`, which put a working
// key in a public repository and in every function bundle. There is no
// fallback now: with SETLISTFM_API_KEY unset, every function that needs it
// logs an error and returns a 500 saying so, rather than quietly running
// on a key nobody controls. (The old key is still in git history; rotating
// it at setlist.fm is what retires it.)
//
// Usage, first thing in a handler:
//
//   const missingKey = missingSetlistfmKey();
//   if (missingKey) return missingKey;
//   ...
//   headers: { 'x-api-key': setlistfmKey() }

/** The key, or '' when unset. */
function setlistfmKey() {
  return process.env.SETLISTFM_API_KEY || '';
}

/**
 * A 500 response to return when the key is missing, or null when it is
 * set. Logs the error every time, so it shows in the function log for each
 * failed request, not only on cold start.
 */
function missingSetlistfmKey() {
  if (setlistfmKey()) return null;
  console.error('SETLISTFM_API_KEY is not set. setlist.fm requests are disabled until it is added to the Netlify environment.');
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'Server misconfigured: SETLISTFM_API_KEY is not set' }),
  };
}

module.exports = { setlistfmKey, missingSetlistfmKey };
