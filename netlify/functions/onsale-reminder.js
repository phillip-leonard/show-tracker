// netlify/functions/onsale-reminder.js
//
// Scheduled every 15 minutes (netlify.toml): the reminder about an hour before
// a sale opens, with any code that arrived since the announcement. See
// runOnsaleReminders in lib/onsaleAlerts.js. A scheduled function gets 30
// seconds; an alert not reached is still due at the next run.

const { getDb } = require('./lib/firebaseAdmin');
const { sendNotificationEmail } = require('./lib/outgoingEmail');
const { runOnsaleReminders } = require('./lib/onsaleAlerts');
const { fcmMessage } = require('./lib/pushDelivery');

const RUN_BUDGET_MS = 22 * 1000;

exports.handler = async function () {
  const db = getDb();
  const started = Date.now();
  const totals = await runOnsaleReminders({
    db,
    sendEmail: (msg) => sendNotificationEmail({ db, ...msg }),
    sendPush: (token, msg) => require('firebase-admin/messaging').getMessaging().send(fcmMessage(token, msg)),
    deadline: started + RUN_BUDGET_MS,
  });
  if (totals.due) console.log('[onsale-reminder] run finished', JSON.stringify({ ...totals, ms: Date.now() - started }));
  return { statusCode: 200, body: '' };
};
