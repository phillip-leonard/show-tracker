/**
 * Unit tests for lib/setlistSources.js — the artist → setlist source
 * registry and its resolver.
 *
 * The thing worth pinning down here is the DEFAULT. setlist.fm has to be
 * what every unclaimed artist resolves to, because the alternative — an
 * artist quietly getting routed to an archive that has never heard of
 * them — is invisible until someone notices their setlists stopped
 * updating. So most of these tests are about artists that must NOT match.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/setlistSources.test.js
 */

import assert from 'assert';
import {
  SETLIST_SOURCES, SETLISTFM_SOURCE_ID, artistNameKey, artistNameKeyLoose,
  hasBandSource, resolveSource, sourceHomeUrl, sourceLabel,
} from '@/lib/setlistSources';
import { artistKeyFor } from '@/lib/wishlist';
import songfishSites from '@/config/songfish-sites.json';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

// ── The default ───────────────────────────────────────────────────────

test('an unclaimed artist resolves to setlist.fm', () => {
  const r = resolveSource('The Strokes');
  assert.strictEqual(r.id, SETLISTFM_SOURCE_ID);
  assert.strictEqual(r.isBandSource, false);
  assert.strictEqual(r.matchedOn, 'default');
});

test('artists adjacent to a claimed one do NOT match', () => {
  // Nothing in this registry is fuzzy. "Goose Island", "Mother Goose" and
  // "Phish Food" are different artists and must stay on setlist.fm.
  //
  // CHANGED IN 5.34.2: "The Phish" used to be on this list, on the
  // it-is-not-exactly-the-name principle. It is off it now, because a
  // leading article is a spelling difference rather than a different band —
  // scanForMissingSetlists has always retried setlist.fm under both "X" and
  // "The X" for exactly that reason — and the strict reading is what made a
  // stored "Goose (US)" resolve to setlist.fm and the whole feature quietly
  // do nothing. See the loose-key tests below, which pin the line: the
  // qualifier is stripped, the name is not.
  ['Goose Island', 'Mother Goose', 'Gooseberry', 'Phishing', 'Phish Food']
    .forEach((name) => {
      assert.strictEqual(resolveSource(name).id, SETLISTFM_SOURCE_ID, `${name} must not match`);
    });
});

test('the side projects stay on setlist.fm until someone verifies them', () => {
  // Deliberate: elgoose.net carries Orebolo and phish.net covers Trey
  // Anastasio Band, but neither was verifiable against a live API response
  // when this was written, and an unverified guess is exactly what the
  // registry exists to avoid. They resolve to setlist.fm, which is what
  // they did before this change, so nothing regresses by waiting.
  ['Orebolo', 'Trey Anastasio Band', 'Trey Anastasio', 'Goose Acoustic', 'TAB']
    .forEach((name) => {
      assert.strictEqual(resolveSource(name).id, SETLISTFM_SOURCE_ID, `${name} must not match yet`);
    });
});

test('an empty, null or junk artist resolves to setlist.fm without throwing', () => {
  [undefined, null, '', '   ', {}, { name: '' }, { name: null }].forEach((input) => {
    assert.strictEqual(resolveSource(input).id, SETLISTFM_SOURCE_ID);
  });
});

test('resolveSource never returns null', () => {
  [undefined, null, 'Goose', { name: 'Phish', mbid: 'x' }].forEach((input) => {
    assert.ok(resolveSource(input), 'must always return an object');
  });
});

// ── The two claimed artists ───────────────────────────────────────────

test('Goose resolves to elgoose, by name', () => {
  const r = resolveSource('Goose');
  assert.strictEqual(r.id, 'elgoose');
  assert.strictEqual(r.isBandSource, true);
  assert.strictEqual(r.matchedOn, 'name');
  assert.strictEqual(r.sourceArtistFilter, '1', 'El Goose identifies Goose by its numeric artist_id');
});

test('Phish resolves to phishnet, with the artistid the API wants', () => {
  const r = resolveSource('Phish');
  assert.strictEqual(r.id, 'phishnet');
  assert.strictEqual(r.isBandSource, true);
  assert.strictEqual(r.sourceArtistFilter, '1');
  assert.strictEqual(r.requiresApiKey, true);
});

test('elgoose needs no API key; phishnet does', () => {
  assert.strictEqual(resolveSource('Goose').requiresApiKey, false);
  assert.strictEqual(resolveSource('Phish').requiresApiKey, true);
});

