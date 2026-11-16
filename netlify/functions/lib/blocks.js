/**
 * blocks — whether two people have blocked each other, from
 * userBlocks/{uid}.blockedUserIds (written only by friends.js block and
 * unblock, 5.60.27). friends.js and the engagement notifications share it.
 */

/** True if either has blocked the other. */
async function blockedBetween(db, a, b) {
  if (!a || !b) return false;
  const [sa, sb] = await Promise.all([db.doc(`userBlocks/${a}`).get(), db.doc(`userBlocks/${b}`).get()]);
  const list = (s) => (s.exists && Array.isArray(s.data().blockedUserIds) ? s.data().blockedUserIds : []);
  return list(sa).includes(b) || list(sb).includes(a);
}

module.exports = { blockedBetween };
