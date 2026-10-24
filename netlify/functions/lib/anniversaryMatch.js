// netlify/functions/lib/anniversaryMatch.js
//
// Month-day matching for the daily anniversary job
// (netlify/functions/anniversary-notifications.js). Its own module so the
// rule can be tested without loading Firebase or the email senders.
//
// Show dates go through isoDate (publicPageHtml.js, the CommonJS mirror of
// toIsoDate in lib/utils.js). Ticket-scanner shows store setlist.fm's
// "23-10-2019"; sliced as YYYY-MM-DD that read as month-day "10-20" and
// year "23-1", so those shows never got a reminder.
//
// "Today" here is the UTC date, and that is deliberate. The job has no
// per-user time zone to work from (none is stored), and it runs at 13:00
// UTC (netlify.toml), when the UTC date is the local date everywhere from
// UTC-11 to UTC+10: all of the Americas, Europe, Africa and most of Asia
// and Australia. UTC+11 and later (New Zealand, the Pacific) are already on
// tomorrow at that hour, and get the reminder a day late. Moving the
// schedule or the zone needs a per-user time zone first.

const { isoDate } = require('./publicPageHtml');

function utcIsoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Years since the show if `dateStr` falls on `todayIso`'s month and day in
// an earlier year, else null. Dates in neither stored format are skipped.
function anniversaryYearsAgo(dateStr, todayIso) {
  const iso = isoDate(dateStr);
  if (!iso || iso.slice(5) !== todayIso.slice(5)) return null;
  const yearsAgo = Number(todayIso.slice(0, 4)) - Number(iso.slice(0, 4));
  return yearsAgo > 0 ? yearsAgo : null;
}

module.exports = { utcIsoDate, anniversaryYearsAgo };
