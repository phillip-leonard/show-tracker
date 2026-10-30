/**
 * Shared utility functions — extracted from App.js
 * Pure functions with no React dependencies.
 */

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const ddmmyyyy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1])).toLocaleDateString();
  }
  // Handle YYYY-MM-DD format — construct as local date to avoid UTC shift
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])).toLocaleDateString();
  }
  const d = new Date(dateStr);
  return isNaN(d) ? dateStr : d.toLocaleDateString();
}

export function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  const ddmmyyyy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  // Handle YYYY-MM-DD format — construct as local date to avoid UTC shift
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  const d = new Date(dateStr);
  return isNaN(d) ? new Date(0) : d;
}

// ── The stored date, as an archive wants it ───────────────────────────
//
// Show documents do NOT all store dates the same way, which is why
// parseDate above accepts two formats. Most add paths reverse setlist.fm's
// DD-MM-YYYY into YYYY-MM-DD before saving; the ticket scanner stored
// setlist.fm's `eventDate` verbatim, so shows added that way carry
// "28-05-2025" while everything else carries "2025-05-28".
//
// That difference was invisible: parseDate handles both, so the date
// renders correctly everywhere in the app — and then the band-source
// lookup asked elgoose.net for /setlists/showdate/28-05-2025, which is not
// a date it has, and the show quietly kept its setlist.fm setlist. Half a
// library working and half not, split by which screen added the show.
//
// Built on parseDate rather than beside it, deliberately: whatever date the
// app DISPLAYS for a show is the date it asks the archive about. A second
// interpretation of "28-05-2025" living in a second function is how you get
// a lookup that disagrees with the UI.
export function toIsoDate(dateStr) {
  const d = parseDate(dateStr);
  // parseDate's own sentinel for "I could not read this" is new Date(0).
  if (!d || Number.isNaN(d.getTime()) || d.getTime() === 0) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Today on the device's own calendar, as "YYYY-MM-DD". Not
// new Date().toISOString().slice(0, 10): that is the UTC date, which on a
// US evening is already tomorrow.
export function localIsoDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

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

// Robust date parser for import - normalizes to YYYY-MM-DD
export function parseImportDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;

  // Excel serial date number
  if (/^\d{4,5}(\.\d+)?$/.test(s) && Number(s) > 1000 && Number(s) < 100000) {
    const serial = Number(s);
    const utcDays = Math.floor(serial - 25569);
    const d = new Date(utcDays * 86400000);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  }

  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!isNaN(d)) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (mdy) {
    let year = Number(mdy[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Try native Date parsing as fallback
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 1900) {
    return d.toISOString().split('T')[0];
  }

  return null;
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
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
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
