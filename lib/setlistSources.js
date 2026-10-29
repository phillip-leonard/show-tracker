// lib/setlistSources.js
//
// The single place that answers one question: given this artist, who is the
// source of truth for their setlists?
//
// setlist.fm is the default and always will be — it covers the long tail,
// and nothing here changes that. What this registry adds is the handful of
// bands whose own community archive is strictly better than setlist.fm's
// mirror of it: per-song transitions, footnotes, jam-chart flags, official
// band-wide gap counts, soundcheck and opener flags. A source is opt-in per
// artist, never inferred — an artist absent from this file resolves to
// `setlistfm`, full stop.
//
// The registry is data rather than a switch statement on purpose. Grateful
// Dead proved it in 5.47.3: one entry below (`archive`, the Internet
// Archive's GratefulDead collection) plus one adapter file under
// netlify/functions/lib/. dead.net was evaluated and not used — it has no
// published API, only an undocumented Drupal JSON view with gaps.
//
// ── On matching, and why it is a heuristic ─────────────────────────────
//
// Show documents store `artist` as a plain string with no mbid (see the
// comment at the top of lib/songIndex.js), so at match time the artist
// string is usually all we have. That is genuinely ambiguous: "Goose" is
// also a Dutch electro band with its own setlist.fm entries, and a name
// match cannot tell the two apart.
//
// So resolveSource prefers an mbid when the caller has one — the artist
// search and the wishlist's selected-artist object both carry one — and
// falls back to the name otherwise, reporting which of the two it used via
// `matchedOn` so callers can treat a name match with appropriate suspicion.
//
// The name match being a heuristic is survivable because of what sits
// downstream of it, not because it is reliable:
//
//   1. A false positive costs nothing. Ask elgoose.net for a Dutch-Goose
//      show date and it returns no rows, and the merge rules in
//      lib/bandSetlistMerge.js write nothing on an empty result — the
//      existing setlist.fm setlist stands untouched.
//   2. The backfill (netlify/functions/admin-resync-setlists.js) reports
//      every show where the source returned nothing, which is exactly the
//      list of suspected false positives, for a human to look at.
//
// Never let a mismatch destroy data. That invariant lives in the merge
// rules; this file only decides who to ask.

import { artistKeyFor } from '@/lib/wishlist';
import songfishSites from '@/config/songfish-sites.json';
import internetArchive from '@/config/internet-archive.json';

// Normalized artist key, reusing the app's one and only artist normalizer.
// artistKeyFor returns the mbid when given an mbid-bearing artist object,
// which is not what we want for a *name* key, so names are passed through
// deliberately mbid-less — the same trick artistSlugFromName pulls in
// lib/songIndex.js, and for the same reason.
//
// The input is trimmed first, which is not a second normalizer but a
// necessary guard against one of artistKeyFor's quirks: it collapses
// whitespace to hyphens BEFORE it trims, so "  Goose  " comes out as
// "-goose-" and the trailing trim finds nothing left to remove. An artist
// string with stray padding — and user-typed ones do have it — would
// otherwise never match a registry entry, silently falling back to
// setlist.fm for no reason a reader could see.
export function artistNameKey(name) {
  return artistKeyFor({ name: String(name || '').trim() });
}

// ── A second, more forgiving key ──────────────────────────────────────
//
// artistNameKey is exact, and exactness is what silently lost the first two
// attempts at this feature: a stored artist string of "Goose (US)" keys to
// "goose-us", matches nothing, resolves to setlist.fm, and every part of
// the band-source path then does nothing at all — no button on the show, no
// rows in the admin re-sync, no error anywhere, because resolving to
// setlist.fm is a legitimate answer and not a failure.
//
// Artist strings acquire qualifiers by entirely ordinary means: setlist.fm
// disambiguates same-named acts with a parenthetical, imports and ticket
// scans carry "The" inconsistently, and a user typing a show in adds
// whatever they like. So a loose key drops bracketed qualifiers and a
// leading article before normalizing:
//
//   "Goose (US)"    -> "goose"
//   "The Goose"     -> "goose"
//   "Goose [live]"  -> "goose"
//
// This is only ever tried AFTER the exact key has failed, and it loosens
// the name heuristic rather than the mbid one — a denied mbid still wins.
// The safety argument in the module header is what makes it acceptable:
// asking elgoose.net about an artist it has never heard of returns nothing,
// and the merge rules write nothing on an empty result.
export function artistNameKeyLoose(name) {
  const stripped = String(name || '')
    // Bracketed qualifiers anywhere in the string: "(US)", "[live]", "(band)".
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .trim()
    // A leading article, which setlist.fm and the app's own search disagree
    // about for the same act.
    .replace(/^the\s+/i, '');

  return artistNameKey(stripped);
}

