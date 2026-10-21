// netlify/functions/lib/publicRouteParams.js
//
// Pulls the handle / show id / collection id for the public page functions
// out of the request path.
//
// WHY. The netlify.toml rewrites used to pass these as query placeholders
// (`to = "/.netlify/functions/public-profile?handle=:handle"`). Netlify
// does not substitute placeholders into the `to` query string for a
// function, so every /u/ and /shared/ page arrived with no handle and
// 404'd ("No profile handle given"), while the same function called
// directly with ?handle= worked. The sitemap was pointing Google at those
// 404s from 5.6.0 until 5.44.4.
//
// The rewrites now put the values in the PATH of the function URL
// (`/.netlify/functions/public-profile/:handle`), which Netlify does
// substitute. Depending on how the function is reached, event.path is
// either that function path or the original /u/... path, so both shapes
// are matched, against event.path and then event.rawUrl. Query parameters
// still work as a last resort, so the functions can be called directly.

function candidatePaths(event) {
  const paths = [];
  if (event.path) paths.push(event.path);
  if (event.rawUrl) {
    try {
      paths.push(new URL(event.rawUrl).pathname);
    } catch {
      // Malformed rawUrl: event.path and the query are still tried.
    }
  }
  return paths;
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchFirst(event, patterns) {
  for (const path of candidatePaths(event)) {
    for (const re of patterns) {
      const m = path.match(re);
      if (m) return m.slice(1).map(safeDecode);
    }
  }
  return null;
}

const query = (event, key) => event.queryStringParameters?.[key] || '';

/** /u/:handle → { handle } (lowercased, trimmed) */
function profileParams(event) {
  const m = matchFirst(event, [
    /^\/\.netlify\/functions\/public-profile\/([^/]+)\/?$/,
    /^\/u\/([^/]+)\/?$/,
  ]);
  const handle = m ? m[0] : query(event, 'handle');
  return { handle: handle.toLowerCase().trim() };
}

/** /u/:handle/shows/:showId → { handle, showId } */
function showParams(event) {
  const m = matchFirst(event, [
    /^\/\.netlify\/functions\/public-show\/([^/]+)\/([^/]+)\/?$/,
    /^\/u\/([^/]+)\/shows\/([^/]+)\/?$/,
  ]);
  const [handle, showId] = m || [query(event, 'handle'), query(event, 'showId')];
  return { handle: handle.toLowerCase().trim(), showId };
}

/** /shared/:id → { id } */
function sharedParams(event) {
  const m = matchFirst(event, [
    /^\/\.netlify\/functions\/public-shared\/([^/]+)\/?$/,
    /^\/shared\/([^/]+)\/?$/,
  ]);
  return { id: m ? m[0] : query(event, 'id') };
}

module.exports = { profileParams, showParams, sharedParams };
