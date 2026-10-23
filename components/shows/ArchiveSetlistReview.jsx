'use client';

// components/shows/ArchiveSetlistReview.jsx
//
// Review-before-save for setlists from a source that reconstructs them
// rather than publishing them — today, the Internet Archive for Grateful
// Dead (see `requiresReview` in lib/setlistSources.js). Nothing is written
// until the user presses Save on a show; Skip and closing write nothing.
//
// Used two ways:
//   - the backfill on My Shows: every Grateful Dead show with no setlist,
//     looked up one after another, each offered on its own
//   - the show page's "Get setlist from Internet Archive" button: one show
//
// The lookups run here, one at a time with a pause between them, because
// the Archive asks to be used gently and a collection can hold dozens of
// Dead shows. Closing the sheet stops the queue.

import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, AlertTriangle, Check } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { groupSongsBySet } from '@/lib/setlistGrouping';

const PAUSE_BETWEEN_LOOKUPS_MS = 600;

// Every outcome says what happened, including — especially — the ones where
// nothing did.
function describeOutcome(item) {
  switch (item.status) {
    case 'loading':
      return 'Looking on the Internet Archive…';
    case 'queued':
      return 'Waiting…';
    case 'saved':
      return 'Saved.';
    case 'skipped':
      return 'Skipped. Nothing was changed.';
    case 'not-found':
      return item.reason === 'no-songs'
        ? 'The Internet Archive has recordings of this show, but none of them lists a setlist.'
        : 'No setlist for this date on the Internet Archive.';
    case 'unchanged':
      return 'Already matches the Internet Archive. Nothing to change.';
    case 'has-setlist':
      return 'This show has a setlist now, so it was left as it is.';
    case 'error':
      return `Couldn't reach the Internet Archive${item.detail ? ` (${item.detail})` : ''}. Nothing was changed. Try again later.`;
    default:
      return '';
  }
}

function statusFromProposal(proposal) {
  if (proposal.ok) return 'found';
  switch (proposal.reason) {
    case 'no-show':
    case 'no-songs':
      return 'not-found';
    case 'nothing-to-change':
      return 'unchanged';
    case 'ambiguous-date':
      return 'not-found';
    default:
      return 'error';
  }
}

// What the user should know before trusting this one.
function warningsFor(result) {
  const warnings = [];
  if (!result) return warnings;
  if (result.confidence === 'tracks-only') {
    warnings.push('This recording doesn’t mark set breaks, so every song is listed in one set. You can move songs between sets after saving.');
  }
  if (result.confidence === 'inferred-sets') {
    warnings.push('This recording\u2019s description has no set headers, so the set breaks were worked out from its track list. Check where each set starts.');
  }
  if (result.needsReview) {
    warnings.push('The recordings of this show don\u2019t agree on the setlist. This one was picked by the recording rules, so check it.');
  }
  if (result.partial) {
    warnings.push('This recording covers only part of the show, so songs may be missing.');
  }
  if (result.ambiguous && result.message) warnings.push(result.message);
  return warnings;
}

