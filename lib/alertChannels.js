// lib/alertChannels.js
//
// Push and email, switched separately, for the followed-band job's two
// alerts (notificationPrefs.followedBands and .venueBucketList). The job
// reads them in netlify/functions/lib/followedBandAlerts.js's prefFor;
// lib/__tests__/alertChannels.test.js keeps the two in step.
//
// Before 5.49.0 an alert had one `method` ('both' | 'push' | 'email'). A
// profile still carrying only that reads the same here, and every save
// writes `method` too, so an app or server from before then reads the
// new booleans the way they were meant ('none' sends neither).

/** { push, email } for one alert's prefs. Both default on. */
export function alertChannels(pref) {
  const method = pref?.method || 'both';
  return {
    push: typeof pref?.push === 'boolean' ? pref.push : method === 'both' || method === 'push',
    email: typeof pref?.email === 'boolean' ? pref.email : method === 'both' || method === 'email',
  };
}

/** The prefs with one channel changed, `method` kept in step. */
export function withChannel(pref, channel, on) {
  const next = { ...alertChannels(pref), [channel]: !!on };
  const method = next.push && next.email ? 'both' : next.push ? 'push' : next.email ? 'email' : 'none';
  return { ...pref, push: next.push, email: next.email, method };
}
