// lib/alertSettings.js
//
// Home city, radius and time zone for on-sale alerts: alertSettings/{uid},
// owner-only in firestore.rules. Not on userProfiles, which any signed-in user
// can read. The scan reads it in netlify/functions/lib/onsaleAlerts.js.
//
// The city search is a static list (public/data/cities.json, from GeoNames),
// loaded the first time someone types. No geocoding service and no device
// location, so no iOS permission prompt.

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const RADIUS_OPTIONS = [25, 50, 100, 250];
export const DEFAULT_RADIUS = 100;

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function timeZoneOptions(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  return Array.from(new Set([current, deviceTimeZone(), ...zones].filter(Boolean)));
}

export async function loadAlertSettings(uid) {
  const snap = await getDoc(doc(db, 'alertSettings', uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveAlertSettings(uid, fields) {
  await setDoc(doc(db, 'alertSettings', uid), { ...fields, uid, updatedAt: serverTimestamp() }, { merge: true });
}

let citiesPromise = null;

function loadCities() {
  if (!citiesPromise) {
    citiesPromise = fetch('/data/cities.json')
      .then((res) => {
        if (!res.ok) throw new Error(`cities ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        citiesPromise = null;
        throw err;
      });
  }
  return citiesPromise;
}

function fold(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** 'Columbus, OH' in the US and Canada; 'Paris, FR' elsewhere. */
export function cityLabel([name, region, cc]) {
  return `${name}, ${region || cc}`;
}

/**
 * Pure, so it can be tested without the list. Rows are biggest city first, so
 * the likely Springfield leads. "columbus, oh" narrows by region or country.
 */
export function searchCityRows(rows, query, limit = 8) {
  const [namePart, placePart] = fold(query).split(',').map((p) => p.trim());
  if (!namePart || namePart.length < 2) return [];
  const starts = [];
  for (const row of rows) {
    if (!fold(row[0]).startsWith(namePart)) continue;
    if (placePart && !fold(row[1]).startsWith(placePart) && !fold(row[2]).startsWith(placePart)) continue;
    starts.push(row);
    if (starts.length >= limit) break;
  }
  return starts.map((row) => ({ label: cityLabel(row), lat: row[3], lng: row[4] }));
}

export async function searchCities(query) {
  return searchCityRows(await loadCities(), query);
}
