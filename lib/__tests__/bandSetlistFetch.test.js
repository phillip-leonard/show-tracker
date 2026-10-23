/**
 * Unit tests for lib/bandSetlist.js's reason reporting.
 *
 * The reasons ARE the feature. A band source that comes back with nothing
 * has half a dozen genuinely different causes — the archive has no show
 * that night, it has the show but this app's field mapping dropped every
 * row, the function returned a 503 because a key is missing, the request
 * timed out — and for a re-fetch the user asked for by pressing a button,
 * telling those apart is the whole difference between a useful message and
 * a button that appears to do nothing. That ambiguity is what made the
 * first version of the admin re-sync impossible to diagnose from the
 * outside, so the mapping from response shape to reason is pinned here.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/bandSetlistFetch.test.js
 */

import assert from 'assert';
import { fetchBandSetlistWithReason, fetchBandSetlist, enrichShowDataWithBandSetlist, mergeNeedsWrite } from '@/lib/bandSetlist';

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) {
  queue.push(async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`✗ ${name}\n  ${err.message}`);
    }
  });
}

// Stands in for the /api/band-setlist function. `body` is what it answers
// with; `status` defaults to 200. Records every URL asked for.
const asked = [];
function stubFetch({ body, status = 200, throws = null }) {
  global.fetch = async (url) => {
    asked.push(url);
    if (throws) throw new Error(throws);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

const GOOSE = { artist: 'Goose', date: '2024-10-24', venue: 'Ryman Auditorium' };

// ── The happy path ────────────────────────────────────────────────────

test('a show with songs comes back as ok, with the source id on it', async () => {
  stubFetch({
    body: {
      ok: true,
      songs: [{ name: 'Hungersite', set: 'Set 1' }],
      sourceShowId: '1234',
      sourcePermalink: 'https://elgoose.net/setlists/x.html',
      setlistNotes: 'notes',
      tour: 'Fall 2024',
    },
  });

  const { result, reason } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(reason, 'ok');
  assert.strictEqual(result.source, 'elgoose');
  assert.strictEqual(result.songs.length, 1);
  assert.strictEqual(result.sourcePermalink, 'https://elgoose.net/setlists/x.html');
});

test('the request carries source, artist, date and venue', async () => {
  asked.length = 0;
  stubFetch({ body: { ok: true, songs: [{ name: 'Arcadia', set: 'Set 1' }] } });
  await fetchBandSetlistWithReason(GOOSE);

  const url = asked[0];
  assert.match(url, /\/api\/band-setlist\?/);
  assert.match(url, /source=elgoose/);
  assert.match(url, /date=2024-10-24/);
  assert.match(url, /venue=Ryman\+Auditorium/);
});

// ── The reasons ───────────────────────────────────────────────────────

test('an artist setlist.fm owns is not-a-band-source, and asks nobody', async () => {
  asked.length = 0;
  stubFetch({ body: { ok: true, songs: [] } });

  const { result, reason } = await fetchBandSetlistWithReason({ artist: 'Wilco', date: '2024-10-24' });

  assert.strictEqual(result, null);
  assert.strictEqual(reason, 'not-a-band-source');
  assert.strictEqual(asked.length, 0, 'no request should go out for an artist with no band source');
});

test('no artist or no date is missing-artist-or-date, and asks nobody', async () => {
  asked.length = 0;
  stubFetch({ body: { ok: true, songs: [] } });

  assert.strictEqual((await fetchBandSetlistWithReason({ artist: 'Goose' })).reason, 'missing-artist-or-date');
  assert.strictEqual((await fetchBandSetlistWithReason({ date: '2024-10-24' })).reason, 'missing-artist-or-date');
  assert.strictEqual((await fetchBandSetlistWithReason()).reason, 'missing-artist-or-date');
  assert.strictEqual(asked.length, 0);
});

test('an empty date on the archive is no-show, and keeps the message', async () => {
  // selectShow's shape for a date the archive doesn't have: shows: [].
  stubFetch({ body: { ok: true, songs: [], shows: [], message: 'No show on 2024-10-24' } });

  const { result, reason, detail } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(result, null);
  assert.strictEqual(reason, 'no-show');
  assert.strictEqual(detail, 'No show on 2024-10-24');
});

test('a show whose rows all dropped is no-songs, not no-show', async () => {
  // The mis-transcribed-field-name case: the archive HAS the show, every row
  // came back, and buildSetlist dropped them all for having no title. That
  // is a bug in this app, and must not be reported as the archive having a
  // gap — hence a distinct reason.
  stubFetch({
    body: { ok: true, songs: [], candidates: [{ venue: 'Ryman Auditorium', songCount: 0 }], droppedUntitledCount: 22 },
  });

  const { result, reason } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(result, null);
  assert.strictEqual(reason, 'no-songs');
});

test('droppedUntitledCount alone is enough to say no-songs', async () => {
  stubFetch({ body: { ok: true, songs: [], droppedUntitledCount: 3 } });
  assert.strictEqual((await fetchBandSetlistWithReason(GOOSE)).reason, 'no-songs');
});

test('a non-200 is http-error, with the status in the detail', async () => {
  // Includes the 503 a missing PHISHNET_API_KEY produces.
  stubFetch({ status: 503, body: { ok: false, error: 'PHISHNET_API_KEY not configured' } });

  const { result, reason, detail } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(result, null);
  assert.strictEqual(reason, 'http-error');
  assert.strictEqual(detail, 'HTTP 503');
});

test('ok:false in a 200 body is still not a setlist', async () => {
  stubFetch({ body: { ok: false, message: 'upstream error' } });

  const { reason, detail } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(reason, 'no-show');
  assert.strictEqual(detail, 'upstream error');
});

test('a thrown fetch is fetch-failed, with the error message', async () => {
  stubFetch({ throws: 'network down' });

  const { result, reason, detail } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(result, null);
  assert.strictEqual(reason, 'fetch-failed');
  assert.strictEqual(detail, 'network down');
});

test('an ambiguous date still returns the setlist, flagged', async () => {
  stubFetch({
    body: {
      ok: true,
      ambiguous: true,
      message: '2 shows on 2024-10-24; matched on venue "Ryman Auditorium"',
      candidates: [{ venue: 'Ryman Auditorium' }, { venue: 'Brooklyn Bowl' }],
      songs: [{ name: 'Madhuvan', set: 'Set 2' }],
    },
  });

  const { result, reason } = await fetchBandSetlistWithReason(GOOSE);

  assert.strictEqual(reason, 'ok');
  assert.strictEqual(result.ambiguous, true);
  assert.strictEqual(result.candidates.length, 2);
});

// ── The stored date, in whatever spelling the show happens to carry ───
//
// This is what made the feature work on half a library: the ticket scanner
// stored setlist.fm's DD-MM-YYYY verbatim while every other add path
// reversed it, parseDate reads both so the app displayed them identically,
// and the lookup then asked the archive for a date that does not exist in
// that form. Same artist, same archive, same button — two outcomes decided
// by which screen had added the show.

test('a DD-MM-YYYY show date is asked about as YYYY-MM-DD', () => {
  asked.length = 0;
  stubFetch({ body: { ok: true, songs: [{ name: 'Hungersite', set: 'Set 1' }] } });

  return fetchBandSetlistWithReason({ artist: 'Goose', date: '28-05-2025' }).then(({ reason }) => {
    assert.strictEqual(reason, 'ok');
    assert.match(asked[0], /date=2025-05-28/, 'the archive is asked in its own format');
    assert.doesNotMatch(asked[0], /date=28-05-2025/);
  });
});

test('an ISO show date is passed through untouched', async () => {
  asked.length = 0;
  stubFetch({ body: { ok: true, songs: [{ name: 'Arcadia', set: 'Set 1' }] } });
  await fetchBandSetlistWithReason({ artist: 'Goose', date: '2025-05-28' });
  assert.match(asked[0], /date=2025-05-28/);
});

test('a date that cannot be read is bad-date, and asks nobody', async () => {
  asked.length = 0;
  stubFetch({ body: { ok: true, songs: [] } });

  const { result, reason, detail } = await fetchBandSetlistWithReason({ artist: 'Goose', date: 'sometime in May' });

  assert.strictEqual(result, null);
  assert.strictEqual(reason, 'bad-date');
  assert.strictEqual(detail, 'sometime in May');
  assert.strictEqual(asked.length, 0, 'no request goes out for a date we cannot convert');
});

// ── The wrapper the add paths use ─────────────────────────────────────

test('fetchBandSetlist still collapses every failure to null', async () => {
  stubFetch({ body: { ok: true, songs: [], shows: [], message: 'No show on 2024-10-24' } });
  assert.strictEqual(await fetchBandSetlist(GOOSE), null);

  stubFetch({ status: 500, body: {} });
  assert.strictEqual(await fetchBandSetlist(GOOSE), null);

  stubFetch({ throws: 'boom' });
  assert.strictEqual(await fetchBandSetlist(GOOSE), null);
});

test('fetchBandSetlist returns the result itself on success', async () => {
  stubFetch({ body: { ok: true, songs: [{ name: 'Hot Tea', set: 'Set 1' }] } });

  const result = await fetchBandSetlist(GOOSE);

  assert.ok(result, 'a successful fetch is not null');
  assert.strictEqual(result.songs[0].name, 'Hot Tea');
});

test('adding a show whose setlist.fm songs already match still takes the band source', async () => {
  const songs = [{ id: 'a', name: 'Hungersite', set: 'Set I' }];
  stubFetch({ body: { ok: true, songs, sourceShowId: '1234', sourcePermalink: 'https://elgoose.net/setlists/x.html' } });

  const show = await enrichShowDataWithBandSetlist({ ...GOOSE, setlist: songs, setlistSource: 'setlistfm' });

  assert.strictEqual(show.setlistSource, 'elgoose', 'an identical setlist is not a reason to keep the old source');
  assert.strictEqual(show.sourcePermalink, 'https://elgoose.net/setlists/x.html');
});

test('mergeNeedsWrite: an identical setlist writes only when a show field would change', () => {
  const identical = { changed: false, summary: { skipped: 'identical' } };
  const fields = { setlist: [], setlistSource: 'elgoose', sourcePermalink: 'p', setlistFetchedAt: 'now', isManual: false };
  const upToDate = { setlistSource: 'elgoose', sourcePermalink: 'p', setlistFetchedAt: 'then' };

  assert.strictEqual(mergeNeedsWrite(identical, upToDate, fields), false, 'setlistFetchedAt alone is not a change; missing isManual is false');
  assert.strictEqual(mergeNeedsWrite(identical, { ...upToDate, setlistSource: 'setlistfm' }, fields), true);
  assert.strictEqual(mergeNeedsWrite(identical, upToDate, { ...fields, setlistProposal: { status: 'accepted' } }), true, 'a recorded decision is a change');
  assert.strictEqual(mergeNeedsWrite({ changed: false, summary: { skipped: 'empty-incoming' } }, {}, fields), false, 'nothing to write stays nothing to write');
  assert.strictEqual(mergeNeedsWrite({ changed: true, summary: {} }, upToDate, fields), true);
});

// ── Summary ─────────────────────────────────────────
(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
