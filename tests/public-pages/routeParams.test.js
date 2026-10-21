/**
 * publicRouteParams: the handle / show id / collection id the public page
 * functions read from the request. Every shape Netlify may hand them — the
 * function sub-path the rewrites now use, the original /u/... path, rawUrl
 * only, and a direct call with query parameters.
 *
 *   node tests/public-pages/routeParams.test.js
 */

const { test, run } = require('../email/harness');
const assert = require('node:assert');
const { profileParams, showParams, sharedParams } = require('../../netlify/functions/lib/publicRouteParams');

test('profile: function sub-path from the rewrite', () => {
  assert.deepStrictEqual(profileParams({ path: '/.netlify/functions/public-profile/Phillip' }), { handle: 'phillip' });
});

test('profile: original path, with and without trailing slash', () => {
  assert.deepStrictEqual(profileParams({ path: '/u/phillip/' }), { handle: 'phillip' });
  assert.deepStrictEqual(profileParams({ path: '/u/phillip' }), { handle: 'phillip' });
});

test('profile: only rawUrl carries the path', () => {
  const event = { path: '/.netlify/functions/public-profile', rawUrl: 'https://mysetlists.net/u/jordanmills/?page=2' };
  assert.deepStrictEqual(profileParams(event), { handle: 'jordanmills' });
});

test('profile: direct call with ?handle= still works', () => {
  const event = { path: '/.netlify/functions/public-profile', queryStringParameters: { handle: ' Phillip ' } };
  assert.deepStrictEqual(profileParams(event), { handle: 'phillip' });
});

test('profile: nothing given is an empty handle (the function 404s)', () => {
  assert.deepStrictEqual(profileParams({ path: '/.netlify/functions/public-profile' }), { handle: '' });
});

test('profile: percent-encoding is decoded, a malformed escape is kept', () => {
  assert.deepStrictEqual(profileParams({ path: '/u/a%20b/' }), { handle: 'a b' });
  assert.deepStrictEqual(profileParams({ path: '/u/a%E0/' }), { handle: 'a%e0' });
});

test('profile: a show path is not mistaken for a profile', () => {
  assert.deepStrictEqual(profileParams({ path: '/u/phillip/shows/abc' }), { handle: '' });
});

test('show: function sub-path and original path', () => {
  assert.deepStrictEqual(showParams({ path: '/.netlify/functions/public-show/Phillip/abc123' }), { handle: 'phillip', showId: 'abc123' });
  assert.deepStrictEqual(showParams({ path: '/u/phillip/shows/abc123/' }), { handle: 'phillip', showId: 'abc123' });
});

test('show: show id keeps its case', () => {
  assert.deepStrictEqual(showParams({ path: '/u/phillip/shows/AbC/' }), { handle: 'phillip', showId: 'AbC' });
});

test('show: direct call with query parameters', () => {
  const event = { path: '/.netlify/functions/public-show', queryStringParameters: { handle: 'phillip', showId: 'x' } };
  assert.deepStrictEqual(showParams(event), { handle: 'phillip', showId: 'x' });
});

test('shared: function sub-path, original path, and query', () => {
  assert.deepStrictEqual(sharedParams({ path: '/.netlify/functions/public-shared/k9X' }), { id: 'k9X' });
  assert.deepStrictEqual(sharedParams({ path: '/shared/k9X/' }), { id: 'k9X' });
  assert.deepStrictEqual(sharedParams({ path: '/.netlify/functions/public-shared', queryStringParameters: { id: 'k9X' } }), { id: 'k9X' });
  assert.deepStrictEqual(sharedParams({ path: '/.netlify/functions/public-shared' }), { id: '' });
});

run('publicRouteParams');
