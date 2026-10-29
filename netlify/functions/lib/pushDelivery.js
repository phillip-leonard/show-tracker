/**
 * pushDelivery — sending an alert to every device a user has, for the jobs
 * that push: lib/followedBandAlerts.js (tours, bucket-list venues) and
 * lib/anniversaryAlerts.js (5.49.2).
 *
 * WHERE THE DEVICES ARE. pushTokens/{fcmToken} = { userId, platform,
 * updatedAt }, written by the iOS app (lib/pushAlerts.js) and owner-only in
 * firestore.rules; plus the legacy web token on userProfiles.fcmToken.
 *
 * DEAD TOKENS. A token FCM reports unregistered (app deleted, token
 * rotated, FCM token deleted on sign-out) is deleted on the spot, and not
 * tried again in the same run.
 *
 * PREFS. Each alert type's notificationPrefs.<key> is { enabled, push,
 * email }; profiles from before 5.49.0 carry `method` ('both' | 'push' |
 * 'email' | 'none') instead. The app reads them the same way
 * (lib/alertChannels.js; lib/__tests__/alertChannels.test.js keeps the two
 * in step).
 */

const PUSH_TOKENS = 'pushTokens';

/**
 * { enabled, push, email } for one alert type. `enabled` off means no alert
 * at all, not even in Notifications. Push and email default on; push only
 * reaches a user who has a device token, so "on" before permission is
 * granted sends nothing.
 */
function prefFor(profile, key) {
  const p = profile?.notificationPrefs?.[key] || {};
  const method = p.method || 'both';
  return {
    enabled: p.enabled !== false,
    push: typeof p.push === 'boolean' ? p.push : method === 'both' || method === 'push',
    email: typeof p.email === 'boolean' ? p.email : method === 'both' || method === 'email',
  };
}

/** uid -> [{ uid, token, legacy }] for the users in `profiles`: pushTokens docs, then the legacy web token. */
async function loadPushTokens(db, profiles) {
  const byUid = new Map();
  const add = (t) => {
    if (!byUid.has(t.uid)) byUid.set(t.uid, []);
    const list = byUid.get(t.uid);
    if (!list.some((x) => x.token === t.token)) list.push(t);
  };
  const snap = await db.collection(PUSH_TOKENS).get();
  snap.docs.forEach((d) => {
    const uid = d.data()?.userId;
    if (uid && profiles.has(uid)) add({ uid, token: d.id, legacy: false });
  });
  profiles.forEach((p, uid) => {
    if (p?.fcmToken) add({ uid, token: p.fcmToken, legacy: true });
  });
  return byUid;
}

/** FCM's answer for a token that will never work again. */
function isDeadToken(err) {
  const code = err?.code || err?.errorInfo?.code;
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token';
}

async function removeDeadToken(db, t, tag) {
  try {
    if (t.legacy) {
      await db.collection('userProfiles').doc(t.uid).update({ fcmToken: null });
    } else {
      await db.collection(PUSH_TOKENS).doc(t.token).delete();
    }
  } catch (err) {
    console.warn(`[${tag}] could not remove dead token for`, t.uid, err.message);
  }
}

/**
 * Send `msg` to each of one user's devices. `devices` is that user's array
 * from loadPushTokens, and loses any token found dead. Resolves
 * { reached: boolean, dead: number }.
 */
async function pushToDevices({ db, devices, sendPush, msg, tag = 'push' }) {
  let reached = false;
  let dead = 0;
  for (const t of [...devices]) {
    try {
      await sendPush(t.token, msg);
      reached = true;
    } catch (err) {
      if (!isDeadToken(err)) {
        console.warn(`[${tag}] push failed for`, t.uid, err.message);
        continue;
      }
      devices.splice(devices.indexOf(t), 1);
      await removeDeadToken(db, t, tag);
      dead++;
    }
  }
  return { reached, dead };
}

/**
 * The FCM message for one device: the same shape for an iPhone and a
 * browser. On iOS, `data.link` (a universal link) is what a tap opens,
 * through lib/pushAlerts.js and lib/deepLinks.js; on the web,
 * fcmOptions.link. Pushes with the same threadId group together.
 */
function fcmMessage(token, { title, body, link, threadId, notificationId }) {
  return {
    token,
    notification: { title, body },
    data: { link, notificationId },
    apns: { payload: { aps: { sound: 'default', 'thread-id': threadId } } },
    webpush: { fcmOptions: { link } },
  };
}

module.exports = {
  PUSH_TOKENS, prefFor, loadPushTokens, isDeadToken, removeDeadToken, pushToDevices, fcmMessage,
};
