// lib/yearRecapRarity.js
//
// The recap's "Rarest catch" and "Bust-outs witnessed", for the bands with
// a full setlist archive (lib/heardLinks.js HEARD_BANDS: Goose, Phish,
// Umphrey's McGee, King Gizzard). The arithmetic is the "Songs I've heard"
// tool's own, heardRecord.js's matchLoggedShows + buildRecord, run on just
// the year's shows, so a rarest catch here is the one /heard/ would show
// for the same nights.
//
// Each band's show list comes from /api/artist-shows?slug= (CORS open,
// CDN-cached; Phish is about 200 KB compressed), fetched only for the
// archive bands the user actually saw that year. A band whose list can't
// be loaded is left out rather than failing the section: the page hides
// the section when nothing comes back, and never shows a zero.
//
// Across bands:
//   rarest catch  the song the band has played the fewest times ever,
//                 ties to the more recent show
//   bust-outs     every bust-out witnessed (a gap of BUST_OUT_MIN_GAP+
//                 shows), biggest gap first

import heard from '@/netlify/functions/lib/heardRecord';
import { heardBandsFor } from '@/lib/heardLinks';
import { toIsoDate } from '@/lib/utils';
import { apiUrl } from '@/lib/api';

export const MAX_BUST_OUTS = 5;

/** The year's shows per archive band: [{ slug, name, shows: [{ date, venue }] }]. */
export function archiveBandsFor(yearShows) {
  const dated = (yearShows || []).map((s) => ({ ...s, date: toIsoDate(s.date) || s.date }));
  return heardBandsFor(dated);
}

/**
 * Pure: the rarity sections from loaded band archives.
 * @param loaded [{ band: { slug, name, shows }, data }] — data is /api/artist-shows JSON
 * @returns { rarest, bustOuts } — rarest null and bustOuts [] when there's nothing
 */
export function rarityFrom(loaded) {
  let rarest = null;
  const bustOuts = [];
  (loaded || []).forEach(({ band, data }) => {
    if (!data || !Array.isArray(data.shows)) return;
    const { ids } = heard.matchLoggedShows(data, band.shows);
    if (!ids.length) return;
    const record = heard.buildRecord(data, ids);
    const pick = (s) => ({
      band: band.name,
      slug: band.slug,
      name: s.name,
      timesPlayed: s.timesPlayed,
      ...(s.gap != null ? { gap: s.gap } : {}),
    });
    // buildRecord's `rarest` is songs, without the show they were heard
    // at; the show is the last time the user heard it.
    const top = record.rarest[0];
    if (top && top.timesPlayed > 0) {
      const candidate = { ...pick(top), date: top.lastHeard };
      if (!rarest || candidate.timesPlayed < rarest.timesPlayed
        || (candidate.timesPlayed === rarest.timesPlayed && candidate.date > rarest.date)) {
        rarest = candidate;
      }
    }
    record.bustOuts.forEach((b) => bustOuts.push({ ...pick(b), date: b.show.date, venue: b.show.venue }));
  });
  bustOuts.sort((a, b) => b.gap - a.gap || b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return { rarest, bustOuts: bustOuts.slice(0, MAX_BUST_OUTS) };
}

const FETCH_TIMEOUT_MS = 15000;

// One band's show list, or null. fetch is called directly, as
// lib/bandScreens.js does: an unbound reference to it (a default
// parameter) isn't safe to call in every WebView.
async function loadArchive(slug) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(apiUrl(`/api/artist-shows?slug=${encodeURIComponent(slug)}`), controller ? { signal: controller.signal } : undefined);
    if (!res.ok) { console.warn(`[yearRecap] ${slug} archive: HTTP ${res.status}`); return null; }
    const json = await res.json();
    return json && json.ok !== false && Array.isArray(json.shows) ? json : null;
  } catch (err) {
    console.warn(`[yearRecap] ${slug} archive failed:`, err?.message || err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Loads the archives the year needs and resolves rarityFrom()'s result. */
export async function loadYearRarity(yearShows, load = loadArchive) {
  const bands = archiveBandsFor(yearShows);
  if (!bands.length) return { rarest: null, bustOuts: [] };
  const loaded = await Promise.all(bands.map(async (band) => {
    const data = await load(band.slug);
    return data ? { band, data } : null;
  }));
  return rarityFrom(loaded.filter(Boolean));
}
