// netlify/functions/inbound-email-cleanup.js
//
// Scheduled daily (netlify.toml): raw presale emails are kept 90 days. What was
// parsed from them stays in presaleIntel, which holds no email body.

const { getDb } = require('./lib/firebaseAdmin');

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PER_RUN = 400;

async function deleteOldEmails(db, nowMs = Date.now()) {
  const snap = await db.collection('inboundEmails')
    .where('receivedAtMs', '<', nowMs - RETENTION_MS)
    .limit(PER_RUN)
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

exports.handler = async function () {
  const deleted = await deleteOldEmails(getDb());
  if (deleted) console.log(`[inbound-email-cleanup] deleted ${deleted}`);
  return { statusCode: 200, body: '' };
};

exports.deleteOldEmails = deleteOldEmails;
