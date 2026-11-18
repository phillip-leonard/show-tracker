/**
 * send-test-push (5.60.30, Stage 3 C-7): admins by the claim alone, the
 * caller's own devices only, our links only, dead tokens removed.
 *
 *   node tests/security/sendTestPush.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { createFakeDb, createFakeAuth } = require('../email/fakeFirestore');
const { __setTestFirebase, hasAdminClaim } = require('../../netlify/functions/lib/firebaseAdmin');
const push = require('../../netlify/functions/send-test-push');

const ADMIN = { uid: 'adminUid000001', email: 'someone@example.com', admin: true };
// The allowlisted address without the claim: isAdmin() says yes; this tool says no.
const LISTED = { uid: 'listedUid00001', email: 'phillip.leonard@gmail.com', email_verified: true };
const USER = { uid: 'userUid0000001', email: 'user@example.com' };

let sent;
function setup({ failToken = null } = {}) {
  const db = createFakeDb();
  const auth = createFakeAuth({ tokens: { admin: ADMIN, listed: LISTED, user: USER }, users: [ADMIN, LISTED, USER] });
  __setTestFirebase({ db, auth });
  sent = [];
  push.__setTestSend(async (message) => {
    if (message.token === failToken) {
      const err = new Error('gone');
      err.code = 'messaging/registration-token-not-registered';
      throw err;
    }
    sent.push(message);
    return 'ok';
  });
  db._put('pushTokens/adminPhone', { userId: ADMIN.uid, platform: 'ios' });
  db._put('pushTokens/adminOldPhone', { userId: ADMIN.uid, platform: 'ios' });
  db._put('pushTokens/userPhone', { userId: USER.uid, platform: 'ios' });
  return db;
}

const call = (token, body) => push.handler({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body || {}),
});
const json = (res) => JSON.parse(res.body);

test('the admin claim alone: not the allowlisted address, not a user, not signed out', async () => {
  setup();
  assert.strictEqual(hasAdminClaim(ADMIN), true);
  assert.strictEqual(hasAdminClaim(LISTED), false);
  assert.strictEqual((await call(null, {})).statusCode, 401);
  assert.strictEqual((await call('user', {})).statusCode, 403);
  assert.strictEqual((await call('listed', {})).statusCode, 403);
  assert.strictEqual(sent.length, 0);
});

test('sends to the caller’s own devices only, with the link a tap opens', async () => {
  setup();
  const res = await call('admin', { link: '/shows/?show=s1' });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.deepStrictEqual(json(res), { devices: 2, reached: true, dead: 0 });
  assert.deepStrictEqual(sent.map((m) => m.token).sort(), ['adminOldPhone', 'adminPhone']);
  for (const m of sent) {
    assert.strictEqual(m.data.link, 'https://mysetlists.net/shows/?show=s1');
    assert.strictEqual(m.notification.title, 'MySetlists test push');
    assert.strictEqual(m.apns.payload.aps['thread-id'], 'test');
  }
});

test('the default link is the inbox; another site’s link is refused', async () => {
  setup();
  await call('admin', {});
  assert.strictEqual(sent[0].data.link, 'https://mysetlists.net/notifications/');
  for (const link of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)']) {
    assert.strictEqual((await call('admin', { link })).statusCode, 400, link);
  }
  assert.strictEqual(push.testLink('https://mysetlists.net/bands/?band=goose'), 'https://mysetlists.net/bands/?band=goose');
});

test('a dead token is deleted; no devices is not an error', async () => {
  const db = setup({ failToken: 'adminOldPhone' });
  const b = json(await call('admin', {}));
  assert.deepStrictEqual(b, { devices: 2, reached: true, dead: 1 });
  assert.strictEqual(db._get('pushTokens/adminOldPhone'), undefined);
  assert.ok(db._get('pushTokens/userPhone'), 'someone else’s token is untouched');
  db._store.delete('pushTokens/adminPhone');
  assert.deepStrictEqual(json(await call('admin', {})), { devices: 0, reached: false, dead: 0 });
});

run('send-test-push (5.60.30)');
