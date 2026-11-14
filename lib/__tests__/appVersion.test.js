/**
 * lib/appVersion.js — the iOS version comparison behind the update banner
 * and the minimum-version screen (5.59.10).
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/appVersion.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  parseVersion, compareVersions, versionStatus, validateVersionConfig, raisesMinimum, alwaysReachable,
} from '@/lib/appVersion';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('compareVersions: numeric, part by part (3.13.10 > 3.13.9)', () => {
  assert.strictEqual(compareVersions('3.13.10', '3.13.9'), 1);
  assert.strictEqual(compareVersions('3.13.9', '3.13.10'), -1);
  assert.strictEqual(compareVersions('3.13', '3.13.0'), 0);
  assert.strictEqual(compareVersions('4', '3.99.99'), 1);
  assert.strictEqual(compareVersions('3.13.7', '3.13.7'), 0);
  assert.strictEqual(compareVersions('3.13.x', '3.13.7'), null);
  assert.strictEqual(compareVersions('', '1'), null);
});

test('parseVersion', () => {
  assert.deepStrictEqual(parseVersion(' 3.13.10 '), [3, 13, 10]);
  assert.strictEqual(parseVersion('v3.13'), null);
  assert.strictEqual(parseVersion('1.2.3.4.5'), null);
});

test('versionStatus: blocked below the minimum, update below the latest', () => {
  const cfg = { min: '3.13.10', latest: '3.14' };
  assert.strictEqual(versionStatus({ current: '3.13.9', ...cfg }), 'blocked');
  assert.strictEqual(versionStatus({ current: '3.13.10', ...cfg }), 'update');
  assert.strictEqual(versionStatus({ current: '3.14', ...cfg }), 'ok');
  assert.strictEqual(versionStatus({ current: '3.15', ...cfg }), 'ok');
});

test('versionStatus: a missing or broken config never blocks anyone', () => {
  assert.strictEqual(versionStatus({ current: '3.13.10' }), 'ok');
  assert.strictEqual(versionStatus({ current: '3.13.10', min: 'soon', latest: '' }), 'ok');
  assert.strictEqual(versionStatus({ current: undefined, min: '9.9', latest: '9.9' }), 'ok', 'unknown build version');
  assert.strictEqual(versionStatus({}), 'ok');
});

test('validateVersionConfig and raisesMinimum (the admin confirmation)', () => {
  assert.strictEqual(validateVersionConfig({ min: '3.13.10', latest: '3.14' }), null);
  assert.match(validateVersionConfig({ min: '3.15', latest: '3.14' }), /higher than the latest/);
  assert.match(validateVersionConfig({ min: 'x', latest: '3.14' }), /minimum/);
  assert.ok(raisesMinimum('3.13.7', '3.13.10'));
  assert.ok(!raisesMinimum('3.13.10', '3.13.10'));
  assert.ok(!raisesMinimum('3.13.10', '3.13.7'), 'lowering needs no confirmation');
  assert.ok(raisesMinimum(undefined, '3.13.10'), 'setting it for the first time does');
});

test('Profile (account deletion) is always reachable', () => {
  assert.ok(alwaysReachable('/profile/'));
  assert.ok(alwaysReachable('/profile'));
  assert.ok(!alwaysReachable('/shows/'));
  assert.ok(!alwaysReachable('/profiles-of-others/'));
});

test('VersionGate: native only, checks on launch and resume, never covers Profile', () => {
  const src = fs.readFileSync(path.join(ROOT, 'components/layout/VersionGate.jsx'), 'utf8');
  assert.ok(src.includes('if (!isNativePlatform()) return undefined;'), 'no-op on the web');
  assert.ok(src.includes("App.addListener('resume', check)"));
  assert.ok(src.includes('App.getInfo()'));
  assert.ok(src.includes("state.status === 'blocked' && !alwaysReachable(pathname)"));
  assert.ok(src.includes('href="/profile/"'), 'the blocking screen links to account deletion');
  const wrapper = fs.readFileSync(path.join(ROOT, 'app/AppProviderWrapper.jsx'), 'utf8');
  assert.ok(wrapper.indexOf('<VersionGate />') < wrapper.indexOf('<AppShell>{children}</AppShell>'), 'mounted outside the auth gate');
});

test('firestore.rules: config/app readable by all, admin-only writes, versions validated', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const block = rules.slice(rules.indexOf('match /config/app {'));
  assert.ok(block.includes('allow read: if true;'));
  assert.ok(block.includes('allow create, update: if isAdmin()'));
  assert.ok(block.includes('allow delete: if false;'));
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nappVersion: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
