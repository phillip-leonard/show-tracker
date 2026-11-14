// lib/userCount.js — when the app may show how many people use it (5.60.1).
//
// Decision (2026-11-14): never show the number of users anywhere outside
// the admin portal until there are 1,000 of them. Below that, the number
// is hidden entirely, with no vague wording in its place ("a growing
// community", "lots of fans"). Show counts, song counts and the Top
// Show-Goers / Top Raters lists are not user counts and stay visible.
//
// The threshold is the one the landing page has used since 00e2a82
// ("show community counts only at 1,000+ users"). `totalUsers` is
// communityStats/global.totalUsers: real accounts, test users left out.
// Unknown (not loaded yet) counts as below the threshold.
//
// Every user-count display goes through shouldShowUserCount:
//   components/CommunityStatsView.jsx   "Total Users" tile
//   components/LandingPage.jsx          "N+ fans" line and stats tile
//   components/profile/ProfileView.js   rank card's "of N"
//   components/discover/DiscoverView.jsx, FansAlsoSee.jsx
//                                       "N <band> fans see them often"
// lib/__tests__/userCount.test.js fails if a known display stops using it.
//
// CommonJS, like lib/venueCount.js, so server code can use it too.

const USER_COUNT_MIN_USERS = 1000;

function shouldShowUserCount(totalUsers) {
  const n = Number(totalUsers);
  return Number.isFinite(n) && n >= USER_COUNT_MIN_USERS;
}

module.exports = { shouldShowUserCount, USER_COUNT_MIN_USERS };