// ── The registry ──────────────────────────────────────────────────────
//
// Per entry:
//   id            – stored on the show document as `setlistSource`, and the
//                   `source` query parameter /api/band-setlist expects.
//   label         – human-readable, used for the attribution line in the UI.
//   homeUrl       – where the attribution links when a show has no permalink.
//   nameKeys      – normalized artist-name keys this source owns. Matched
//                   exactly against artistNameKey(showArtist); no fuzzy
//                   matching, so a name is either in this list or it isn't.
//   mbids         – setlist.fm / MusicBrainz artist mbids known to be this
//                   artist. Preferred over nameKeys when the caller has one.
//   deniedMbids   – mbids known to be a *different* artist sharing the name
//                   (the Dutch Goose problem). Matching one forces
//                   setlist.fm, overriding any name match.
//   sourceArtistFilter – the value the upstream API wants to identify the
//                   artist: elgoose.net takes an `artist` slug, phish.net
//                   takes a numeric `artistid`. Keyed by name key so one
//                   source can serve several acts.
//   requiresApiKey – whether the Netlify function needs an env-var key to
//                   talk to this source at all.
//   requiresReview – true when the source's setlists are reconstructed
//                   rather than published, so the app must show one to the
//                   user before writing it over anything (and may write one
//                   unasked only when canAutoApply in lib/bandSetlist.js
//                   says so). Optional; absent means false.
//
// ── On side projects ──────────────────────────────────────────────────
//
// elgoose.net carries Orebolo (the Rick Mitarotonda / Peter Anspach /
// Trevor Weekz acoustic project) and other Goose-adjacent acts under its
// `artist` filter, and phish.net's API is keyed by `artistid` and covers
// Trey Anastasio Band and related acts alongside Phish. Those belong here
// eventually, behind explicit config exactly like the entries below rather
// than behind fuzzy matching.
//
// They are NOT here yet, and that is deliberate: the brief was to add only
// the acts verifiable from a live API response, and this branch was built
// in an environment with no network route to either API (see the PR
// description). Adding an act on the strength of a remembered slug or
// artistid would be exactly the guesswork this registry exists to replace.
// Until someone confirms them against a live response, Orebolo and Trey
// Anastasio Band resolve to `setlistfm` — which is what they do today, so
// nothing regresses by waiting.
//
// To add one: append its name key to `nameKeys` and its upstream
// identifier to `sourceArtistFilter`. Nothing else needs to change.
//
// ── Songfish sites ────────────────────────────────────────────────────
//
// elgoose.net and every other Songfish archive (ttbase.net, kglw.net,
// thecarton.net, go-set.net, …) are entries in config/songfish-sites.json,
// not hand-written below. Only ENABLED sites become sources, so a disabled
// site's artists resolve to setlist.fm and the app never asks it anything.
// The server applies the same rule (netlify/functions/lib/songfishSites.js).
//
// sourceArtistFilter is the site's numeric artist_id, as a string. Mapping
// an artist on a site: add its name (and any aliases) and artist_id to
// that site's `artists` in the JSON.

function songfishSource(site) {
  const nameKeys = [];
  const sourceArtistFilter = {};
  const mbids = [];
  const deniedMbids = [];
  for (const artist of site.artists) {
    for (const name of [artist.name, ...(artist.aliases || [])]) {
      const key = artistNameKey(name);
      if (!key) continue;
      nameKeys.push(key);
      sourceArtistFilter[key] = String(artist.artistId);
    }
    mbids.push(...(artist.mbids || []));
    deniedMbids.push(...(artist.deniedMbids || []));
  }
  return {
    id: site.id,
    label: site.attribution?.label || site.displayName,
    homeUrl: site.attribution?.url || site.baseUrl,
    // Songfish engine, v2, no key and no auth.
    apiBase: `${site.baseUrl}/api/v2`,
    requiresApiKey: false,
    nameKeys,
    mbids,
    deniedMbids,
    sourceArtistFilter,
  };
}

