/**
 * The 5.60.12 data cleanup before the native app: the pure parts of
 * scripts/normalize-tag-dates.js and scripts/scrub-friend-request-emails.js.
 *
 *   node tests/security/dataCleanup.test.js
 *
 * Nothing here reaches a network or a database.
 */

const assert = require('assert');
const { planTagDateFix, senderShowLookup } = require('../../scripts/normalize-tag-dates');
const { emailFieldsOf } = require('../../scripts/scrub-friend-request-emails');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const tag = (date, extra = {}) => ({ fromUid: 'sender', status: 'pending', showData: { artist: 'Goose', date, setlistfmId: 'abc', ...extra } });

test('tag dates: ISO is left alone, unambiguous DD-MM-YYYY is rewritten', async () => {
  assert.deepStrictEqual(await planTagDateFix(tag('2025-05-28')), { action: 'keep', shape: 'iso' });
  assert.deepStrictEqual(await planTagDateFix(tag('28-05-2025')), { action: 'fix', shape: 'dd-mm-yyyy', to: '2025-05-28' });
});

test('tag dates: an ambiguous date is settled by the sender\'s own show first', async () => {
  let setlistfmAsked = 0;
  const senderLookup = senderShowLookup(async (uid) => (uid === 'sender' ? [{ setlistfmId: 'abc', date: '2024-04-03' }] : []));
  const lookupSetlistDate = async () => { setlistfmAsked++; return '2024-03-04'; };
  assert.deepStrictEqual(await planTagDateFix(tag('03-04-2024'), { senderLookup, lookupSetlistDate }),
    { action: 'fix', shape: 'ambiguous', to: '2024-04-03' });
  assert.strictEqual(setlistfmAsked, 0, 'setlist.fm is not asked when the sender\'s show answers');
});

test('tag dates: setlist.fm when the sender has no matching show; review when nobody can say', async () => {
  const senderLookup = senderShowLookup(async () => [{ setlistfmId: 'other', date: '2024-04-03' }]);
  assert.deepStrictEqual(await planTagDateFix(tag('03-04-2024'), { senderLookup, lookupSetlistDate: async () => '2024-03-04' }),
    { action: 'fix', shape: 'ambiguous', to: '2024-03-04' });
  assert.strictEqual((await planTagDateFix(tag('03-04-2024'), { senderLookup, lookupSetlistDate: async () => null })).action, 'review');
  assert.strictEqual((await planTagDateFix(tag('03-04-2024'), { senderLookup })).action, 'review', 'no setlist.fm key: never guessed');
});

test('tag dates: a sender whose shows can\'t be read falls through to setlist.fm', async () => {
  const senderLookup = senderShowLookup(async () => { throw new Error('denied'); });
  assert.deepStrictEqual(await planTagDateFix(tag('03-04-2024'), { senderLookup, lookupSetlistDate: async () => '2024-04-03' }),
    { action: 'fix', shape: 'ambiguous', to: '2024-04-03' });
});

test('tag dates: each sender\'s shows are read once', async () => {
  let reads = 0;
  const senderLookup = senderShowLookup(async () => { reads++; return [{ setlistfmId: 'abc', date: '2024-04-03' }]; });
  await planTagDateFix(tag('03-04-2024'), { senderLookup });
  await planTagDateFix(tag('03-04-2024'), { senderLookup });
  assert.strictEqual(reads, 1);
});

test('tag dates: a tag with no showData goes to review, never throws', async () => {
  assert.strictEqual((await planTagDateFix({ status: 'pending' })).action, 'review');
});

test('friend requests: both address fields are found, present or empty', () => {
  assert.deepStrictEqual(emailFieldsOf({ from: 'a', fromEmail: 'x@y.z', toEmail: '' }), ['fromEmail', 'toEmail']);
  assert.deepStrictEqual(emailFieldsOf({ from: 'a', to: 'b', status: 'pending' }), []);
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
  }
  console.log(`dataCleanup: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
