'use client';

// components/shows/ArchiveProposalReview.jsx
//
// "Review N shows": the shows the Internet Archive backfill
// has a proposal for (`setlistProposal`, written by admin-resync-setlists),
// as a card on My Shows that opens the list. Each one can be accepted or
// kept as it is. Accept all is there for an account with dozens of Dead
// shows, and asks once more after showing how many songs it would change
// in total.
//
// Nothing here talks to the Archive: the proposal holds its own setlist,
// and accepting runs the merge in AppContext.acceptStoredProposal, which
// refuses any write that would leave fewer rated or commented songs.

import React, { useMemo, useState } from 'react';
import { ListChecks, Check } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import SetlistProposalDiff, { proposalChangeCount } from './SetlistProposalDiff';

function outcomeText(outcome) {
  if (!outcome) return '';
  if (outcome.ok) return 'Updated.';
  if (outcome.kept) return 'Kept your setlist.';
  if (outcome.reason === 'would-lose-notes') return 'Not updated: it would have dropped a rating or comment. Your setlist is unchanged.';
  if (outcome.reason === 'nothing-to-change') return 'Already the same. Nothing changed.';
  return 'Couldn’t update this one. Your setlist is unchanged.';
}

export default function ArchiveProposalReview({ shows = [], onAccept, onDecline }) {
  const [open, setOpen] = useState(false);
  // Frozen when the list opens, so accepting one doesn't reshuffle it.
  const [reviewing, setReviewing] = useState([]);
  const [outcomes, setOutcomes] = useState({});
  const [busy, setBusy] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);

  const n = shows.length;
  const bands = [...new Set(shows.map((s) => s.artist))];
  const who = bands.length === 1 ? `${bands[0]} ` : '';
  const remaining = reviewing.filter((s) => !outcomes[s.id]);
  const totalChanges = useMemo(() => remaining.reduce((sum, s) => sum + proposalChangeCount(s.setlistProposal), 0), [remaining]);

  if (!onAccept || !onDecline || (n === 0 && !open)) return null;

  const start = () => {
    setReviewing([...shows].sort((a, b) => String(a.date).localeCompare(String(b.date))));
    setOutcomes({});
    setConfirmAll(false);
    setOpen(true);
  };

  const accept = async (show) => {
    setBusy(show.id);
    let res;
    try { res = await onAccept(show.id); } catch (err) { res = { ok: false, reason: 'error', detail: err?.message }; }
    setOutcomes((prev) => ({ ...prev, [show.id]: res }));
    setBusy('');
    return res;
  };

  const keep = async (show) => {
    setBusy(show.id);
    try { await onDecline(show.id); } finally { setBusy(''); }
    setOutcomes((prev) => ({ ...prev, [show.id]: { ok: false, kept: true } }));
  };

  const acceptAll = async () => {
    setConfirmAll(false);
    for (const show of remaining) {
      // One at a time: each accept re-reads the show and writes it.
      // eslint-disable-next-line no-await-in-loop
      await accept(show);
    }
  };

  return (
    <>
      {n > 0 && (
        <div className="w-full mb-4 flex items-center gap-3 px-4 py-3 bg-hover border border-subtle rounded-xl">
          <ListChecks className="w-5 h-5 text-brand flex-shrink-0" />
          <p className="flex-1 text-sm text-primary">
            Update {n} {who}setlist{n === 1 ? '' : 's'} from the Internet Archive? Your ratings and notes are kept.
          </p>
          <Button size="sm" variant="secondary" onClick={start}>
            Review {n} show{n === 1 ? '' : 's'}
          </Button>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Setlists from the Internet Archive" size="lg">
        <p className="text-[13px] text-secondary leading-relaxed mb-4">
          These setlists are read from fan recordings on the Internet Archive. Each one shows what would change. Nothing
          changes until you accept it. Ratings, notes and songs you added are always kept.
        </p>

        {remaining.length > 1 && (
          <div className="mb-4 px-3.5 py-3 rounded-xl bg-hover">
            {confirmAll ? (
              <>
                <p className="text-[13px] text-primary">
                  Accept all {remaining.length} shows? That changes {totalChanges} song{totalChanges === 1 ? '' : 's'} in
                  total (added, removed or moved){remaining.filter((s) => s.setlistProposal?.needsReview).length > 0
                    ? `, including ${remaining.filter((s) => s.setlistProposal?.needsReview).length} show(s) whose recordings disagree`
                    : ''}.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={acceptAll}>Accept all {remaining.length}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmAll(false)}>Cancel</Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmAll(true)} disabled={!!busy}>
                Accept all {remaining.length}…
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {reviewing.map((show) => {
            const outcome = outcomes[show.id];
            return (
              <div key={show.id} className="border border-subtle rounded-xl px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{formatDate(show.date)}</p>
                    <p className="text-xs text-secondary truncate">{show.venue}</p>
                  </div>
                  {outcome?.ok && <Check className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />}
                </div>
                {outcome ? (
                  <p className={`mt-1.5 text-[12px] ${outcome.ok ? 'text-success' : 'text-muted'}`}>{outcomeText(outcome)}</p>
                ) : (
                  <>
                    <div className="mt-2"><SetlistProposalDiff proposal={show.setlistProposal} /></div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => accept(show)} loading={busy === show.id}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => keep(show)} disabled={busy === show.id}>Keep current</Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </Modal>
    </>
  );
}
