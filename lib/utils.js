/**
 * Shared utility functions — extracted from App.js
 * Pure functions with no React dependencies.
 */

// Show dates: every rule lives in lib/showDate.js (5.59.10). These names
// stay here because ~60 files import them from lib/utils.
export { formatDate, parseDate, toIsoDate, parseImportDate } from '@/lib/showDate';
export { today as localIsoDate } from '@/lib/showDate';
import { normalizeVenueName, venuesFuzzyMatch } from '@/lib/showIdentity';

export function artistColor(name) {
  return '#f59e0b'; // Tailwind amber-500
}

export function avgSongRating(setlist) {
  const rated = setlist.filter(s => s.rating);
  if (rated.length === 0) return null;
  return (rated.reduce((a, s) => a + s.rating, 0) / rated.length).toFixed(1);
}

export function extractFirstName(displayName) {
  if (!displayName) return 'Anonymous';
  return displayName.split(' ')[0];
}

// The CSV parser (quoted fields, "" escapes, either line ending; `;` for
// the CSVs Excel writes where the comma is the decimal point) lives in
// lib/sheetFile.js (CommonJS), lives in lib/sheetFile.js shared with netlify/functions/import-sheet.js (Stage 6, F-10).
export { parseCSV } from '@/lib/sheetFile';

// Auto-detect column mapping from headers
export function autoDetectMapping(headers) {
  const mapping = {};
  const patterns = {
    artist: /^(artist|band|performer|act|group|musician)s?$/i,
    venue: /^(venue|location|place|hall|theater|theatre|arena|club)$/i,
    date: /^(date|show.?date|event.?date|when|day)$/i,
    city: /^(city|town|metro|location.?city)$/i,
    country: /^(country|nation|state.?country)$/i,
    rating: /^(rating|score|stars|rank)$/i,
    comment: /^(comment|comments|notes?|review|thoughts|memo)$/i,
    tour: /^(tour|tour.?name|tour.?title|event|event.?name)$/i,
  };

  headers.forEach((header, index) => {
    const h = header.trim();
    for (const [field, pattern] of Object.entries(patterns)) {
      if (pattern.test(h) && !(field in mapping)) {
        mapping[field] = index;
        break;
      }
    }
  });

  return mapping;
}

// timeAgo — relative date string from a Firestore Timestamp or Date
export function timeAgo(ts) {
  if (!ts) return '';
  const ms = Date.now() - (ts.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : Number(ts)));
  const d = Math.floor(ms / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// Resize image for upload — caps width at maxDim to stay under Netlify's payload limit
export function resizeImageForUpload(file, maxDim = 1200) {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const needsResize = img.width > maxDim || img.height > maxDim;
      const canvas = document.createElement('canvas');
      if (needsResize) {
        const scale = Math.min(maxDim / img.width, maxDim / img.height);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.src = url;
  });
}

// Venue-name matching lives in lib/showIdentity.js (CommonJS, shared with
// the server's duplicate rule, 5.60.5); re-exported for existing callers.
export { normalizeVenueName, venuesFuzzyMatch };

// Normalizes a song title for cross-source matching (user setlist data vs.
// streaming catalog data) — strips "(Live)"/"- Live" style suffixes, remaster
// tags, punctuation, and casing so the same song doesn't appear as both
// seen and unseen due to string differences. One definition, shared with lib/stats and the Netlify functions
// (lib/stats/keys.js, CommonJS). "Ashes//Dust" and "Ashes // Dust" are one
// key; "(Live)" and remaster tags are dropped.
export { normalizeSongTitle } from '@/lib/stats/keys';

// Turns a day count into a "2 years, 3 months" / "18 days" phrase — used
// anywhere a gap since a song was last played needs a human sentence
// rather than a raw number (song pages, wishlist "last played" labels).
export function humanizeGapDuration(days) {
  if (!days || days <= 0) return null;
  const years = Math.floor(days / 365.25);
  const remainingDays = days - years * 365.25;
  const months = Math.floor(remainingDays / 30.44);
  const parts = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (parts.length === 0) {
    const d = Math.max(1, Math.round(days));
    parts.push(`${d} day${d !== 1 ? 's' : ''}`);
  }
  return parts.join(', ');
}