test('casing and surrounding whitespace do not affect the match', () => {
  ['goose', 'GOOSE', '  Goose  ', 'gOOsE'].forEach((name) => {
    assert.strictEqual(resolveSource(name).id, 'elgoose', `${JSON.stringify(name)} must match`);
  });
});

test('an artist object is accepted as well as a bare name', () => {
  assert.strictEqual(resolveSource({ name: 'Goose' }).id, 'elgoose');
  assert.strictEqual(resolveSource('Goose').id, 'elgoose');
});

test('hasBandSource is the same decision as resolveSource', () => {
  assert.strictEqual(hasBandSource('Goose'), true);
  assert.strictEqual(hasBandSource('Phish'), true);
  assert.strictEqual(hasBandSource('The Strokes'), false);
  assert.strictEqual(hasBandSource(''), false);
});

// ── Name normalization reuses the app's one normalizer ────────────────

test('artistNameKey trims first, working around artistKeyFor\'s hyphen-then-trim order', () => {
  // artistKeyFor collapses whitespace to hyphens BEFORE it trims, so an
  // untrimmed '  Goose  ' becomes '-goose-' and would match nothing.
  assert.strictEqual(artistKeyFor({ name: '  Goose  ' }), '-goose-', 'documenting the quirk being guarded against');
  assert.strictEqual(artistNameKey('  Goose  '), 'goose');
});

test('artistNameKey is artistKeyFor\'s name branch, not a second normalizer', () => {
  // The registry must key off the same normalization the wishlist and the
  // song index use, or a link built from one would point at a key the other
  // never produces.
  ['Goose', 'Phish', 'The Disco Biscuits', 'Umphrey\'s McGee', 'STS9', 'Guster']
    .forEach((name) => {
      assert.strictEqual(artistNameKey(name), artistKeyFor({ name }), `${name} disagrees`);
    });
});

test('artistNameKey ignores an mbid, unlike artistKeyFor', () => {
  // artistKeyFor returns the mbid when handed an mbid-bearing object, which
  // is not what a *name* key should be — the same distinction
  // artistSlugFromName draws in lib/songIndex.js.
  assert.strictEqual(artistNameKey('Goose'), 'goose');
  assert.strictEqual(artistKeyFor({ name: 'Goose', mbid: 'abc-123' }), 'abc-123');
});

// ── The mbid guard ────────────────────────────────────────────────────

test('an unrecognized mbid falls back to the name match, it does not deny', () => {
  // An mbid the registry has not catalogued is evidence the mbid lists are
  // incomplete, not evidence of a different artist — so prefer-mbid-then-
  // fall-back-to-name is what happens.
  const r = resolveSource({ name: 'Goose', mbid: 'some-uncatalogued-mbid' });
  assert.strictEqual(r.id, 'elgoose');
  assert.strictEqual(r.matchedOn, 'name');
});

test('a denied mbid overrules a name match — the Dutch Goose guard', () => {
  // The mechanism, exercised against an injected entry because no real
  // colliding mbid was verifiable when this was written. This is the branch
  // that protects against the Dutch electro act also called Goose once
  // someone has its mbid to put in deniedMbids.
  const original = SETLIST_SOURCES.elgoose.deniedMbids.slice();
  try {
    SETLIST_SOURCES.elgoose.deniedMbids.push('dutch-goose-mbid');
    const r = resolveSource({ name: 'Goose', mbid: 'dutch-goose-mbid' });
    assert.strictEqual(r.id, SETLISTFM_SOURCE_ID);
    assert.strictEqual(r.isBandSource, false);
    assert.strictEqual(r.matchedOn, 'mbid-denied');
  } finally {
    SETLIST_SOURCES.elgoose.deniedMbids.length = 0;
    SETLIST_SOURCES.elgoose.deniedMbids.push(...original);
  }
});

test('a known-good mbid matches with matchedOn "mbid", not the heuristic', () => {
  const original = SETLIST_SOURCES.phishnet.mbids.slice();
  try {
    SETLIST_SOURCES.phishnet.mbids.push('phish-mbid');
    // Matched on the mbid even though the name is spelled unusually.
    const r = resolveSource({ name: 'Phish', mbid: 'phish-mbid' });
    assert.strictEqual(r.id, 'phishnet');
    assert.strictEqual(r.matchedOn, 'mbid');
  } finally {
    SETLIST_SOURCES.phishnet.mbids.length = 0;
    SETLIST_SOURCES.phishnet.mbids.push(...original);
  }
});

// ── The registry is data, so a third source is an entry not a refactor ─

