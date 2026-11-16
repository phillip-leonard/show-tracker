/**
 * showSocialActions — tags and suggestion answers, as `friends.js`
 * actions (5.60.29, Stage 3 C-2 and C-3). Until now the browser wrote
 * these documents itself: tags into `showTags` / `pendingEmailTags`,
 * answers into another person's `showSuggestions` document. Now the
 * server writes them, after checking who may, and builds what a tag
 * carries from the tagger's own stored show, never from the request.
 *
 *   tag                {showId | upcomingId, friendUids?: [], emails?: [{email, name?, message?}]}
 *                      → {tagged: [uid], skipped: [uid], emailTags: n}
 *   respondTag         {tagId, response: 'accepted' | 'declined'}
 *                      | {pendingEmailTagId, response: 'declined'}
 *                      → {tagStatus, upcomingId?, duplicate?}
 *                      Accepting a *past* show's tag stays normalize-show
 *                      (kind 'tag'); here it's 409 `use_normalize_show`. An
 *                      upcoming tag whose date has passed is 409
 *                      `date_passed` (the app adds it as a past show).
 *   revokeTag          {tagId} | {upcomingId, toUid?}  → {revoked: n}
 *   refreshUpcomingTags {upcomingId}                   → {updated: n}
 *   respondSuggestion  {suggestionId, response: 'confirmed' | 'declined'}
 *                      → {overallStatus, nudged}
 *
 * Tags go only to mutual friends with no block either way. Emails go
 * through lib/emailAuthorization.js and lib/notificationDelivery.js, as
 * send-email would send them; an email that can't go never undoes the tag.
 */

const { authorizeEmail } = require('./emailAuthorization');
const { deliverAuthorized } = require('./notificationDelivery');
const { normalizeEmail, isValidEmail } = require('./unsubscribeToken');
const { takeDailyQuota } = require('./rateLimit');
const {
  upcomingTagShowData, upcomingInputFromTag, validateUpcomingInput, findDuplicateUpcoming,
  newUpcomingRecord, todayIso,
} = require('../../../lib/upcomingShows');

// Tags written per user per UTC day (each names its sender to someone).
const TAGS_PER_DAY = 200;
// People one tag action can name.
const MAX_TAG_PEOPLE = 50;
const MAX_EMAIL_TAGS = 10;

/** The copy of a past show a tag carries: event facts, never notes or ratings. */
function pastTagShowData(show) {
  return {
    artist: show.artist || '',
    venue: show.venue || '',
    date: show.date || '',
    city: show.city || '',
    tour: show.tour || '',
    setlistfmId: show.setlistfmId || null,
    setlistfmUrl: show.setlistfmUrl || null,
    isManual: show.isManual || false,
    setlist: (Array.isArray(show.setlist) ? show.setlist : []).map((song) => ({
      id: String((song && song.id) || ''),
      name: String((song && song.name) || ''),
    })),
  };
}

/**
 * The suggestion's state after `me` answers. Declining ends it; it's
 * confirmed once both have said yes.
 */
function nextSuggestionStatus(suggestion, me, response) {
  const other = (suggestion.participants || []).find((u) => u !== me);
  const theirs = (suggestion.responses || {})[other];
  if (response === 'declined') return 'declined';
  return theirs === 'confirmed' ? 'confirmed' : 'partially_confirmed';
}

