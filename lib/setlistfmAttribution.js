// lib/setlistfmAttribution.js
//
// The link back to setlist.fm that its API terms require wherever its data
// is shown: "Source: {Band} setlist on setlist.fm", pointing at the `url`
// setlist.fm returns for that setlist, followable (no rel="nofollow"), and
// at https://www.setlist.fm/ when there is no url to use.
//
// A show imported from 5.47.5 on stores that url as `setlistfmUrl` (a
// reference, like `setlistfmId`). Older shows only have the id, so
// useSetlistfmLink asks netlify/functions/setlistfm-links.js, which reads
// setlist.fm through the shared 24-hour cache. Requests made in the same
// moment (a page of show cards) are batched into one call, and each id is
// asked for once per session.

import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

export const SETLISTFM_HOME = 'https://www.setlist.fm/';

// Matches setlistfm-links.js: at most 20 ids per request.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 50;

/**
 * True when this show's setlist came from setlist.fm: it has a setlist.fm id
 * and no band source. An absent `setlistSource` means setlist.fm (shows
 * logged before 5.33.0 have none).
 */
export function isSetlistfmShow(show) {
  if (!show?.setlistfmId) return false;
  return !show.setlistSource || show.setlistSource === 'setlistfm';
}

/** The url to link before (or without) asking setlist.fm. */
export function initialSetlistfmUrl(show) {
  const stored = show?.setlistfmUrl || show?.url;
  return typeof stored === 'string' && /^https:\/\/(www\.)?setlist\.fm\//.test(stored) ? stored : SETLISTFM_HOME;
}

// id -> { url, artist } once known; id -> Promise while in flight.
const known = new Map();
const inFlight = new Map();
let queue = [];
let timer = null;

async function flush() {
  timer = null;
  const ids = queue;
  queue = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    let links = {};
    try {
      const res = await fetch(apiUrl(`/.netlify/functions/setlistfm-links?ids=${batch.map(encodeURIComponent).join(',')}`));
      if (res.ok) links = (await res.json()).links || {};
    } catch {
      // Offline or setlist.fm unreachable: the home-page link stands.
    }
    for (const id of batch) {
      const link = links[id] || null;
      // Only a real answer is remembered; a miss is asked again next session.
      if (link) known.set(id, link);
      inFlight.get(id)?.resolve(link);
      inFlight.delete(id);
    }
  }
}

/** The setlist.fm link for one setlist id: { url, artist } or null. */
export function fetchSetlistfmLink(id) {
  if (!id) return Promise.resolve(null);
  if (known.has(id)) return Promise.resolve(known.get(id));
  if (inFlight.has(id)) return inFlight.get(id).promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  inFlight.set(id, { promise, resolve });
  queue.push(id);
  if (!timer) timer = setTimeout(flush, BATCH_DELAY_MS);
  return promise;
}

/**
 * { url, band } for a setlist.fm show's attribution link. Starts with the
 * stored url (or setlist.fm's home page) and swaps in the setlist's own url
 * once setlist.fm answers. Does nothing for a show not from setlist.fm.
 */
export function useSetlistfmLink(show) {
  const enabled = isSetlistfmShow(show);
  const id = enabled ? String(show.setlistfmId) : '';
  const startUrl = initialSetlistfmUrl(show);
  const [link, setLink] = useState(() => ({ url: startUrl, band: show?.artist || '' }));

  useEffect(() => {
    setLink({ url: startUrl, band: show?.artist || '' });
    if (!id || startUrl !== SETLISTFM_HOME) return undefined;
    let cancelled = false;
    fetchSetlistfmLink(id).then((found) => {
      if (!cancelled && found?.url) setLink({ url: found.url, band: show?.artist || found.artist || '' });
    });
    return () => { cancelled = true; };
  }, [id, startUrl, show?.artist]);

  return { enabled, ...link };
}
