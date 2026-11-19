/**
 * Reporting and blocking — the other three quarters of App Store
 * Guideline 1.2 (the filter in lib/contentFilter.js is the first).
 *
 * Guideline 1.2 wants four things from an app with user-generated
 * content, and until now this app shipped exactly one of them (published
 * contact information, via the feedback page and the support address in
 * the Terms). This module is the data layer for the other three:
 *
 *   - report offensive content, with a route to action inside 24 hours
 *   - block abusive users
 *   - filter objectionable material before it is published
 *
 * ── WHERE THE DATA LIVES ────────────────────────────────────────────────
 *
 * `reports/{contentId}_{reporterId}`
 *   One report per user per item, enforced by the deterministic id rather
 *   than by a query — a second report from the same person overwrites
 *   their first instead of inflating the count that triggers auto-hide.
 *   Created by netlify/functions/report-content.js, never by the client:
 *   the count and the auto-hide have to be server-side or the threshold
 *   means nothing.
 *
 * `userBlocks/{uid}` -> { userId, blockedUserIds: [] }
 *   NOT on userProfiles, which is the app's user document but is readable
 *   by every signed-in user. A block list on a world-readable document
 *   tells the person you blocked that you blocked them, which is the one
 *   thing a block must never do. Same owner-only, uid-keyed shape as
 *   favoriteTours, including the docId pin that stops one user writing to
 *   another user's document.
 *
 *   (The Guideline 1.2 brief called for `users/{uid}.blockedUserIds`.
 *   `users/{uid}` has no root document in this app — user data hangs off
 *   subcollections and `userProfiles` — and putting the list on
 *   `userProfiles` would leak it, so it lives here instead. It is still a
 *   plain array loaded once into AppContext, which is what the rest of
 *   the brief depends on.)
 *
 * `userProfiles/{uid}.banned`
 *   A ban has to be readable by firestore.rules to be enforceable there,
 *   so unlike a block it does belong on the public profile document.
 *
 * `moderationHidden/{collection}_{docId}`
 *   Content pulled out of circulation pending review — see below.
 *
 * ── WHY AUTO-HIDE MOVES THE DOCUMENT INSTEAD OF FLAGGING IT ─────────────
 *
 * The obvious design is `hidden: true` on the content document. It does
 * not survive contact with Firestore, for two reasons that compound:
 *
 *   1. Rules are not filters. A query fails outright if ANY document it
 *      returns fails the read rule — so the moment one hidden comment
 *      exists on a show, an "only the author and admins may read hidden
 *      content" rule breaks the whole thread for everyone, rather than
 *      quietly omitting one row.
 *   2. Adding `where('hidden', '==', false)` to the queries fixes that
 *      only for documents that HAVE the field. Every comment, photo and
 *      caption already in production predates it, and both `== false` and
 *      `!= true` exclude documents where the field is absent — so
 *      shipping the filter would make every existing comment in the app
 *      vanish until a backfill caught up.
 *
 * So an auto-hidden document is copied into `moderationHidden` (admin-read
 * only) and deleted from its own collection. It drops out of every query
 * because it is genuinely no longer there, no backfill is needed, no query
 * changes, and "hidden content is not readable by third parties" is
 * enforced by the rule on one collection instead of by a condition on
 * five. Dismissing a report restores the document, with its original id,
 * from the copy.
 *
 * The trade against the flag design is that the author cannot see their
 * own content while it is under review. That is the same thing every
 * report-and-review system does, and the 24-hour commitment in the
 * Community Guidelines is what bounds it.
 */

import {
  collection, doc, getDoc, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { callFriends } from '@/lib/friendsApi';

// ── Reports ─────────────────────────────────────────────────────────────

// Reason options offered in ReportModal. `requiresDetails` is what makes
// "Other" ask for free text — a report with no reason and no detail is
// not actionable inside 24 hours, which is the whole commitment.
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam or scam' },
  { id: 'harassment', label: 'Harassment or hate' },
  { id: 'sexual', label: 'Sexual content' },
  { id: 'violence', label: 'Violence or threats' },
  { id: 'impersonation', label: 'Copyright or impersonation' },
  { id: 'other', label: 'Something else', requiresDetails: true },
];

export const REPORT_REASON_LABELS = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.id, r.label]),
);

// The content types that can be reported, and the collection each one
// lives in. The server uses this same map (its own copy, in
// netlify/functions/report-content.js) to decide what it is allowed to
// hide — a client cannot name an arbitrary collection and have the
// function delete out of it.
export const REPORTABLE_TYPES = {
  showComment: { collection: 'showComments', label: 'Comment' },
  meetupComment: { collection: 'meetupComments', label: 'Meetup message' },
  showMedia: { collection: 'showPhotos', label: 'Photo or video' },
  profile: { collection: 'userProfiles', label: 'Profile' },
  meetup: { collection: 'meetups', label: 'Meetup details' },
};

// Distinct open reports that pull an item out of circulation on their own.
// Three rather than one because a single report is as often a
// disagreement as a violation, and rather than five because three people
// independently flagging the same comment is already a strong signal and
// waiting longer means more people see it.
export const AUTO_HIDE_THRESHOLD = 3;

/**
 * One report per user per item. The id is deterministic so a second
 * submission from the same person replaces their first rather than
 * counting twice toward AUTO_HIDE_THRESHOLD — enforced by the shape of
 * the key rather than by a read-then-write the client could race.
 */
export function reportDocId(contentId, reporterId) {
  return `${contentId}_${reporterId}`;
}

