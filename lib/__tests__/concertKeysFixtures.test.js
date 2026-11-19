/**
 * fixtures/concert-keys/keys.json — the keys shared content hangs off
 * (lib/concertKeys.js, Stage 6, 5.60.38): the concert key, the meetup id,
 * the Storage path segment and the comment-view id. The native app runs
 * the same file (ConcertKeysTests), so a comment, photo or meetup a native
 * user posts lands in the web's thread.
 *
 *   node lib/__tests__/concertKeysFixtures.test.js
 * Regenerate after a deliberate change, then read the diff:
 *   UPDATE_FIXTURES=1 node lib/__tests__/concertKeysFixtures.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { concertKey, meetupIdFor, mediaPathSegment, commentViewId } = require('../concertKeys');

const FILE = path.join(__dirname, '..', '..', 'fixtures', 'concert-keys', 'keys.json');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

// The inputs; the expected keys are what lib/concertKeys.js answers.
const CASES = [
  { name: 'setlist.fm id wins', show: { artist: 'Phish', venue: 'Madison Square Garden', date: '2025-12-31', setlistfmId: '63de4613' } },
  { name: 'no id: artist|venue|ISO day, trimmed and lowercased', show: { artist: ' Phish ', venue: 'Madison Square Garden ', date: '2025-12-31' } },
  { name: 'legacy DD-MM-YYYY date reads as the same day', show: { artist: 'Phish', venue: 'Madison Square Garden', date: '31-12-2025' } },
  { name: 'punctuation in the name (AC/DC)', show: { artist: 'AC/DC', venue: 'Wembley Stadium', date: '2024-07-03' } },
  { name: 'accents and apostrophes', show: { artist: 'Sigur Rós', venue: "Dick's Sporting Goods Park", date: '2023-08-05' } },
  { name: 'no venue', show: { artist: 'Goose', venue: '', date: '2025-06-15' } },
  { name: 'an unreadable date is kept as typed', show: { artist: 'Goose', venue: 'Red Rocks', date: 'Summer 2019' } },
  { name: 'empty setlist.fm id falls back', show: { artist: 'Goose', venue: 'Red Rocks', date: '2025-06-15', setlistfmId: '' } },
];
const UID = 'aliceUid000001';

function build() {
  return {
    description: 'Shared content keys (lib/concertKeys.js). concertKey is lib/showIdentity.js showMatchKey; meetupId names meetups/{id}; mediaSegment is the Storage folder showPhotos/{segment}/{uid}/; commentViewId names commentViews/{id} for `uid`.',
    uid: UID,
    cases: CASES.map(({ name, show }) => {
      const key = concertKey(show);
      return { name, show, concertKey: key, meetupId: meetupIdFor(key), mediaSegment: mediaPathSegment(key), commentViewId: commentViewId(UID, key) };
    }),
  };
}

if (UPDATE) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(build(), null, 2)}\n`);
  console.log('Wrote', path.relative(process.cwd(), FILE));
}

const fixture = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let failed = 0;
for (const c of fixture.cases) {
  try {
    const key = concertKey(c.show);
    assert.strictEqual(key, c.concertKey, 'concertKey');
    assert.strictEqual(meetupIdFor(key), c.meetupId, 'meetupId');
    assert.strictEqual(mediaPathSegment(key), c.mediaSegment, 'mediaSegment');
    assert.strictEqual(commentViewId(fixture.uid, key), c.commentViewId, 'commentViewId');
  } catch (e) {
    failed += 1;
    console.error(`✗ ${c.name}: ${e.message}`);
  }
}
assert.strictEqual(meetupIdFor(''), null, 'an empty key has no meetup');
if (failed) {
  console.error(`${failed} concert-key case(s) failed`);
  process.exit(1);
}
console.log(`✓ concert keys: ${fixture.cases.length} cases`);
