'use client';

// components/notifications/OnsaleAlertSettings.jsx
//
// Home city, radius and time zone for on-sale alerts, shown under that alert's
// switches in Notification settings. Stored in alertSettings/{uid}
// (lib/alertSettings.js), where nobody else can read it.

import { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import {
  DEFAULT_RADIUS, RADIUS_OPTIONS, deviceTimeZone, loadAlertSettings, saveAlertSettings, searchCities, timeZoneOptions,
} from '@/lib/alertSettings';

const FIELD_CLASS = 'w-full min-h-touch md:fine:min-h-0 text-base md:text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none';

export default function OnsaleAlertSettings({ userId }) {
  const [loaded, setLoaded] = useState(false);
  const [home, setHome] = useState(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [timezone, setTimezone] = useState(deviceTimeZone());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const searchRun = useRef(0);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    loadAlertSettings(userId)
      .then((s) => {
        if (!live) return;
        if (s?.homeLocation) setHome(s.homeLocation);
        if (s?.alertRadiusMiles) setRadius(s.alertRadiusMiles);
        if (s?.timezone) setTimezone(s.timezone);
      })
      .catch((err) => console.error('Failed to load on-sale alert settings:', err))
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [userId]);

  useEffect(() => {
    const run = ++searchRun.current;
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      searchCities(query)
        .then((list) => { if (run === searchRun.current) setResults(list); })
        .catch(() => { if (run === searchRun.current) setError("Couldn't load the city list. Please try again."); });
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const save = async (fields) => {
    setError(null);
    try {
      await saveAlertSettings(userId, { alertRadiusMiles: radius, timezone, ...fields });
    } catch (err) {
      console.error('Failed to save on-sale alert settings:', err);
      setError("Couldn't save that. Please try again.");
    }
  };

  const pickCity = (city) => {
    setHome(city);
    setQuery('');
    setResults([]);
    save({ homeLocation: city });
  };

  const clearCity = () => {
    setHome(null);
    save({ homeLocation: null });
  };

  if (!loaded) return null;

  return (
    <div className="mt-3 pl-7 space-y-3">
      <div>
        <label htmlFor="onsale-city" className="text-secondary text-xs font-medium block mb-1.5">Home city</label>
        {home ? (
          <div className="flex items-center gap-2 text-sm text-primary">
            <MapPin className="w-4 h-4 text-brand flex-shrink-0" />
            <span className="min-w-0 truncate">{home.label}</span>
            <button
              type="button"
              onClick={clearCity}
              aria-label="Remove home city"
              className="inline-flex items-center justify-center min-w-touch min-h-touch md:fine:min-w-0 md:fine:min-h-0 p-1 text-muted hover:text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <input
              id="onsale-city"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for your city"
              autoComplete="off"
              className={FIELD_CLASS}
            />
            {results.length > 0 && (
              <ul className="mt-1 border border-subtle rounded-lg overflow-hidden">
                {results.map((c) => (
                  <li key={`${c.label}:${c.lat}:${c.lng}`}>
                    <button
                      type="button"
                      onClick={() => pickCity(c)}
                      className="w-full text-left min-h-touch md:fine:min-h-0 px-2.5 py-1.5 text-sm text-primary hover:bg-hover"
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted text-xs mt-1">Add your city to get on-sale alerts.</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="onsale-radius" className="text-secondary text-xs font-medium block mb-1.5">Alert me about shows within</label>
          <select
            id="onsale-radius"
            value={radius}
            onChange={(e) => {
              const miles = Number(e.target.value);
              setRadius(miles);
              save({ alertRadiusMiles: miles });
            }}
            className={FIELD_CLASS}
          >
            {RADIUS_OPTIONS.map((m) => <option key={m} value={m}>{m} miles</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="onsale-timezone" className="text-secondary text-xs font-medium block mb-1.5">Time zone</label>
          <select
            id="onsale-timezone"
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              save({ timezone: e.target.value });
            }}
            className={FIELD_CLASS}
          >
            {timeZoneOptions(timezone).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}
      <p className="text-muted text-xs">
        Only you can see your city. City data from{' '}
        <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer" className="underline">GeoNames</a> (CC BY 4.0).
      </p>
    </div>
  );
}
