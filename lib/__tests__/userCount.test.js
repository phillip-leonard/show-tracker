/**
 * No user count outside the admin portal until 1,000 users (5.60.1), and
 * Community back in the sidebar.
 *
 * Run with:
 *   node --experimental-loader ./lib/__tests__/alias-loader.mjs lib/__tests__/userCount.test.js
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { shouldShowUserCount, USER_COUNT_MIN_USERS } from '@/lib/userCount';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the threshold is 1,000 users (the landing page rule since 00e2a82)', () => {
  assert.strictEqual(USER_COUNT_MIN_USERS, 1000);
  assert.strictEqual(shouldShowUserCount(999), false);
  assert.strictEqual(shouldShowUserCount(1000), true);
  assert.strictEqual(shouldShowUserCount(34), false);
  for (const unknown of [undefined, null, '', 'many', NaN]) assert.strictEqual(shouldShowUserCount(unknown), false, String(unknown));
});

test('every user-count display goes through shouldShowUserCount', () => {
  const uses = {
    'components/CommunityStatsView.jsx': ['shouldShowUserCount(communityStats.totalUsers) && (', 'label="Total Users"'],
    'components/LandingPage.jsx': ['const showCommunityCounts = shouldShowUserCount(totalUsers);'],
    'components/profile/ProfileView.js': ['userRank && shouldShowUserCount(totalUsers) ? `of ${userRank.total}`'],
    'components/discover/DiscoverView.jsx': ['const showFanCounts = shouldShowUserCount(communityStats?.totalUsers);', 'showFanCounts ? `${r.topCo}'],
    'components/discover/FansAlsoSee.jsx': ['const showFanCounts = shouldShowUserCount(communityStats?.totalUsers);', 'showFanCounts ? `${c.co}'],
  };
  for (const [file, needles] of Object.entries(uses)) {
    const src = read(file);
    for (const n of needles) assert.ok(src.includes(n), `${file}: ${n}`);
  }
  assert.ok(!read('components/LandingPage.jsx').includes('COMMUNITY_COUNTS_MIN_USERS'), 'one threshold, not two');
});

test('below the threshold the number is gone, with no stand-in wording', () => {
  const discover = read('components/discover/DiscoverView.jsx');
  assert.ok(discover.includes(': `${r.topSeed} fans see them often`'), 'same sentence, no number');
  const view = read('components/CommunityStatsView.jsx');
  for (const vague of ['growing community', 'lots of', 'many fans', 'hundreds']) assert.ok(!view.toLowerCase().includes(vague), vague);
});

test('sidebar: Community sits after Stats; Tours → Festivals → Wishlist keep their order; 44pt on touch', () => {
  const sb = read('components/layout/Sidebar.jsx');
  const at = (id) => sb.indexOf(`id: '${id}'`);
  assert.ok(at('stats') < at('community') && at('community') < at('discover'), 'after Stats');
  assert.ok(at('tours') < at('festivals') && at('festivals') < at('wishlist'));
  assert.ok(sb.includes("{ id: 'community', label: 'Community', icon: Users, href: '/community' },"));
  assert.ok(!/!isGuest && \{ id: 'community'/.test(sb), 'guests see it too');
  assert.ok(sb.includes('min-h-[44px] md:fine:min-h-0'), 'navItem is 44pt on touch');
  assert.ok(/onClick=\{onClose\}/.test(sb), 'the drawer closes on tap');
});

test('Community: names open the report/block sheet; guests can view; empty boards say so', () => {
  const view = read('components/CommunityStatsView.jsx');
  assert.strictEqual((view.match(/<UserLink uid=\{entryUid\(user\)\}/g) || []).length, 2, 'both people lists');
  assert.ok(view.includes('<EmptyBoard />'));
  const page = read('app/community/page.jsx');
  assert.ok(!page.includes('if (guestMode) return null'), 'guests are not shown a blank page');
  assert.ok(page.includes("guestMode ? () => openAuthModal('signup') : sendFriendRequest"));
  assert.ok(read('components/LandingPage.jsx').includes('<Link href="/community" onClick={() => onGuest?.()}>Community</Link>'));
});

test('leaderboard opt-out: a Profile setting, read by the server', () => {
  const profile = read('components/profile/ProfileView.js');
  assert.ok(profile.includes('Show me on the community leaderboard'));
  assert.ok(profile.includes("updateDoc(doc(db, 'userProfiles', user.uid), { showOnLeaderboard: newValue })"));
  assert.ok(profile.includes("setShowOnLeaderboard(profile.data().showOnLeaderboard !== false)"), 'on by default');
});

for (const t of tests) {
  try { await t.fn(); passed++; } catch (err) { failed++; console.error(`✗ ${t.name}\n  ${err.message}`); }
}
console.log(`\nuserCount: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
