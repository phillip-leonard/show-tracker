/**
 * meetups — joining and leaving a meetup (5.60.38, Stage 6 call A). The
 * meetup document is shared, so the apps no longer write it; what each
 * action does is in lib/meetupActions.js.
 *
 *   POST { action: 'join', bucketListItemKey }   create-or-join from your
 *                                                 own bucket list item
 *   POST { action: 'join', meetupId }            join an existing meetup
 *   POST { action: 'leave', meetupId }
 *   Authorization: Bearer {idToken}
 *     200 { success: true, meetup, created?, already? }
 *     400 bad-input · 401 · 403 account_required (guests) or banned ·
 *     404 not_found · 422 the show's text didn't pass the filter · 429
 *
 * The pinned details stay with moderate-content (`meetupDescription`) and
 * the discussion with moderate-content (`meetupComment`). Accounts only:
 * guests see no user content (DECISIONS.md, D-1). The rules still let the
 * apps create, join and leave themselves, because iOS 3.13.53 and earlier
 * do; tightening waits for minSupportedIosVersion
 * (docs/ios-native/GATED-CLEANUPS.md).
 */

const { getDb, getAdminAuth, verifyUser, isAnonymous, isAdmin } = require('./lib/firebaseAdmin');
const { corsHeaders: baseCors } = require('./lib/cors');
const { takeDailyQuota } = require('./lib/rateLimit');
const { notifyEngagement, MESSAGES } = require('./lib/engagementNotifications');
const { createActions, Refusal } = require('./lib/meetupActions');

// Joins and leaves per account per UTC day.
const PER_DAY = 200;

const corsHeaders = (event) => baseCors(event, { methods: 'POST, OPTIONS' });

function actionsFor(decoded) {
  return createActions({
    // The organizer hears about a join once per person (the dedupe id).
    notifyJoin: async ({ db, uid, name, meetupId, meetup }) => {
      if (!meetup.createdBy || meetup.createdBy === uid) return;
      await notifyEngagement({ db, auth: getAdminAuth() }, { uid, name, displayName: name, isAdmin: isAdmin(decoded) }, {
        recipientUid: meetup.createdBy,
        type: 'meetup_join',
        show: { concertKey: meetup.concertKey, artist: meetup.artist, venue: meetup.venue, date: meetup.date },
        message: MESSAGES.meetup_join(name, meetup.artist || 'a show'),
        dedupeId: `meetup_join_${meetupId}_${uid}`,
      });
    },
  });
}

exports.handler = async function (event) {
  const headers = corsHeaders(event);
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const decoded = await verifyUser(event);
  if (!decoded) return reply(401, { error: 'Sign in required' });
  if (isAnonymous(decoded)) return reply(403, { error: 'Create an account to meet up with people.', code: 'account_required' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON body' }); }
  const actions = actionsFor(decoded);
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(actions, body.action)) {
    return reply(400, { error: 'Unknown action' });
  }

  try {
    const db = getDb();
    if (!(await takeDailyQuota(db, `meetups_${decoded.uid}`, PER_DAY, { uid: decoded.uid })).allowed) {
      return reply(429, { error: 'Too many requests today. Please try again tomorrow.' });
    }
    const result = await actions[body.action]({ db, uid: decoded.uid, body });
    return reply(200, { success: true, ...result });
  } catch (e) {
    if (e instanceof Refusal) return reply(e.status, e.code ? { error: e.message, code: e.code } : { error: e.message });
    console.error(`[meetups] ${body.action} failed:`, e && e.message);
    return reply(500, { error: 'Something went wrong. Please try again.' });
  }
};

exports.PER_DAY = PER_DAY;
