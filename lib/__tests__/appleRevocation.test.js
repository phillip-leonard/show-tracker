/**
 * Unit tests for lib/appleRevocation.js — the Apple token account deletion
 * sends so delete-account can revoke it (B-11, 5.59.8).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/appleRevocation.test.js
 */

import assert from 'assert';
import { appleTokenForDeletion, appleProviderUid, jwtSubject } from '@/lib/appleRevocation';

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (payload) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;

const APPLE_USER = { uid: 'u1', providerData: [{ providerId: 'apple.com', uid: '001234.abc' }] };
const GOOGLE_USER = { uid: 'u2', providerData: [{ providerId: 'google.com', uid: 'g1' }] };
const plugin = (credential) => ({ calls: [], async signInWithApple(opts) { this.calls.push(opts); return { credential }; } });

test('appleProviderUid: Apple uid, or null for other accounts', () => {
  assert.strictEqual(appleProviderUid(APPLE_USER), '001234.abc');
  assert.strictEqual(appleProviderUid(GOOGLE_USER), null);
  assert.strictEqual(appleProviderUid(null), null);
});

test('jwtSubject: reads sub, tolerates junk', () => {
  assert.strictEqual(jwtSubject(jwt({ sub: '001234.abc' })), '001234.abc');
  assert.strictEqual(jwtSubject('nope'), '');
  assert.strictEqual(jwtSubject(undefined), '');
});

test('not an Apple account → null, and no Apple sheet', async () => {
  const p = plugin({});
  assert.strictEqual(await appleTokenForDeletion(GOOGLE_USER, { isNative: true, plugin: p }), null);
  assert.strictEqual(p.calls.length, 0);
});

test('iOS: returns the authorization code as tokenType CODE', async () => {
  const p = plugin({ authorizationCode: 'code-1', idToken: jwt({ sub: '001234.abc' }) });
  assert.deepStrictEqual(await appleTokenForDeletion(APPLE_USER, { isNative: true, plugin: p }), { tokenType: 'CODE', token: 'code-1' });
  assert.deepStrictEqual(p.calls[0], { skipNativeAuth: true });
});

test('iOS: a different Apple ID on the device is skipped, not revoked', async () => {
  const p = plugin({ authorizationCode: 'code-2', idToken: jwt({ sub: 'someone.else' }) });
  assert.deepStrictEqual(await appleTokenForDeletion(APPLE_USER, { isNative: true, plugin: p }), { skipped: 'different_apple_id' });
});

test('iOS: no code → skipped', async () => {
  const p = plugin({ idToken: jwt({ sub: '001234.abc' }) });
  assert.deepStrictEqual(await appleTokenForDeletion(APPLE_USER, { isNative: true, plugin: p }), { skipped: 'no_code' });
});

test('iOS: cancelling the sheet throws apple/cancelled', async () => {
  const p = { async signInWithApple() { const e = new Error('The user canceled the sign-in flow.'); e.code = '1001'; throw e; } };
  await assert.rejects(appleTokenForDeletion(APPLE_USER, { isNative: true, plugin: p }), (e) => e.code === 'apple/cancelled');
});

test('iOS: any other Apple failure → skipped, deletion goes ahead', async () => {
  const p = { async signInWithApple() { const e = new Error('Apple unavailable'); e.code = 'ERROR_UNKNOWN'; throw e; } };
  assert.deepStrictEqual(await appleTokenForDeletion(APPLE_USER, { isNative: true, plugin: p }), { skipped: 'ERROR_UNKNOWN' });
});

test('web: popup closed → apple/cancelled; user mismatch → skipped', async () => {
  const closed = async () => { const e = new Error('closed'); e.code = 'auth/popup-closed-by-user'; throw e; };
  await assert.rejects(appleTokenForDeletion(APPLE_USER, { isNative: false, reauthenticateWithPopup: closed }), (e) => e.code === 'apple/cancelled');
  const mismatch = async () => { const e = new Error('mismatch'); e.code = 'auth/user-mismatch'; throw e; };
  assert.deepStrictEqual(await appleTokenForDeletion(APPLE_USER, { isNative: false, reauthenticateWithPopup: mismatch }), { skipped: 'auth/user-mismatch' });
});

for (const t of tests) {
  try {
    await t.fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${t.name}\n  ${err.message}`);
  }
}
console.log(`\nappleRevocation: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