const SONGFISH_SOURCES = Object.fromEntries(
  songfishSites.sites
    .filter((site) => site.enabled === true)
    .map((site) => [site.id, songfishSource(site)]),
);

// ── The Internet Archive ──────────────────────────────────────────────
//
// The Grateful Dead collection, and Live Music Archive bands that have no
// band setlist archive of their own. Not a setlist archive: it holds
// recordings, each with an uploader-written description and track titles,
// and the adapter (netlify/functions/lib/archiveAdapter.js) reconstructs
// the setlist from them. That is why this is the one source with
// `requiresReview`.
//
// Built from config/internet-archive.json, whose `enabled` is the switch
// for the whole source. Disabled, it is not in SETLIST_SOURCES, so its
// bands resolve to setlist.fm and the app never asks the Archive anything.
// The server reads the same file and refuses on its own, which is what
// covers app builds already installed.
//
// Each band is one entry in the file's `artists`, opt-in. Its name and
// `aliases` are its name keys; its `artistId` is the sourceArtistFilter
// the server looks the band up by.
function archiveNameKeys(artist) {
  return [artist.name, ...(artist.aliases || [])].map(artistNameKey).filter(Boolean);
}

export function archiveSourceFrom(config) {
  if (!config || config.enabled !== true) return null;
  const artists = Array.isArray(config.artists) ? config.artists : [];
  return {
    id: config.id,
    label: config.label,
    homeUrl: config.homeUrl,
    apiBase: 'https://archive.org',
    requiresApiKey: false,
    requiresReview: true,
    nameKeys: artists.flatMap(archiveNameKeys),
    mbids: artists.flatMap((a) => a.mbids || []),
    deniedMbids: [],
    sourceArtistFilter: Object.fromEntries(artists.flatMap((a) => archiveNameKeys(a).map((key) => [key, a.artistId]))),
  };
}

/**
 * archiveArtistFor(nameKey) -> the band's entry in
 * config/internet-archive.json, or null. Keyed by the name key a
 * band-setlist result carries (`bandKey`), for the per-band settings the
 * merge needs (`protectedGroup`).
 */
export function archiveArtistFor(nameKey, config = internetArchive) {
  if (!nameKey) return null;
  const artists = Array.isArray(config?.artists) ? config.artists : [];
  return artists.find((a) => archiveNameKeys(a).includes(nameKey)) || null;
}

const ARCHIVE_SOURCE = archiveSourceFrom(internetArchive);

export const SETLIST_SOURCES = {
  ...SONGFISH_SOURCES,

  phishnet: {
    id: 'phishnet',
    label: 'Phish.net',
    homeUrl: 'https://phish.net',
    apiBase: 'https://api.phish.net/v5',
    // PHISHNET_API_KEY, server-side only. The function returns 503 when it
    // is missing rather than falling back to a literal.
    requiresApiKey: true,
    nameKeys: ['phish'],
    mbids: [],
    deniedMbids: [],
    // phish.net identifies artists numerically. 1 is Phish itself, which is
    // also the API's default when no artistid is supplied — so this is the
    // one value that holds without a live response to check it against.
    sourceArtistFilter: { phish: '1' },
  },

  ...(ARCHIVE_SOURCE ? { archive: ARCHIVE_SOURCE } : {}),
};

// The default. Not an entry in SETLIST_SOURCES, because it is not a band
// source: it has no per-song transitions, footnotes, jam charts or official
// gaps to pull through, and it needs no adapter. It is the answer for every
// artist this registry does not explicitly claim.
export const SETLISTFM_SOURCE_ID = 'setlistfm';

const FALLBACK = Object.freeze({
  id: SETLISTFM_SOURCE_ID,
  label: 'setlist.fm',
  homeUrl: 'https://www.setlist.fm',
  isBandSource: false,
  matchedOn: 'default',
  nameKey: '',
  sourceArtistFilter: null,
  requiresApiKey: false,
  requiresReview: false,
});

// Accepts either a bare artist name or an artist-shaped object
// ({ name, mbid }), so callers that have been through the artist search can
// hand over what they already hold instead of unpacking it first.
function readArtist(artist) {
  if (typeof artist === 'string') return { name: artist, mbid: '' };
  return { name: artist?.name || '', mbid: artist?.mbid || '' };
}

