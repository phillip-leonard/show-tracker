// lib/anniversaries.js
//
// Pure helpers for the client-side "upcoming anniversaries" list (see
// components/notifications/AnniversaryCalendar.jsx). The actual daily
// reminder notifications are sent server-side by the scheduled function at
// netlify/functions/anniversary-notifications.js, which matches month-days
// through netlify/functions/lib/anniversaryMatch.js — this file's job is
// only the client-facing "what's coming up" view.
//
// "Today" defaults to the device's local date (localIsoDate), not the UTC
// one, and show dates are read through toIsoDate: ticket-scanner shows
// store "23-10-2019", which slicing as YYYY-MM-DD reads as month "10-20".

import { localIsoDate, toIsoDate } from '@/lib/utils';

function monthDay(isoDate) {
  return isoDate.slice(5, 10); // "MM-DD"
}

// Next calendar occurrence of a show's month-day, on/after `today` (an ISO
// "YYYY-MM-DD" string) — this year if it hasn't passed yet, else next year.
export function nextOccurrence(dateStr, today = localIsoDate()) {
  const iso = toIsoDate(dateStr);
  if (!iso) return null;
  const md = monthDay(iso);
  const todayYear = Number(today.slice(0, 4));
  const thisYear = `${todayYear}-${md}`;
  const nextYear = `${todayYear + 1}-${md}`;
  return thisYear >= today ? thisYear : nextYear;
}

// Builds one upcoming-anniversary entry per show that has already had at
// least one anniversary (i.e. isn't from this coming occurrence's year),
// sorted soonest-first. Shows whose date can't be read are left out.
export function buildUpcomingAnniversaries(shows = [], today = localIsoDate()) {
  return shows
    .map(show => ({ show, iso: toIsoDate(show?.date) }))
    .filter(({ iso }) => iso)
    .map(({ show, iso }) => {
      const occurrence = nextOccurrence(iso, today);
      const occurrenceYear = Number(occurrence.slice(0, 4));
      const showYear = Number(iso.slice(0, 4));
      const yearsAgo = occurrenceYear - showYear;
      return { show, occurrence, yearsAgo };
    })
    .filter(entry => entry.yearsAgo > 0)
    .sort((a, b) => a.occurrence.localeCompare(b.occurrence));
}
