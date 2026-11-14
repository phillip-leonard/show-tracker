/**
 * Shared utility functions — extracted from App.js
 * Pure functions with no React dependencies.
 */

// Show dates: every rule lives in lib/showDate.js (5.59.10). These names
// stay here because ~60 files import them from lib/utils.
export { formatDate, parseDate, toIsoDate, parseImportDate } from '@/lib/showDate';
export { today as localIsoDate } from '@/lib/showDate';
import { compareShowDates } from '@/lib/showDate';

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

// CSV Parser - handles quoted fields, escaped quotes, various line endings.
// `delimiter` is ';' for the CSVs Excel writes in locales where the comma
// is the decimal point.
export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(current.trim());
        current = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(current.trim());
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
        current = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(current.trim());
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
        current = '';
      } else {
        current += ch;
      }
    }
  }
  row.push(current.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

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

export function normalizeVenueName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Normalizes a song title for cross-source matching (user setlist data vs.
// streaming catalog data) — strips "(Live)"/"- Live" style suffixes, remaster
// tags, punctuation, and casing so the same song doesn't appear as both
// seen and unseen due to string differences.
export function normalizeSongTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[-–—]\s*(live|remaster(ed)?( \d{4})?|mono|stereo|single|album)( version)?\s*$/i, '')
    .replace(/\(\s*(live|remaster(ed)?( \d{4})?|mono|stereo|single|album)( version)?\s*\)\s*$/i, '')
    // Segue notation ("Ashes//Dust" vs "Ashes // Dust") uses "/" as a word
    // separator, not punctuation to discard — turn it into a space before
    // the generic strip below so both spellings collapse to one key.
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function venuesFuzzyMatch(a, b) {
  const na = normalizeVenueName(a);
  const nb = normalizeVenueName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

export function mergeTicketEvents(tmEvents, sgEvents) {
  const merged = [];
  const usedSgIndices = new Set();

  tmEvents.forEach((tm) => {
    let matchedSg = null;
    let matchedSgIdx = -1;

    sgEvents.forEach((sg, idx) => {
      if (!usedSgIndices.has(idx) && tm.date === sg.date && venuesFuzzyMatch(tm.venue, sg.venue)) {
        matchedSg = sg;
        matchedSgIdx = idx;
      }
    });

    if (matchedSg) {
      usedSgIndices.add(matchedSgIdx);
      merged.push({
        id: `tm_${tm.id}`,
        date: tm.date,
        time: tm.time,
        venue: tm.venue || matchedSg.venue,
        city: tm.city || matchedSg.city,
        state: tm.state || matchedSg.state,
        tmUrl: tm.url,
        sgUrl: matchedSg.url,
        minPrice: tm.minPrice || matchedSg.minPrice,
        maxPrice: tm.maxPrice || matchedSg.maxPrice,
      });
    } else {
      merged.push({
        id: `tm_${tm.id}`,
        date: tm.date,
        time: tm.time,
        venue: tm.venue,
        city: tm.city,
        state: tm.state,
        tmUrl: tm.url,
        sgUrl: null,
        minPrice: tm.minPrice,
        maxPrice: tm.maxPrice,
      });
    }
  });

  sgEvents.forEach((sg, idx) => {
    if (!usedSgIndices.has(idx)) {
      merged.push({
        id: `sg_${sg.id}`,
        date: sg.date,
        time: sg.time,
        venue: sg.venue,
        city: sg.city,
        state: sg.state,
        tmUrl: null,
        sgUrl: sg.url,
        minPrice: sg.minPrice,
        maxPrice: sg.maxPrice,
      });
    }
  });

  merged.sort((a, b) => {
    return compareShowDates(a.date, b.date);
  });

  return merged.slice(0, 5);
}

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

export function formatTicketDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