test('every entry carries the full config shape', () => {
  Object.entries(SETLIST_SOURCES).forEach(([key, source]) => {
    assert.strictEqual(source.id, key, `${key}: id must equal its key`);
    assert.ok(source.label, `${key}: needs a label for the attribution line`);
    assert.ok(source.homeUrl?.startsWith('https://'), `${key}: needs an https homeUrl`);
    assert.ok(Array.isArray(source.nameKeys) && source.nameKeys.length, `${key}: needs nameKeys`);
    assert.ok(Array.isArray(source.mbids), `${key}: needs an mbids array`);
    assert.ok(Array.isArray(source.deniedMbids), `${key}: needs a deniedMbids array`);
    assert.strictEqual(typeof source.requiresApiKey, 'boolean', `${key}: requiresApiKey must be a boolean`);
    // Every claimed name must have an upstream identifier, or a fetch for
    // it would go out without one.
    source.nameKeys.forEach((nameKey) => {
      assert.ok(source.sourceArtistFilter[nameKey], `${key}: ${nameKey} has no sourceArtistFilter`);
    });
  });
});

test('every nameKey is already normalized, so it can actually match', () => {
  Object.values(SETLIST_SOURCES).forEach((source) => {
    source.nameKeys.forEach((nameKey) => {
      assert.strictEqual(artistNameKey(nameKey), nameKey, `${nameKey} is not in normalized form`);
    });
  });
});

test('no two sources claim the same artist name', () => {
  const seen = new Set();
  Object.values(SETLIST_SOURCES).forEach((source) => {
    source.nameKeys.forEach((nameKey) => {
      assert.ok(!seen.has(nameKey), `${nameKey} is claimed twice`);
      seen.add(nameKey);
    });
  });
});

test('setlistfm is not itself an entry — it is the fallback, not a band source', () => {
  assert.strictEqual(SETLIST_SOURCES[SETLISTFM_SOURCE_ID], undefined);
});

// ── Attribution labels ────────────────────────────────────────────────

test('sourceLabel and sourceHomeUrl read the stored id, not the artist', () => {
  // Attribution must reflect where the data actually came from. An artist
  // added to the registry later must not retroactively relabel a show's
  // old setlist.fm setlist as coming from El Goose.
  assert.strictEqual(sourceLabel('elgoose'), 'El Goose');
  assert.strictEqual(sourceLabel('phishnet'), 'Phish.net');
  assert.strictEqual(sourceLabel('setlistfm'), 'setlist.fm');
  assert.strictEqual(sourceHomeUrl('elgoose'), 'https://elgoose.net');
});

test('an absent or unknown setlistSource labels as setlist.fm', () => {
  // Every show document written before v5.33.0 has no setlistSource field.
  [undefined, null, '', 'setlistfm', 'something-removed-later'].forEach((id) => {
    assert.strictEqual(sourceLabel(id), 'setlist.fm', `${JSON.stringify(id)} must fall back`);
    assert.strictEqual(sourceHomeUrl(id), 'https://www.setlist.fm');
  });
});

// ── The loose key ─────────────────────────────────────────────────────
//
// Exactness here failed silently and expensively: a show stored as
// "Goose (US)" keys to "goose-us", matches nothing, resolves to setlist.fm,
// and then the whole band-source path correctly does nothing — no button on
// the show, no rows in the admin re-sync, and no error anywhere, because
// resolving to setlist.fm is a legitimate answer rather than a failure.

test('a bracketed qualifier does not cost the match', () => {
  ['Goose (US)', 'Goose [live]', 'Goose (band)'].forEach((name) => {
    const source = resolveSource({ name });
    assert.strictEqual(source.id, 'elgoose', `${name} should still reach El Goose`);
    assert.strictEqual(source.matchedOn, 'name-loose', 'and should say it needed the loose key');
    assert.strictEqual(source.sourceArtistFilter, '1', 'the upstream filter comes from the matched key');
  });
});

test('a leading article does not cost the match', () => {
  const source = resolveSource({ name: 'The Goose' });
  assert.strictEqual(source.id, 'elgoose');
  assert.strictEqual(source.matchedOn, 'name-loose');
});

test('an exact name still reports as an exact match', () => {
  // The loose pass runs only after the exact one fails, so a plain name
  // must never come back labelled 'name-loose'.
  assert.strictEqual(resolveSource({ name: 'Goose' }).matchedOn, 'name');
  assert.strictEqual(resolveSource({ name: '  Goose  ' }).matchedOn, 'name');
  assert.strictEqual(resolveSource({ name: 'Phish' }).matchedOn, 'name');
});

