// netlify/functions/lib/publicRouteParams.js
//
// Reads the handle / showId / shared-collection id / artist and song slug
// for the public page functions from the request PATH, not the query string.
//
// Why: netlify.toml used to rewrite /u/:handle to
// /.netlify/functions/public-profile?handle=:handle, and the placeholder in
// that query string never reached the function. queryStringParameters held
// only the visitor's own query (?page=2), so every /u/, /u/.../shows/... and
// /shared/ URL answered 404 "No profile handle given." from v5.6.0 onwards,
// while the same function called directly with ?handle= worked.
//
// The rewrites now put the values in the path
// (/.netlify/functions/public-profile/:handle), and this module accepts
// either spelling of the path — the public URL (/u/phillip/) or the function
// URL (/.netlify/functions/public-profile/phillip) — from event.path or
// event.rawUrl, so it works whichever of the two Netlify hands over. An
// explicit query parameter still wins, so a direct call with ?handle= keeps
// working.

const ROUTES = {
  profile: [
    /^\/u\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-profile\/([^/]+)\/?$/,
  ],
  show: [
    /^\/u\/([^/]+)\/shows\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-show\/([^/]+)\/([^/]+)\/?$/,
  ],
  shared: [
    /^\/shared\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-shared\/([^/]+)\/?$/,
  ],
  artist: [
    /^\/artist\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-artist\/([^/]+)\/?$/,
  ],
  song: [
    /^\/artist\/([^/]+)\/song\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-artist-song\/([^/]+)\/([^/]+)\/?$/,
  ],
  heard: [
    /^\/heard\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-heard\/([^/]+)\/?$/,
  ],
  heardShare: [
    /^\/heard\/([^/]+)\/r\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-heard\/([^/]+)\/r\/([^/]+)\/?$/,
  ],
  heardImage: [
    /^\/heard\/([^/]+)\/r\/([^/]+)\/(og|poster-feed|poster-story)\.png$/,
    /^\/\.netlify\/functions\/public-heard-image\/([^/]+)\/([^/]+)\/(og|poster-feed|poster-story)\/?$/,
  ],
  poster: [
    /^\/p\/([^/]+)\/?$/,
    /^\/\.netlify\/functions\/public-poster\/([^/]+)\/?$/,
  ],
  posterImage: [
    /^\/p\/([^/]+)\/(og|poster-feed|poster-story)\.png$/,
    /^\/\.netlify\/functions\/public-poster\/([^/]+)\/(og|poster-feed|poster-story)\/?$/,
  ],
};

const NAMES = {
  profile: ['handle'],
  show: ['handle', 'showId'],
  shared: ['id'],
  artist: ['slug'],
  song: ['slug', 'song'],
  heard: ['slug'],
  heardShare: ['slug', 'code'],
  heardImage: ['slug', 'code', 'image'],
  poster: ['code'],
  posterImage: ['code', 'image'],
};

function candidatePaths(event) {
  const paths = [];
  if (event?.path) paths.push(event.path);
  if (event?.rawUrl) {
    try {
      paths.push(new URL(event.rawUrl).pathname);
    } catch {
      // Not a URL; event.path is all there is.
    }
  }
  return paths;
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

/**
 * @param {object} event  the Netlify function event
 * @param {'profile'|'show'|'shared'|'artist'|'song'|'heard'|'heardShare'|'heardImage'|'poster'|'posterImage'} kind
 * @returns {object} e.g. { handle: 'phillip' } — a missing value is ''
 */
function routeParams(event, kind) {
  const names = NAMES[kind];
  const query = event?.queryStringParameters || {};
  const fromPath = {};

  for (const path of candidatePaths(event)) {
    const match = ROUTES[kind].map(re => path.match(re)).find(Boolean);
    if (match) {
      names.forEach((name, i) => { fromPath[name] = safeDecode(match[i + 1]); });
      break;
    }
  }

  const params = {};
  for (const name of names) params[name] = query[name] || fromPath[name] || '';
  return params;
}

module.exports = { routeParams };
