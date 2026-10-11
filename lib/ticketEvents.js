// lib/ticketEvents.js
//
// An artist's upcoming dates from Ticketmaster and SeatGeek, merged into one
// list (mergeTicketEvents in lib/utils.js). Shared by the per-artist
// "Upcoming Shows" panel (components/UpcomingShows.jsx) and the "Add an
// upcoming show" search (components/upcoming/UpcomingShowForm.jsx), so both
// read and fill the same `ticketCache` documents.
//
// Moved here unchanged from UpcomingShows.jsx in 5.43.0.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { mergeTicketEvents } from '@/lib/utils';
import { TICKET_CACHE_TTL } from '@/lib/constants';
import { apiUrl } from '@/lib/api';

function artistSlug(artistName) {
  return artistName.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// Ticketmaster fetch — supports Attraction ID caching for exact artist matching.
// On first call the Netlify function resolves and returns the Attraction ID;
// subsequent calls pass it directly, skipping the TM attractions lookup entirely.
async function fetchTmWithCache(artistName, cacheKey) {
  let cachedAttractionId = null;
  try {
    const cacheDoc = await getDoc(doc(db, 'ticketCache', cacheKey));
    if (cacheDoc.exists()) {
      const cached = cacheDoc.data();
      // Preserve the attraction ID even when the event cache has expired
      cachedAttractionId = cached.tmAttractionId || null;
      const cachedAt = cached.cachedAt && cached.cachedAt.toMillis ? cached.cachedAt.toMillis() : 0;
      if (Date.now() - cachedAt < TICKET_CACHE_TTL) {
        return cached.data || [];
      }
    }
  } catch (_) { /* cache miss — continue */ }

  try {
    let url = apiUrl(`/.netlify/functions/ticketmaster-events?artistName=${encodeURIComponent(artistName)}`);
    // Pass the cached attraction ID so the function skips the attractions lookup
    if (cachedAttractionId) url += `&attractionId=${encodeURIComponent(cachedAttractionId)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const evts = json.events || [];
    const returnedAttractionId = json.attractionId || cachedAttractionId || null;
    try {
      const cacheData = { data: evts, cachedAt: serverTimestamp() };
      if (returnedAttractionId) cacheData.tmAttractionId = returnedAttractionId;
      await setDoc(doc(db, 'ticketCache', cacheKey), cacheData);
    } catch (_) { /* cache write failed — non-fatal */ }
    return evts;
  } catch (_) {
    return [];
  }
}

// SeatGeek fetch — simple cache wrapper (server-side exact filter handles matching)
async function fetchSgWithCache(artistName, cacheKey) {
  try {
    const cacheDoc = await getDoc(doc(db, 'ticketCache', cacheKey));
    if (cacheDoc.exists()) {
      const cached = cacheDoc.data();
      const cachedAt = cached.cachedAt && cached.cachedAt.toMillis ? cached.cachedAt.toMillis() : 0;
      if (Date.now() - cachedAt < TICKET_CACHE_TTL) {
        return cached.data || [];
      }
    }
  } catch (_) { /* cache miss — continue */ }

  try {
    const res = await fetch(apiUrl(`/.netlify/functions/seatgeek-events?artistName=${encodeURIComponent(artistName)}`));
    if (!res.ok) return [];
    const json = await res.json();
    const evts = json.events || [];
    try {
      await setDoc(doc(db, 'ticketCache', cacheKey), { data: evts, cachedAt: serverTimestamp() });
    } catch (_) { /* cache write failed — non-fatal */ }
    return evts;
  } catch (_) {
    return [];
  }
}

/**
 * Upcoming events for one artist, Ticketmaster and SeatGeek merged and
 * de-duplicated. Never throws: a provider that fails contributes nothing.
 */
export async function fetchArtistEvents(artistName) {
  if (!artistName) return [];
  const slug = artistSlug(artistName);
  const [tmEvents, sgEvents] = await Promise.all([
    fetchTmWithCache(artistName, `tm_${slug}`),
    fetchSgWithCache(artistName, `sg_${slug}`),
  ]);
  return mergeTicketEvents(tmEvents, sgEvents);
}
