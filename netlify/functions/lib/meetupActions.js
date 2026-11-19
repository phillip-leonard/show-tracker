/**
 * meetupActions — joining and leaving a meetup, on the server (5.60.38,
 * Stage 6 call A). netlify/functions/meetups.js is the handler.
 *
 * A meetup document is shared: every account reads it. The browser used to
 * create and join it itself, which let three things through:
 *   - an account without a display name wrote its email address into
 *     `createdByName` and `attendeeNames` (MeetupCard passed
 *     `user.displayName || user.email`), on a document anyone can read;
 *   - the update rule checked `attendeeUids` but not `attendeeNames`, so one
 *     write could rename every attendee (fixed in firestore.rules too);
 *   - the band, venue and city came from the browser, unfiltered.
 * Here the show comes from the caller's own bucket list item, the names
 * from profiles (never an email), and the text through the content filter.
 *
 *   join  { bucketListItemKey }  creates the meetup for that item's show if
 *                                there is none, else joins it
 *         { meetupId }           joins an existing meetup (a link or a
 *                                notification); 404 if there is none
 *   leave { meetupId }           takes the caller off the list (uid and name)
 *
 * Both answer { meetup, created?, already? }. The organizer is notified of a
 * join (lib/engagementNotifications.js), once per person.
 */

const { showMatchKey } = require('../../../lib/showIdentity');
const { meetupIdFor } = require('../../../lib/concertKeys');
const { toIsoDate } = require('../../../lib/showDate');
const { checkContent } = require('./contentFilterRule');

const MAX_FIELD = 200;
const EMAIL_SHAPE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

class Refusal extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}
const refuse = (status, message, code = null) => { throw new Refusal(status, message, code); };

const clean = (v, max = MAX_FIELD) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** True for anything that contains an email address. */
function looksLikeEmail(value) {
  return typeof value === 'string' && EMAIL_SHAPE.test(value);
}

/** The name a meetup shows for someone: their display name, never an email. */
function meetupName(profile) {
  const name = clean(profile && (profile.displayName || profile.firstName), 80);
  return name && !looksLikeEmail(name) ? name : 'Someone';
}

/** The shape both actions answer with. */
function meetupView(id, d) {
  return {
    id,
    concertKey: d.concertKey || '',
    artist: d.artist || '',
    venue: d.venue || '',
    date: d.date || '',
    city: d.city || '',
    createdBy: d.createdBy || null,
    createdByName: d.createdByName || 'Someone',
    attendeeUids: Array.isArray(d.attendeeUids) ? d.attendeeUids : [],
    attendeeNames: d.attendeeNames && typeof d.attendeeNames === 'object' ? d.attendeeNames : {},
    description: d.description || '',
  };
}

const isMeetupId = (v) => typeof v === 'string' && /^[a-z0-9_]{1,500}$/.test(v);

async function profileOf(db, uid) {
  const snap = await db.doc(`userProfiles/${uid}`).get();
  return snap.exists ? snap.data() : {};
}

/** The caller's bucket list item, and the meetup fields built from it. */
async function fromBucketItem(db, uid, itemKey) {
  if (typeof itemKey !== 'string' || !itemKey || itemKey.includes('/') || itemKey.length > 400) refuse(400, 'Which show?', 'bad-input');
  const snap = await db.doc(`bucketList/${uid}_${itemKey}`).get();
  if (!snap.exists || snap.data().userId !== uid) refuse(404, 'That show isn’t on your bucket list.', 'not_found');
  const item = snap.data();
  const fields = {
    artist: clean(item.artist),
    venue: clean(item.venue),
    date: toIsoDate(item.date) || clean(item.date, 40),
    city: clean(item.city),
  };
  if (!fields.artist || !fields.date) refuse(400, 'That show needs a band and a date.', 'bad-input');
  for (const value of [fields.artist, fields.venue, fields.city]) {
    const verdict = checkContent(value);
    if (!verdict.ok) refuse(422, verdict.message, verdict.code);
  }
  const concertKey = showMatchKey({ artist: fields.artist, venue: fields.venue, date: fields.date });
  return { concertKey, meetupId: meetupIdFor(concertKey), fields };
}

function createActions({ notifyJoin = async () => {} } = {}) {
  return {
    async join({ db, uid, body, now = new Date() }) {
      const profile = await profileOf(db, uid);
      if (profile.banned === true) refuse(403, 'Your account can no longer do that.', 'banned');
      const name = meetupName(profile);

      let meetupId;
      let seed = null;
      if (body.bucketListItemKey !== undefined) {
        const built = await fromBucketItem(db, uid, body.bucketListItemKey);
        meetupId = built.meetupId;
        seed = { concertKey: built.concertKey, ...built.fields };
      } else {
        meetupId = body.meetupId;
        if (!isMeetupId(meetupId)) refuse(400, 'Which meetup?', 'bad-input');
      }
      if (!meetupId) refuse(400, 'Which meetup?', 'bad-input');

      const ref = db.doc(`meetups/${meetupId}`);
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          if (!seed) refuse(404, 'That meetup no longer exists.', 'not_found');
          const doc = {
            ...seed,
            createdBy: uid,
            createdByName: name,
            attendeeUids: [uid],
            attendeeNames: { [uid]: name },
            description: '',
            createdAt: now,
          };
          tx.set(ref, doc);
          return { data: doc, created: true, already: false };
        }
        const data = snap.data();
        const uids = Array.isArray(data.attendeeUids) ? data.attendeeUids : [];
        if (uids.includes(uid)) return { data, created: false, already: true };
        const attendeeNames = { ...(data.attendeeNames || {}), [uid]: name };
        const next = { attendeeUids: [...uids, uid], attendeeNames };
        tx.update(ref, next);
        return { data: { ...data, ...next }, created: false, already: false };
      });

      if (!outcome.created && !outcome.already) {
        try {
          await notifyJoin({ db, uid, name, meetupId, meetup: outcome.data });
        } catch (e) {
          console.error('[meetups] join notification failed (the join stands):', e.message);
        }
      }
      return { meetup: meetupView(meetupId, outcome.data), created: outcome.created, already: outcome.already };
    },

    async leave({ db, uid, body }) {
      if (!isMeetupId(body.meetupId)) refuse(400, 'Which meetup?', 'bad-input');
      const ref = db.doc(`meetups/${body.meetupId}`);
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) refuse(404, 'That meetup no longer exists.', 'not_found');
        const data = snap.data();
        const uids = Array.isArray(data.attendeeUids) ? data.attendeeUids : [];
        if (!uids.includes(uid)) return { data, already: true };
        const attendeeNames = { ...(data.attendeeNames || {}) };
        delete attendeeNames[uid];
        const next = { attendeeUids: uids.filter((u) => u !== uid), attendeeNames };
        tx.update(ref, next);
        return { data: { ...data, ...next }, already: false };
      });
      return { meetup: meetupView(body.meetupId, outcome.data), already: outcome.already };
    },
  };
}

module.exports = { createActions, Refusal, meetupName, looksLikeEmail, meetupView };
