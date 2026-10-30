'use client';

// components/shows/ArchiveBackfillCard.jsx
//
// The backfill for Internet Archive bands' shows with no setlist (Grateful
// Dead and the Live Music Archive bands in config/internet-archive.json): a card on My Shows
// that opens ArchiveSetlistReview over every such show. Only shows with an
// EMPTY setlist are offered, and saving re-checks that (onlyIfEmpty), so it
// can never replace a setlist someone already has.
//
// A show the Archive had nothing for, or that the user skipped, is
// remembered in this browser so the card doesn't keep offering it. That
// memory is a convenience only — losing it (private window, cleared
// storage) just means the card offers those shows again.

import React, { useMemo, useState } from 'react';
import { ListMusic } from 'lucide-react';
import { Button } from '@/components/ui';
import { resolveSource } from '@/lib/setlistSources';
import ArchiveSetlistReview from './ArchiveSetlistReview';

const STORAGE_KEY = 'mysetlists.archiveBackfillChecked.v1';

function readChecked() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function writeChecked(set) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Storage unavailable; the card just offers these shows again later.
  }
}

export default function ArchiveBackfillCard({ shows = [], onPropose, onApply }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(() => (typeof window === 'undefined' ? new Set() : readChecked()));
  // The list is frozen when the sheet opens, so saving one show (which
  // gives it a setlist and drops it from `candidates`) doesn't reshuffle it.
  const [reviewing, setReviewing] = useState([]);

  const candidates = useMemo(() => shows.filter((s) => (
    (!s.setlist || s.setlist.length === 0)
    && !checked.has(s.id)
    && resolveSource({ name: s.artist, mbid: s.artistMbid }).requiresReview
  )), [shows, checked]);

  if (!onPropose || !onApply || (candidates.length === 0 && !open)) return null;

  const start = () => {
    setReviewing(candidates);
    setOpen(true);
  };

  const remember = (showId, status) => {
    // Saved shows leave the list on their own (they have a setlist now);
    // these are the ones that would otherwise be offered forever.
    if (!['not-found', 'skipped', 'unchanged', 'has-setlist'].includes(status)) return;
    setChecked((prev) => {
      const next = new Set(prev);
      next.add(showId);
      writeChecked(next);
      return next;
    });
  };

  const n = candidates.length;
  // "3 Keller Williams shows" when they're one band's, "5 shows" otherwise.
  const bands = [...new Set(candidates.map((s) => s.artist))];
  const who = bands.length === 1 ? `${bands[0]} ` : '';

  return (
    <>
      {n > 0 && (
        <div className="w-full mb-4 flex items-center gap-3 px-4 py-3 bg-hover border border-subtle rounded-xl">
          <ListMusic className="w-5 h-5 text-brand flex-shrink-0" />
          <p className="flex-1 text-sm text-primary">
            {n} {who}show{n === 1 ? '' : 's'} with no setlist. The Internet Archive may have {n === 1 ? 'it' : 'them'}.
          </p>
          <Button size="sm" variant="secondary" onClick={start}>
            Look them up
          </Button>
        </div>
      )}
      <ArchiveSetlistReview
        open={open}
        onClose={() => setOpen(false)}
        shows={reviewing}
        onPropose={onPropose}
        onApply={onApply}
        onlyIfEmpty
        onOutcome={remember}
      />
    </>
  );
}
