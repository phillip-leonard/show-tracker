#!/usr/bin/env node
/**
 * Rebuilds public/data/cities.json, the city list behind "Home city" in
 * on-sale alert settings and the location of a show that a band announced by
 * email but Ticketmaster doesn't list yet. No geocoding service is involved.
 *
 * Source: GeoNames (https://www.geonames.org), CC BY 4.0, credited in the
 * settings section (components/notifications/OnsaleAlertSettings.jsx).
 * cities15000 for the world, plus cities5000 for the US, where most of the
 * venues in small towns are. Download and unzip both, then:
 *
 *   node scripts/build-city-list.js <cities15000.txt> <cities5000.txt>
 *
 * Each row is [name, region, countryCode, lat, lng], biggest city first, so a
 * search that stops at the first few matches shows the likely ones. `region`
 * is the state code for the US and Canada; GeoNames' other admin codes are
 * numbers nobody would recognize, so they are left out.
 */

const fs = require('fs');
const path = require('path');

const CANADA = {
  '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON',
  '09': 'PE', 10: 'QC', 11: 'SK', 12: 'YT', 13: 'NT', 14: 'NU',
};

function rows(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const f = line.split('\t');
    return { id: f[0], name: f[1], lat: Number(f[4]), lng: Number(f[5]), cc: f[8], admin1: f[10], pop: Number(f[14]) || 0 };
  });
}

function region(r) {
  if (r.cc === 'US') return r.admin1;
  if (r.cc === 'CA') return CANADA[r.admin1] || '';
  return '';
}

const [world, us] = process.argv.slice(2);
if (!world || !us) {
  console.error('usage: node scripts/build-city-list.js <cities15000.txt> <cities5000.txt>');
  process.exit(1);
}

const byId = new Map();
rows(world).forEach((r) => byId.set(r.id, r));
rows(us).filter((r) => r.cc === 'US').forEach((r) => byId.set(r.id, r));

const list = [...byId.values()]
  .sort((a, b) => b.pop - a.pop)
  .map((r) => [r.name, region(r), r.cc, Number(r.lat.toFixed(3)), Number(r.lng.toFixed(3))]);

const out = path.join(__dirname, '..', 'public', 'data', 'cities.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(list)}\n`);
console.log(`${list.length} cities, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