/**
 * File a report. Goes through the Netlify function rather than writing
 * Firestore directly, because everything that makes a report useful —
 * counting distinct reporters, hiding at the threshold, and emailing the
 * admin so the 24-hour commitment is possible — has to happen somewhere
 * the reporter cannot skip.
 *
 * @returns {Promise<{ hidden: boolean, reportCount: number }>}
 */
export async function submitReport({
  contentType, contentId, contentSnapshot, reportedUserId, reason, details,
}) {
  if (!REPORTABLE_TYPES[contentType]) {
    throw new Error(`Unknown content type: ${contentType}`);
  }
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('You need to be signed in to report something.');

  const res = await fetch(apiUrl('/api/report-content'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contentType, contentId, contentSnapshot, reportedUserId, reason, details,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || "Couldn't send that report. Please try again.");
  }
  return payload;
}

/**
 * Open reports, oldest first — the admin queue's backing query. Oldest
 * first is deliberate and is the whole point of the 24-hour SLA: newest
 * first buries the report that is closest to breaching it.
 */
export function subscribeOpenReports(callback) {
  const q = query(
    collection(db, 'reports'),
    where('status', '==', 'open'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[moderation] Report listener failed:', err.code || err.message, err);
    callback([], err);
  });
}

/**
 * Resolve a report from the admin queue.
 *
 * @param {string} reportId
 * @param {'dismiss'|'delete'|'ban'} action
 *   dismiss — restore the content if it was auto-hidden, close the report
 *   delete  — destroy the content for good, close the report
 *   ban     — delete, and set `banned` on the author so they cannot write
 */
export async function resolveReport(reportId, action) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(apiUrl('/api/moderate-report'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reportId, action }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'That action failed. Please try again.');
  return payload;
}

// ── Blocking ────────────────────────────────────────────────────────────

/**
 * Live view of the current user's block list. A listener rather than a
 * one-time read so a block taken on one device hides that user's content
 * on another without a reload — and so AppContext can filter from a
 * single source instead of each render site reading Firestore.
 */
export function subscribeBlocks(uid, callback) {
  if (!uid) {
    callback([]);
    return () => {};
  }
  return onSnapshot(doc(db, 'userBlocks', uid), (snap) => {
    callback(snap.exists() ? (snap.data().blockedUserIds || []) : []);
  }, (err) => {
    console.error('[moderation] Block listener failed:', err.code || err.message, err);
    // An empty list is the safe failure: content stays visible, which is
    // wrong but recoverable, where a stuck spinner is neither.
    callback([]);
  });
}

/**
 * Block a user.
 *
 * Two writes, and the second is the one Guideline 1.2 actually cares
 * about. Adding them to the block list hides their content from you.
 * Removing the friendship in BOTH directions is what stops them reaching
 * you at all — a blocked friend would otherwise keep tagging you at shows,
 * seeing you in their activity feed, and appearing in your tag picker.
 *
 * The friends rule (`users/{userId}/friends/{friendId}`) already allows
 * either party to write the edge, so the blocker can remove themselves
 * from the blocked user's list without any rule change and without the
 * blocked user being told why.
 */
/**
 * Block and unblock go through the server (5.60.27, Stage 2 C-7):
 * netlify/functions/friends.js `block` writes the caller's userBlocks list,
 * ends the friendship on both sides, removes friend requests and show tags
 * either way and the blocked user from your upcoming shows, and records
 * the block for the moderation queue (lib/blockNotice.js), without telling
 * the blocked user. Since 5.60.11 the app never writes another user's
 * documents (CLAUDE.md); this was the last place the web did.
 *
 * Unblocking doesn't restore the friendship: re-adding someone you blocked
 * is a decision they get a say in, so it goes back through a request.
 * `uid` is the caller; the server takes it from the ID token.
 */
export async function blockUser(uid, targetUid) {
  if (!uid || !targetUid || uid === targetUid) return;
  await callFriends('block', { targetUid });
}

export async function unblockUser(uid, targetUid) {
  if (!uid || !targetUid) return;
  await callFriends('unblock', { targetUid });
}

/**
 * Profiles for the Blocked accounts list in Settings. Blocks are stored
 * as bare uids — everything else about the blocked user is deliberately
 * not copied, so unblocking cannot be defeated by stale data.
 */
export async function loadBlockedProfiles(blockedUserIds) {
  const ids = blockedUserIds || [];
  const snaps = await Promise.all(
    ids.map((id) => getDoc(doc(db, 'userProfiles', id)).catch(() => null)),
  );
  return ids.map((id, i) => {
    const snap = snaps[i];
    const data = snap && snap.exists() ? snap.data() : {};
    return {
      uid: id,
      displayName: data.displayName || 'Deleted account',
      handle: data.handle || null,
      photoURL: data.photoURL || '',
    };
  });
}

// ── Shared filtering ────────────────────────────────────────────────────

/**
 * Drop anything authored by a blocked user.
 *
 * Exported and used from AppContext's selectors rather than at each
 * render site, so a new surface that forgets to filter is the exception
 * rather than the default. `authorField` differs by collection —
 * comments use authorUid, media uses uploadedBy, activity uses userId —
 * so callers name it rather than this guessing.
 */
export function withoutBlocked(items, blockedUserIds, authorField = 'authorUid') {
  if (!blockedUserIds || blockedUserIds.length === 0) return items || [];
  const blocked = new Set(blockedUserIds);
  return (items || []).filter((item) => !blocked.has(item?.[authorField]));
}