/**
 * resolveSource(artist) -> {
 *   id, label, homeUrl, isBandSource, matchedOn, nameKey, sourceArtistFilter
 * }
 *
 * `artist` is an artist name, or an object with `name` and optionally
 * `mbid`. Never throws and never returns null — an unknown artist resolves
 * to the setlist.fm fallback.
 *
 * `matchedOn` reports how the decision was reached:
 *   'mbid'        – matched an mbid in a source's known-good list. Trustworthy.
 *   'name'        – matched a normalized artist name. A HEURISTIC: it cannot
 *                   distinguish two bands that share a name (see the module
 *                   header). Safe only because nothing downstream overwrites
 *                   data on an empty or failed fetch.
 *   'name-loose'  – matched only after bracketed qualifiers and a leading
 *                   article were stripped ("Goose (US)"). Same heuristic,
 *                   one step further out; named separately so it is visible.
 *   'mbid-denied' – the mbid is on a deniedMbids list, so a name match that
 *                   would otherwise have hit was overruled.
 *   'default'     – no match; setlist.fm.
 *
 * `sources` is the registry to resolve against, SETLIST_SOURCES unless a
 * test passes one built with a source switched off.
 */
export function resolveSource(artist, sources = SETLIST_SOURCES) {
  const { name, mbid } = readArtist(artist);
  const nameKey = artistNameKey(name);

  if (mbid) {
    for (const source of Object.values(sources)) {
      if (source.deniedMbids.includes(mbid)) {
        return { ...FALLBACK, matchedOn: 'mbid-denied', nameKey };
      }
    }
    for (const source of Object.values(sources)) {
      if (source.mbids.includes(mbid)) {
        return describe(source, nameKey, 'mbid');
      }
    }
    // An mbid we don't recognize is not evidence of a different artist —
    // it is only evidence that the mbid lists above are incomplete. So fall
    // through to the name match rather than denying, which is the
    // prefer-mbid-then-fall-back-to-name rule this was asked for.
  }

  if (!nameKey) return { ...FALLBACK, nameKey: '' };

  for (const source of Object.values(sources)) {
    if (source.nameKeys.includes(nameKey)) {
      return describe(source, nameKey, 'name');
    }
  }

  // Second pass on the loose key. Reported as its own `matchedOn` so a
  // caller — or a reader of the admin re-sync's report — can see that the
  // match needed the qualifier stripped, rather than it looking identical
  // to an exact hit.
  const looseKey = artistNameKeyLoose(name);
  if (looseKey && looseKey !== nameKey) {
    for (const source of Object.values(sources)) {
      if (source.nameKeys.includes(looseKey)) {
        return describe(source, looseKey, 'name-loose');
      }
    }
  }

  return { ...FALLBACK, nameKey };
}

function describe(source, nameKey, matchedOn) {
  return {
    id: source.id,
    label: source.label,
    homeUrl: source.homeUrl,
    isBandSource: true,
    matchedOn,
    nameKey,
    sourceArtistFilter: source.sourceArtistFilter[nameKey] || null,
    requiresApiKey: source.requiresApiKey,
    requiresReview: !!source.requiresReview,
  };
}

// Convenience predicate for the common "should I even try the band path?"
// branch, so callers don't each re-derive it from resolveSource's shape.
export function hasBandSource(artist) {
  return resolveSource(artist).isBandSource;
}

// The display label for a stored `setlistSource` value, for the attribution
// line on the show detail. Takes the stored id rather than an artist,
// because attribution must reflect where the data actually came from — not
// where the registry would send that artist today. An artist added to the
// registry after a show was saved must not retroactively relabel that
// show's setlist.fm setlist as coming from El Goose.
//
// For the same reason a disabled source keeps its label: a show saved from
// the Internet Archive before the switch was turned off still came from the
// Archive, and must not start crediting setlist.fm.
const STORED_SOURCE_LABELS = {
  [internetArchive.id]: { label: internetArchive.label, homeUrl: internetArchive.homeUrl },
};

function knownSource(sourceId) {
  if (!sourceId) return null;
  return SETLIST_SOURCES[sourceId] || STORED_SOURCE_LABELS[sourceId] || null;
}

export function sourceLabel(sourceId) {
  return knownSource(sourceId)?.label || FALLBACK.label;
}

export function sourceHomeUrl(sourceId) {
  return knownSource(sourceId)?.homeUrl || FALLBACK.homeUrl;
}
