// Determines which streaming platforms likely have a given show.
// Returns an array of platform objects with name, url, label, and icon.

import { toIsoDate } from '@/lib/utils';

const RELISTEN_SLUGS = {
  phish: 'phish',
  'grateful dead': 'grateful-dead',
  'dead & company': 'dead-and-company',
  'dead and company': 'dead-and-company',
  'widespread panic': 'widespread-panic',
  'string cheese incident': 'string-cheese-incident',
  'the allman brothers': 'allman-brothers-band',
  'allman brothers': 'allman-brothers-band',
};

function getRelistenSlug(artist) {
  const lower = artist.toLowerCase();
  for (const [key, slug] of Object.entries(RELISTEN_SLUGS)) {
    if (lower.includes(key)) return slug;
  }
  return null;
}

function getRelistenUrl(artist, date) {
  const slug = getRelistenSlug(artist);
  if (!slug || !date) return null;
  const parts = date.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `https://relisten.net/${slug}/${year}/${month}/${day}`;
  }
  return `https://relisten.net/${slug}`;
}

function getPlaydeadUrl(date) {
  return date ? `https://playdead.co/${date}` : 'https://playdead.co';
}

function getNugsUrl(artist) {
  return `https://www.nugs.net/search?q=${encodeURIComponent(artist)}`;
}

function getArchiveUrl(artist, date) {
  const query = [artist, date].filter(Boolean).join(' ');
  return `https://archive.org/search.php?query=${encodeURIComponent(query)}&and[]=mediatype%3A%22audio%22`;
}

export function getStreamingPlatforms(artistName, rawDate, venue) {
  if (!artistName) return [];

  // Every link below wants YYYY-MM-DD, but stored show dates are not all
  // in that format — ticket-scanner shows carry setlist.fm's DD-MM-YYYY
  // verbatim (see toIsoDate in lib/utils.js). toIsoDate reads both with
  // local-date constructors, so the date can't shift by a day. An
  // unreadable date becomes '' and the links fall back to artist-only.
  const date = toIsoDate(rawDate);

  const artist = artistName.toLowerCase();
  const platforms = [];

  // nugs.net — primary jam band archive
  const nugsArtists = [
    'phish', 'dead', 'goose', 'billy strings', 'panic', 'string cheese',
    'dave matthews', 'umphrey', 'government mule', 'trey anastasio',
    'moe.', 'furthur', 'phil lesh',
  ];
  if (nugsArtists.some((a) => artist.includes(a))) {
    platforms.push({
      name: 'nugs.net',
      url: getNugsUrl(artistName),
      label: 'Listen on nugs.net',
      icon: '🎵',
      description: 'Official high-quality recordings',
    });
  }

  // playdead.co — Dead family only
  const deadArtists = ['grateful dead', 'dead & company', 'dead and company', 'furthur', 'phil lesh'];
  if (deadArtists.some((a) => artist.includes(a))) {
    platforms.push({
      name: 'playdead.co',
      url: getPlaydeadUrl(date),
      label: 'Listen on PlayDead',
      icon: '💀',
      description: 'Dead family streaming',
    });
  }

  // relisten.net — select artists with date-based deep links
  const relistenSlug = getRelistenSlug(artistName);
  if (relistenSlug) {
    platforms.push({
      name: 'relisten.net',
      url: getRelistenUrl(artistName, date),
      label: 'Listen on Relisten',
      icon: '🎧',
      description: 'Free community recordings',
    });
  }

  // archive.org — open to all artists
  platforms.push({
    name: 'archive.org',
    url: getArchiveUrl(artistName, date),
    label: 'Browse on Archive.org',
    icon: '📚',
    description: 'Free community archive',
  });

  return platforms;
}
