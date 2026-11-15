/**
 * Guest → account, against the Firebase Auth emulator (5.60.13, native app
 * Part 2). The server and the rules decide "guest" from the token
 * (firebase.sign_in_provider 'anonymous' AND no identities) and from Auth
 * user records (no providerData). This checks what real tokens say:
 *
 *   - a fresh anonymous sign-in is a guest, in the token and in Auth
 *   - after linking email or Google, the refreshed token is not, and
 *     neither is the Auth record, with the same uid
 *   - the token the SDK holds right after link(), before any forced
 *     refresh, is not a guest either
 *   - listAnonymousUids finds the guests and only them
 *
 * Run with:
 *   npm run test:auth-emulator
 *
 * The Auth emulator is Node, so this runs without Java. Nothing here
 * touches production.
 */

const assert = require('node:assert');
const { initializeApp } = require('firebase/app');
const {
  getAuth, connectAuthEmulator, signInAnonymously, linkWithCredential,
  EmailAuthProvider, GoogleAuthProvider, signOut,
} = require('firebase/auth');
const admin = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { isAnonymous, isAnonymousAuthUser, listAnonymousUids } = require('../../netlify/functions/lib/firebaseAdmin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-anonymous-link';
const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_AUTH_EMULATOR_HOST = HOST;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

async function main() {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT_ID, authDomain: `${PROJECT_ID}.firebaseapp.com` });
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}`, { disableWarnings: true });
  admin.initializeApp({ projectId: PROJECT_ID });
  const adminAuth = getAdminAuth();
  const verify = async (user, force) => adminAuth.verifyIdToken(await user.getIdToken(force));

  const seen = {};

  await test('a fresh anonymous sign-in is a guest, in the token and in Auth', async () => {
    const { user } = await signInAnonymously(auth);
    const decoded = await verify(user, false);
    seen.guestProvider = decoded.firebase.sign_in_provider;
    assert.strictEqual(decoded.firebase.sign_in_provider, 'anonymous');
    assert.deepStrictEqual(decoded.firebase.identities || {}, {});
    assert.strictEqual(isAnonymous(decoded), true);
    assert.strictEqual(isAnonymousAuthUser(await adminAuth.getUser(user.uid)), true);
    seen.emailGuestUid = user.uid;
  });

  await test('linking email: same uid; the token held right after link() is no longer a guest', async () => {
    const user = auth.currentUser;
    const cred = EmailAuthProvider.credential('guest-linked@example.com', 'correct-horse-battery-9');
    const { user: linkedUser } = await linkWithCredential(user, cred);
    assert.strictEqual(linkedUser.uid, seen.emailGuestUid);
    const held = await verify(linkedUser, false);
    seen.afterLinkProvider = held.firebase.sign_in_provider;
    seen.afterLinkIdentities = Object.keys(held.firebase.identities || {});
    assert.strictEqual(isAnonymous(held), false, `held token: ${JSON.stringify(held.firebase)}`);
  });

  await test('linking email: the refreshed token and the Auth record are an account', async () => {
    const refreshed = await verify(auth.currentUser, true);
    seen.refreshedProvider = refreshed.firebase.sign_in_provider;
    assert.strictEqual(isAnonymous(refreshed), false);
    assert.ok(Object.keys(refreshed.firebase.identities || {}).length > 0, 'a linked account has an identity');
    assert.strictEqual(isAnonymousAuthUser(await adminAuth.getUser(seen.emailGuestUid)), false);
  });

  await test('linking Google: the same', async () => {
    await signOut(auth);
    const { user } = await signInAnonymously(auth);
    const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: 'google-sub-1', email: 'guest-google@example.com', email_verified: true }));
    const { user: linkedUser } = await linkWithCredential(user, cred);
    assert.strictEqual(linkedUser.uid, user.uid);
    const refreshed = await verify(linkedUser, true);
    seen.googleProvider = refreshed.firebase.sign_in_provider;
    assert.strictEqual(isAnonymous(refreshed), false);
    assert.strictEqual(isAnonymousAuthUser(await adminAuth.getUser(user.uid)), false);
  });

  await test('listAnonymousUids: the guests, and no linked account', async () => {
    await signOut(auth);
    const { user } = await signInAnonymously(auth);
    const uids = await listAnonymousUids(adminAuth);
    assert.ok(uids.has(user.uid));
    assert.ok(!uids.has(seen.emailGuestUid));
  });

  console.log(`\n  sign_in_provider seen: guest=${seen.guestProvider}, right after email link=${seen.afterLinkProvider} (identities: ${seen.afterLinkIdentities}), refreshed=${seen.refreshedProvider}, Google link refreshed=${seen.googleProvider}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
