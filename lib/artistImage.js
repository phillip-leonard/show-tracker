// lib/artistImage.js
//
// Client-side helper to fetch an artist photo URL via the artist-image Netlify function.
// Returns a string URL or null if unavailable.
//
// The URL goes through apiUrl(): on iOS the page's origin is
// capacitor://localhost, so a relative /.netlify/functions path never
// reached Netlify and artist images didn't load in the app (B-01, 5.59.8).

import { apiUrl } from '@/lib/api';

export async function fetchArtistImage(artistName) {
  if (!artistName?.trim()) return null;
  try {
    const res = await fetch(
      apiUrl(`/.netlify/functions/artist-image?artist=${encodeURIComponent(artistName.trim())}`),
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.imageUrl || null;
  } catch {
    return null;
  }
}
