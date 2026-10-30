'use client';

// components/shows/SetlistProposalDiff.jsx
//
// What accepting an Internet Archive proposal would change, read off the
// merge summary admin-resync-setlists stored with it (`setlistProposal`).
// Used on the show page and in the "Review N shows" list. The numbers are
// the merge rule's own, so they are what Accept would do — Accept re-runs
// that merge against the setlist as it is then, so an edit made since can
// only add to what is kept.

import React from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

const list = (titles) => titles.join(', ');

export function proposalChangeCount(proposal) {
  const s = proposal?.summary || {};
  return (s.added?.length || 0) + (s.removed?.length || 0) + (s.movedSet?.length || 0) + (s.movedPosition?.length || 0);
}

export function ArchiveAttribution({ identifier, permalink, className = '' }) {
  if (!permalink) return null;
  // Followable on purpose: the credit is the least this app owes the
  // Archive, and a nofollow credit is half a credit.
  return (
    <a
      href={permalink}
      target="_blank"
      rel="noopener"
      className={`inline-flex items-center gap-1 text-[11px] text-muted underline decoration-dotted hover:text-brand transition-colors ${className}`}
    >
      Setlist from a tape on the Internet Archive{identifier ? ` · ${identifier}` : ''}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

export default function SetlistProposalDiff({ proposal }) {
  if (!proposal) return null;
  const s = proposal.summary || {};
  const changes = proposalChangeCount(proposal);
  const moved = [...(s.movedSet || []), ...(s.movedPosition || [])];
  const carried = s.carriedOver || {};

  return (
    <div className="text-[12px] text-secondary leading-relaxed">
      <p className="text-primary">
        {s.existingCount ?? 0} song{s.existingCount === 1 ? '' : 's'} now → {s.resultCount ?? 0} after the update
        {changes === 0 ? ' — the same songs. Accepting switches this setlist’s source to the Internet Archive.' : '.'}
      </p>
      {s.added?.length > 0 && <p className="mt-1"><span className="text-success">Added:</span> {list(s.added)}</p>}
      {s.removed?.length > 0 && <p className="mt-1"><span className="text-danger">Removed:</span> {list(s.removed)}</p>}
      {moved.length > 0 && <p className="mt-1"><span className="text-primary">Moved:</span> {list(moved.map((m) => m.title))}</p>}
      {s.keptNotInSource?.length > 0 && (
        <p className="mt-1">
          <span className="text-primary">Kept, not in the Archive&apos;s setlist:</span> {list(s.keptNotInSource)}. You rated or wrote about
          {s.keptNotInSource.length === 1 ? ' it' : ' them'}, so {s.keptNotInSource.length === 1 ? 'it stays' : 'they stay'}, marked &quot;not in source&quot;.
        </p>
      )}
      {s.keptManual?.length > 0 && <p className="mt-1"><span className="text-primary">Songs you added, kept:</span> {list(s.keptManual)}</p>}
      {(carried.rating || carried.comment) && (
        <p className="mt-1">
          Carried over: {[carried.rating ? `${carried.rating} rating${carried.rating === 1 ? '' : 's'}` : '', carried.comment ? `${carried.comment} comment${carried.comment === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}.
        </p>
      )}
      {proposal.needsReview && (
        <p className="mt-2 flex items-start gap-1.5 text-amber">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            The recordings of this show don&apos;t agree on the setlist. This one was picked by the recording rules; check it
            {proposal.disagreement?.with ? (
              <> against <a href={`https://archive.org/details/${encodeURIComponent(proposal.disagreement.with)}`} target="_blank" rel="noopener" className="underline decoration-dotted">{proposal.disagreement.with}</a></>
            ) : null}.
          </span>
        </p>
      )}
      <ArchiveAttribution identifier={proposal.sourceShowId} permalink={proposal.sourcePermalink} className="mt-2" />
    </div>
  );
}
