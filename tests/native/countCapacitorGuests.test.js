/**
 * scripts/count-capacitor-guests.js: which guest sessions would lose shows
 * when the native app replaces the Capacitor app (TESTFLIGHT.md, Q-02).
 *
 *   node tests/native/countCapacitorGuests.test.js
 */
const assert = require('node:assert');
const { countGuests, isIosApp } = require('../../scripts/count-capacitor-guests');

const APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

assert.ok(isIosApp(APP), 'the WebView has no Safari token');
assert.ok(!isIosApp(SAFARI) && !isIosApp(MAC) && !isIosApp(undefined));

const now = Date.UTC(2026, 10, 20);
const day = 86400000;
const at = (daysAgo) => ({ toMillis: () => now - daysAgo * day });
const c = countGuests([
  { converted: true, showsAdded: 9, userAgent: APP, startedAt: at(1) },
  { converted: false, showsAdded: 0, userAgent: APP, startedAt: at(1) },
  { converted: false, showsAdded: 3, userAgent: SAFARI, startedAt: at(1) },
  { converted: false, showsAdded: 2, userAgent: APP, startedAt: at(10) },
  { converted: false, showsAdded: '5', userAgent: APP, startedAt: at(60) },
  { converted: false, showsAdded: 1, userAgent: APP, startedAt: at(400) },
  null,
], now);
assert.deepStrictEqual(c, { total: 7, unconverted: 5, withShows: 4, iosApp: 3, iosAppShows: 8, iosAppLast30d: 1, iosAppLast90d: 2 });
console.log('  ✓ count-capacitor-guests counts only unconverted app guests with shows');