test('loosening does not widen the registry to different bands', () => {
  // The point is qualifiers, not fuzziness. These are other acts and must
  // still resolve to setlist.fm.
  ['Goose & Friends', 'Goosebumps', 'Mighty Goose', 'Orebolo', 'Trey Anastasio Band', 'Phish Food']
    .forEach((name) => {
      assert.strictEqual(resolveSource({ name }).id, SETLISTFM_SOURCE_ID, `${name} must stay on setlist.fm`);
    });
});

test('a denied mbid still overrules a name that only matches loosely', () => {
  // The loose key loosens the NAME heuristic. It must not reopen a door the
  // mbid list has explicitly closed.
  const denied = '00000000-0000-0000-0000-000000000000';
  const original = SETLIST_SOURCES.elgoose.deniedMbids.slice();
  SETLIST_SOURCES.elgoose.deniedMbids.push(denied);
  try {
    const source = resolveSource({ name: 'Goose (US)', mbid: denied });
    assert.strictEqual(source.id, SETLISTFM_SOURCE_ID);
    assert.strictEqual(source.matchedOn, 'mbid-denied');
  } finally {
    SETLIST_SOURCES.elgoose.deniedMbids.length = 0;
    SETLIST_SOURCES.elgoose.deniedMbids.push(...original);
  }
});

test('artistNameKeyLoose is the exact key for a name with nothing to strip', () => {
  assert.strictEqual(artistNameKeyLoose('Goose'), artistNameKey('Goose'));
  assert.strictEqual(artistNameKeyLoose('Wilco'), 'wilco');
  assert.strictEqual(artistNameKeyLoose(''), '');
  assert.strictEqual(artistNameKeyLoose(null), '');
});

test('artistNameKeyLoose strips the qualifier, not the name', () => {
  assert.strictEqual(artistNameKeyLoose('Goose (US)'), 'goose');
  assert.strictEqual(artistNameKeyLoose('The Goose'), 'goose');
  // "The" inside the name is not an article and must survive.
  assert.strictEqual(artistNameKeyLoose('Neutral Milk Hotel'), 'neutral-milk-hotel');
  assert.strictEqual(artistNameKeyLoose('Portugal. The Man'), 'portugal-the-man');
});

// ── The Songfish registry (config/songfish-sites.json) ────────────────

test('every Songfish site entry carries the registry fields', () => {
  const ids = new Set();
  for (const site of songfishSites.sites) {
    assert.ok(site.id && !ids.has(site.id), `${site.id}: id missing or duplicated`);
    ids.add(site.id);
    assert.ok(site.displayName, `${site.id}: displayName`);
    assert.match(site.baseUrl, /^https:\/\/[a-z0-9.-]+$/, `${site.id}: baseUrl is an https origin`);
    assert.strictEqual(typeof site.enabled, 'boolean', `${site.id}: enabled is a boolean`);
    assert.ok(site.attribution?.label && /^https:\/\//.test(site.attribution.url), `${site.id}: attribution`);
    assert.ok(['granted', 'pending', 'not_requested'].includes(site.permissionStatus), `${site.id}: permissionStatus`);
    assert.ok(site.artists.length > 0, `${site.id}: at least one artist`);
    site.artists.forEach((a) => assert.ok(a.name && Number.isInteger(a.artistId), `${site.id}: ${a.name} needs a numeric artistId`));
  }
});

test('Goose on El Goose is the only enabled Songfish site', () => {
  const enabled = songfishSites.sites.filter((s) => s.enabled).map((s) => s.id);
  assert.deepStrictEqual(enabled, ['elgoose']);
});

test('enabled Songfish sites are sources; disabled ones are not', () => {
  for (const site of songfishSites.sites) {
    assert.strictEqual(!!SETLIST_SOURCES[site.id], site.enabled, `${site.id}`);
  }
});

test("a disabled site's artists stay on setlist.fm", () => {
  ['Tedeschi Trucks Band', 'King Gizzard & the Lizard Wizard', 'King Gizzard', 'Eggy', 'Dogs in a Pile']
    .forEach((name) => {
      assert.strictEqual(resolveSource(name).id, SETLISTFM_SOURCE_ID, `${name} must not leave setlist.fm`);
    });
});

test('attribution for an El Goose show comes from the config', () => {
  const site = songfishSites.sites.find((s) => s.id === 'elgoose');
  assert.strictEqual(sourceLabel('elgoose'), site.attribution.label);
  assert.strictEqual(sourceHomeUrl('elgoose'), site.attribution.url);
});

// ── Summary ─────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