function ProposedSetlist({ setlist }) {
  const sets = groupSongsBySet(setlist);
  return (
    <div className="mt-3 rounded-lg bg-hover px-3 py-2.5">
      {sets.map((set) => (
        <div key={set.label} className="mb-2 last:mb-0">
          <p className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-muted mb-1">{set.label}</p>
          <p className="text-[13px] leading-relaxed text-primary">
            {set.songs.map((song, i) => (
              <span key={song.id || i}>
                {song.name}
                {i < set.songs.length - 1 ? (song.tape ? ` ${song.transitionMark || '>'} ` : ', ') : ''}
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function ArchiveSetlistReview({
  open,
  onClose,
  shows = [],
  onPropose,
  onApply,
  onlyIfEmpty = false,
  title = 'Setlists from the Internet Archive',
  onOutcome,
}) {
  const [items, setItems] = useState([]);
  const runId = useRef(0);

  const update = (showId, patch) => {
    setItems((prev) => prev.map((it) => (it.show.id === showId ? { ...it, ...patch } : it)));
  };

  // (Re)start the queue each time the sheet opens. Closing bumps runId,
  // which every pending lookup checks before it touches state.
  useEffect(() => {
    if (!open) {
      runId.current += 1;
      return undefined;
    }
    const myRun = ++runId.current;
    setItems(shows.map((show) => ({ show, status: 'queued' })));

    (async () => {
      for (let i = 0; i < shows.length; i++) {
        if (runId.current !== myRun) return;
        const show = shows[i];
        update(show.id, { status: 'loading' });
        let proposal;
        try {
          proposal = await onPropose(show.id);
        } catch (err) {
          proposal = { ok: false, reason: 'fetch-failed', detail: err?.message || String(err) };
        }
        if (runId.current !== myRun) return;
        const status = statusFromProposal(proposal);
        update(show.id, { status, proposal, reason: proposal.reason, detail: proposal.detail || '' });
        if (status !== 'found') onOutcome?.(show.id, status);
        if (i < shows.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_LOOKUPS_MS));
      }
    })();

    return () => { runId.current += 1; };
    // `shows` is captured when the sheet opens; a list that changes under an
    // open sheet (a save refreshing the shows array) must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (item) => {
    update(item.show.id, { saving: true });
    let res;
    try {
      res = await onApply(item.show.id, item.proposal.result, { onlyIfEmpty });
    } catch (err) {
      res = { ok: false, reason: 'fetch-failed', detail: err?.message || String(err) };
    }
    const status = res.ok ? 'saved' : res.reason === 'has-setlist' ? 'has-setlist' : res.reason === 'nothing-to-change' ? 'unchanged' : 'error';
    update(item.show.id, { saving: false, status, detail: res.detail || '' });
    onOutcome?.(item.show.id, status);
  };

  const skip = (item) => {
    update(item.show.id, { status: 'skipped' });
    onOutcome?.(item.show.id, 'skipped');
  };

  const pending = items.filter((it) => it.status === 'queued' || it.status === 'loading').length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={pending > 0 ? `Checking ${items.length - pending + 1} of ${items.length}…` : undefined}
      size="lg"
    >
      <p className="text-[13px] text-secondary leading-relaxed mb-4">
        These setlists are read from the descriptions of fan recordings on the Internet Archive, so check each one
        before saving. Nothing changes until you press Save. Your ratings, notes and any songs you added are kept.
      </p>

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const result = item.proposal?.result;
          const warnings = item.status === 'found' ? warningsFor(result) : [];
          return (
            <div key={item.show.id} className="border border-subtle rounded-xl px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary truncate">{item.show.artist}</p>
                  <p className="text-xs text-secondary truncate">
                    {formatDate(item.show.date)}{item.show.venue ? ` · ${item.show.venue}` : ''}
                  </p>
                </div>
                {item.status === 'saved' && <Check className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />}
              </div>

              {item.status === 'found' ? (
                <>
                  <ProposedSetlist setlist={item.proposal.setlist} />

                  {warnings.map((w) => (
                    <p key={w} className="mt-2 flex items-start gap-1.5 text-[12px] text-amber">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}

                  {result?.sourcePermalink && (
                    <a
                      href={result.sourcePermalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted underline decoration-dotted hover:text-brand transition-colors"
                    >
                      From {result.sourceShowId || 'the Internet Archive'}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => save(item)} loading={!!item.saving}>
                      Save setlist
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => skip(item)} disabled={!!item.saving}>
                      Skip
                    </Button>
                  </div>
                </>
              ) : (
                <p className={`mt-1.5 text-[12px] ${item.status === 'saved' ? 'text-success' : 'text-muted'}`}>
                  {describeOutcome(item)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {pending > 0 ? 'Stop' : 'Done'}
        </Button>
      </div>
    </Modal>
  );
}