module.exports = function showSocialActions({ refuse, docId, blockedBetween, mutualFriends, getProfile, profileName }) {
  /** Sends one already-authorized kind of email; never throws. */
  async function emailRecord(db, auth, caller, request) {
    try {
      const now = Date.now();
      const decision = await authorizeEmail({ db, auth, now }, caller, request);
      if (!decision.ok) return decision.reason || 'refused';
      const outcome = await deliverAuthorized({ db, now }, caller, decision);
      if (outcome.sent) return 'sent';
      return outcome.skipped || outcome.message || 'not sent';
    } catch (e) {
      console.warn(`[friends] ${request.type} email failed:`, e.message);
      return 'not sent';
    }
  }

  /** The caller's own past or upcoming show named by the request. */
  async function ownShow(db, uid, body) {
    const hasShow = typeof body.showId === 'string' && body.showId !== '';
    const hasUpcoming = typeof body.upcomingId === 'string' && body.upcomingId !== '';
    if (hasShow === hasUpcoming) refuse(400, 'Which show?');
    const upcoming = hasUpcoming;
    const id = docId(upcoming ? body.upcomingId : body.showId, upcoming ? 'upcomingId' : 'showId');
    const ref = db.doc(`users/${uid}/${upcoming ? 'upcomingShows' : 'shows'}/${id}`);
    const snap = await ref.get();
    if (!snap.exists) refuse(404, 'Show not found');
    return { ref, id, upcoming, show: snap.data() };
  }

  /** Pending tags this caller sent for one upcoming show. */
  async function pendingUpcomingTags(db, uid, upcomingId) {
    const snap = await db.collection('showTags').where('fromUid', '==', uid).where('upcomingShowId', '==', upcomingId).get();
    return snap.docs.filter((d) => d.data().status === 'pending');
  }

  return {
    async tag({ db, auth, uid, email, caller, body }) {
      const { ref: showRef, id, upcoming, show } = await ownShow(db, uid, body);
      const friendUids = [...new Set((Array.isArray(body.friendUids) ? body.friendUids : []).map(String))]
        .filter((u) => u && u !== uid && !u.includes('/') && u.length <= 128);
      const emails = Array.isArray(body.emails) ? body.emails : [];
      if (!friendUids.length && !emails.length) refuse(400, 'Who should be tagged?');
      if (friendUids.length > MAX_TAG_PEOPLE) refuse(400, `You can tag up to ${MAX_TAG_PEOPLE} friends at once.`);
      if (emails.length > MAX_EMAIL_TAGS) refuse(400, `You can tag up to ${MAX_EMAIL_TAGS} addresses at once.`);
      if (upcoming && emails.length) refuse(400, 'Tag a friend without an account on a past show.');

      const showData = upcoming ? upcomingTagShowData(show) : pastTagShowData(show);
      const fromName = profileName(await getProfile(db, uid), caller.name || 'A friend');

      // Mutual friends only, no block either way (mutualFriends checks
      // both). Anyone already holding a pending tag for this show is
      // skipped rather than tagged twice.
      const tagged = [];
      const skipped = [];
      for (const friendUid of friendUids) {
        if (!(await mutualFriends(db, uid, friendUid))) { skipped.push(friendUid); continue; }
        const existing = await db.collection('showTags').where('fromUid', '==', uid).where('toUid', '==', friendUid).get();
        const already = existing.docs.some((d) => {
          const t = d.data();
          return t.status === 'pending' && (upcoming ? t.upcomingShowId === id : t.showId === id);
        });
        if (already) { tagged.push({ friendUid, tagId: null }); continue; }
        if (!(await takeDailyQuota(db, `show_tag_${uid}`, TAGS_PER_DAY, { uid })).allowed) {
          refuse(429, 'You’ve tagged a lot of friends today. Try again tomorrow.');
        }
        const ref = db.collection('showTags').doc();
        await ref.set({
          fromUid: uid,
          fromName,
          toUid: friendUid,
          showData,
          ...(upcoming ? { upcomingShowId: id } : { showId: id }),
          status: 'pending',
          createdAt: new Date(),
        });
        tagged.push({ friendUid, tagId: ref.id });
      }

      // The tagger's own show lists who's tagged, added to what's stored
      // (a friend tagged from another device meanwhile stays).
      const taggedUids = tagged.map((t) => t.friendUid);
      if (taggedUids.length) {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(showRef);
          if (!snap.exists) return;
          const current = Array.isArray(snap.data().taggedFriendUids) ? snap.data().taggedFriendUids : [];
          const next = [...new Set([...current, ...taggedUids])];
          tx.update(showRef, upcoming ? { taggedFriendUids: next, updatedAt: new Date() } : { taggedFriendUids: next });
        });
      }

      for (const t of tagged) {
        if (t.tagId) await emailRecord(db, auth, caller, { type: 'tag', tagId: t.tagId });
      }

      // Someone without an account: a pending email tag and an invite to
      // join, as the web's "tag by email" wrote.
      let emailTags = 0;
      for (const entry of emails) {
        const to = normalizeEmail(entry && entry.email);
        if (!isValidEmail(to)) refuse(400, 'Enter a valid email address');
        if (to === email) refuse(400, 'That’s your own address.');
        const ref = await db.collection('pendingEmailTags').add({
          fromUid: uid,
          fromName,
          toEmail: to,
          toName: String((entry && entry.name) || '').trim().slice(0, 80) || null,
          showData,
          showId: id,
          personalMessage: String((entry && entry.message) || '').trim().slice(0, 500) || null,
          status: 'pending',
          createdAt: new Date(),
        });
        await emailRecord(db, auth, caller, { type: 'tag_email', pendingTagId: ref.id });
        emailTags += 1;
      }

      return { tagged: taggedUids, skipped, emailTags };
    },

    async respondTag({ db, uid, email, body }) {
      const response = body.response;
      if (body.pendingEmailTagId !== undefined) {
        // A tag sent to this account's address before it existed. Accepting
        // one stays normalize-show (kind 'email-tag').
        if (response !== 'declined') refuse(409, 'Add this show with normalize-show.', 'use_normalize_show');
        const ref = db.doc(`pendingEmailTags/${docId(body.pendingEmailTagId, 'pendingEmailTagId')}`);
        const snap = await ref.get();
        if (!snap.exists) refuse(404, 'Tag not found');
        const tag = snap.data();
        if (!email || normalizeEmail(tag.toEmail) !== email) refuse(403, 'This tag wasn’t sent to you.');
        if (tag.status !== 'pending') return { tagStatus: tag.status };
        await ref.update({ status: 'declined', respondedAt: new Date() });
        return { tagStatus: 'declined' };
      }

      if (response !== 'accepted' && response !== 'declined') refuse(400, 'Accept or decline?');
      const ref = db.doc(`showTags/${docId(body.tagId, 'tagId')}`);
      const snap = await ref.get();
      if (!snap.exists) refuse(404, 'Tag not found');
      const tag = snap.data();
      if (tag.toUid !== uid) refuse(403, 'This tag wasn’t sent to you.');
      // Answering again with the same answer (a double tap) is fine;
      // changing an answer, or answering a revoked tag, is not.
      if (tag.status === response) return { tagStatus: response };
      if (tag.status !== 'pending') refuse(409, tag.status === 'revoked' ? 'Your friend took this tag back.' : 'You’ve already answered this tag.');

      if (response === 'declined') {
        await ref.update({ status: 'declined', respondedAt: new Date() });
        return { tagStatus: 'declined' };
      }

      const isUpcoming = !!(tag.upcomingShowId || (tag.showData && tag.showData.upcoming));
      if (!isUpcoming) refuse(409, 'Add this show with normalize-show.', 'use_normalize_show');
      if (await blockedBetween(db, uid, tag.fromUid)) refuse(403, 'This tag can’t be accepted.');
      const { taggedBy, taggedByUid, originUpcomingId, ...fields } = upcomingInputFromTag(tag);
      const problem = validateUpcomingInput(fields, todayIso());
      if (problem) refuse(409, problem, 'date_passed');

      // The friend's own upcoming list: an existing show for that band on
      // that day takes the credit; otherwise a new one.
      const listSnap = await db.collection(`users/${uid}/upcomingShows`).get();
      const list = listSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const existing = findDuplicateUpcoming(list, fields);
      let upcomingId;
      if (existing) {
        upcomingId = existing.id;
        if (!existing.taggedBy) {
          await db.doc(`users/${uid}/upcomingShows/${existing.id}`).update({
            taggedBy: taggedBy || null, taggedByUid: taggedByUid || null, originUpcomingId: originUpcomingId || null, updatedAt: new Date(),
          });
        }
      } else {
        const created = db.collection(`users/${uid}/upcomingShows`).doc();
        await created.set(newUpcomingRecord(fields, { taggedBy, taggedByUid, originUpcomingId }, new Date()));
        upcomingId = created.id;
      }
      await ref.update({ status: 'accepted', respondedAt: new Date() });
      return { tagStatus: 'accepted', upcomingId, duplicate: !!existing };
    },

    async revokeTag({ db, uid, body }) {
      let docs;
      if (body.tagId !== undefined) {
        const snap = await db.doc(`showTags/${docId(body.tagId, 'tagId')}`).get();
        if (!snap.exists) return { revoked: 0 };
        if (snap.data().fromUid !== uid) refuse(403, 'Not your tag');
        docs = snap.data().status === 'pending' ? [snap] : [];
      } else {
        const upcomingId = docId(body.upcomingId, 'upcomingId');
        const toUid = body.toUid === undefined ? null : docId(body.toUid, 'toUid');
        docs = (await pendingUpcomingTags(db, uid, upcomingId)).filter((d) => !toUid || d.data().toUid === toUid);
        // Untagging a friend also takes them off the tagger's own show.
        if (toUid) {
          const showRef = db.doc(`users/${uid}/upcomingShows/${upcomingId}`);
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(showRef);
            if (!snap.exists) return;
            const current = Array.isArray(snap.data().taggedFriendUids) ? snap.data().taggedFriendUids : [];
            if (!current.includes(toUid)) return;
            tx.update(showRef, { taggedFriendUids: current.filter((u) => u !== toUid), updatedAt: new Date() });
          });
        }
      }
      // 'revoked' rather than a delete: the recipient's list filters on
      // pending, and the record stays for the account-deletion purge.
      for (const d of docs) await d.ref.update({ status: 'revoked', revokedAt: new Date() });
      return { revoked: docs.length };
    },

    async refreshUpcomingTags({ db, uid, body }) {
      const upcomingId = docId(body.upcomingId, 'upcomingId');
      const snap = await db.doc(`users/${uid}/upcomingShows/${upcomingId}`).get();
      if (!snap.exists) refuse(404, 'Show not found');
      const showData = upcomingTagShowData(snap.data());
      const docs = await pendingUpcomingTags(db, uid, upcomingId);
      // Only tags nobody has answered: an accepted copy is the friend's own.
      for (const d of docs) await d.ref.update({ showData });
      return { updated: docs.length };
    },

    async respondSuggestion({ db, auth, uid, caller, body }) {
      const response = body.response;
      if (response !== 'confirmed' && response !== 'declined') refuse(400, 'Yes or no?');
      const ref = db.doc(`showSuggestions/${docId(body.suggestionId, 'suggestionId')}`);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) refuse(404, 'Suggestion not found');
        const s = snap.data();
        if (!(s.participants || []).includes(uid)) refuse(403, 'Not your suggestion');
        const overallStatus = nextSuggestionStatus(s, uid, response);
        tx.update(ref, { responses: { ...(s.responses || {}), [uid]: response }, overallStatus, updatedAt: new Date() });
        return { s, overallStatus, other: (s.participants || []).find((u) => u !== uid) };
      });
      if (await blockedBetween(db, uid, result.other)) return { overallStatus: result.overallStatus, nudged: false };

      // "Were you there too?" once, to a friend who hasn't answered. The
      // email check (emailAuthorization suggestionNudge) reads the answer
      // just written.
      let nudged = false;
      const theirs = (result.s.responses || {})[result.other];
      if (response === 'confirmed' && theirs === 'pending' && !result.s.emailSentToUid && result.s.backfill !== true) {
        nudged = (await emailRecord(db, auth, caller, { type: 'suggestion_nudge', suggestionId: ref.id })) === 'sent';
        if (nudged) await ref.update({ emailSentToUid: result.other, emailSentAt: new Date() });
      }
      return { overallStatus: result.overallStatus, nudged };
    },
  };
};

module.exports.pastTagShowData = pastTagShowData;
module.exports.nextSuggestionStatus = nextSuggestionStatus;
module.exports.TAGS_PER_DAY = TAGS_PER_DAY;
