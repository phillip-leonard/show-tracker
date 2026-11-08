// netlify/functions/parse-presale-email-background.js
//
// Reads one stored email with Claude: see lib/presaleParser.js. A background
// function because a request can outlast a normal function's limit. Started
// only by inbound-email.js or the admin, with a one-shot nonce naming the email.

const { getDb } = require('./lib/firebaseAdmin');
const { claimJobTrigger } = require('./lib/jobTrigger');
const { parseStoredEmail } = require('./lib/presaleParser');

exports.handler = async function (event) {
  const db = getDb();
  const trigger = await claimJobTrigger(db, event, 'parse-presale-email');
  if (!trigger?.emailId) {
    console.warn('[parse-presale-email] refused: missing or stale trigger');
    return { statusCode: 403, body: '' };
  }
  const status = await parseStoredEmail({ db, emailId: trigger.emailId });
  console.log('[parse-presale-email]', trigger.emailId, status);
  return { statusCode: 200, body: '' };
};
