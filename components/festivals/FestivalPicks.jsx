'use client';

// components/festivals/FestivalPicks.jsx
//
// "What should I see at this festival?" The lineup in three groups
// (lib/recommendations.js festivalPicks):
//
//   Recommended for you   never seen, ranked by what fans of your bands see
//   Bands you love        followed, or seen twice or more
//   Everyone else         alphabetical; a band seen once is badged
//
// WHERE THE LINEUP COMES FROM. For an upcoming festival, Ticketmaster: on
// open this asks netlify/functions/festival-lineup.js, which refetches at
// most once a day and stores it on the shared festival (so every attendee
// sees the same one, credited and linked to Ticketmaster). A lineup the
// admin put in data/festival-lineups.json (5.58.0, lineupSource 'seed') is
// stored the same way, credited as the announced lineup and linked to the
// announcement, and Ticketmaster never replaces it. When neither has one
// has nothing, the user can type the lineup in. That copy is `myLineup` on
// their own attendance record, private to them like their notes, so no
// typed text ever reaches another person (no new UGC on iOS).
//
// Shown for an upcoming festival, or for any festival that has a lineup.
// A past festival with no lineup keeps the existing "Search lineup" flow.

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Heart, ListMusic, Pencil, ExternalLink } from 'lucide-react';
import { Button, Card, Modal, Spinner, Textarea } from '@/components/ui';
import { auth } from '@/lib/firebase';
import { apiUrl } from '@/lib/api';
import { festivalPicks, becauseText, MAX_SEED_READS } from '@/lib/recommendations';
import { loadAffinityDocs } from '@/lib/discover';
import useMyBands from '@/hooks/useMyBands';
import BandSuggestionRow from '@/components/discover/BandSuggestionRow';
import { festivalLastDay } from '@/lib/festivalDates';

const MAX_TYPED = 300;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Group({ icon: Icon, title, note, children }) {
  return (
    <div className="mt-5 first:mt-3">
      <h3 className="text-sm font-bold text-primary flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand" aria-hidden="true" />
        {title}
      </h3>
      {note && <p className="text-xs text-muted mt-0.5">{note}</p>}
      <ul className="mt-1">{children}</ul>
    </div>
  );
}

export default function FestivalPicks({ festival, onSaveMyLineup }) {
  const { uid, ready, bands, seeds, dismissed } = useMyBands();
  const upcoming = festivalLastDay(festival) >= todayIso();
  const canonicalId = festival.festivalId || null;

  const [tm, setTm] = useState({
    lineup: Array.isArray(festival.lineup) ? festival.lineup : [],
    url: festival.lineupUrl || null,
    source: festival.lineupSource || null,
  });
  const [fetching, setFetching] = useState(false);
  const [docs, setDocs] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Ask for the Ticketmaster lineup when the festival is opened. The
  // function decides whether that means a fetch or the stored copy.
  useEffect(() => {
    if (!uid || !upcoming || !canonicalId) return undefined;
    let live = true;
    (async () => {
      setFetching(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(apiUrl('/.netlify/functions/festival-lineup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ festivalId: canonicalId }),
        });
        if (res.ok) {
          const body = await res.json();
          if (live && Array.isArray(body.lineup)) setTm({ lineup: body.lineup, url: body.url, source: body.source });
        }
      } catch (err) {
        console.warn('Festival lineup lookup failed:', err.message);
      } finally {
        if (live) setFetching(false);
      }
    })();
    return () => { live = false; };
  }, [uid, upcoming, canonicalId]);

  const myLineup = Array.isArray(festival.myLineup) ? festival.myLineup : [];
  // The shared lineup on the festival itself, from Ticketmaster or from the
  // lineup file. Either one wins over the user's own typed copy.
  const fromTicketmaster = tm.lineup.length > 0;
  const announced = fromTicketmaster && tm.source === 'seed';
  const lineup = fromTicketmaster ? tm.lineup : myLineup;

  const seedSig = seeds.slice(0, MAX_SEED_READS).map((s) => s.key).join('|');
  useEffect(() => {
    if (!ready || !lineup.length) return undefined;
    let live = true;
    loadAffinityDocs(seeds.slice(0, MAX_SEED_READS).map((s) => s.key))
      .then((d) => { if (live) setDocs(d); })
      .catch(() => { if (live) setDocs({}); });
    return () => { live = false; };
  }, [ready, seedSig, lineup.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const picks = useMemo(
    () => festivalPicks({ lineup, seeds, affinityDocs: docs || {}, bands, dismissed }),
    [lineup, seeds, docs, bands, dismissed]
  );

  if (!uid) return null;
  if (!upcoming && !lineup.length) return null;

  const openEditor = () => {
    setDraft(myLineup.join('\n'));
    setEditing(true);
  };
  const saveDraft = async () => {
    const names = [...new Set(draft.split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_TYPED);
    setSaving(true);
    try {
      await onSaveMyLineup(names);
      setEditing(false);
    } catch {
      // updateFestivalData has already shown the error toast.
    } finally {
      setSaving(false);
    }
  };

  const loadingLineup = fetching && !lineup.length;
  const scoring = lineup.length > 0 && docs === null;

  return (
    <Card padding="md" className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-primary">Your picks</h2>
          <p className="text-sm text-secondary mt-0.5">The lineup, ranked by how likely you are to love each band.</p>
        </div>
        {!fromTicketmaster && lineup.length > 0 && (
          <Button size="sm" variant="ghost" icon={Pencil} onClick={openEditor}>Edit lineup</Button>
        )}
      </div>

      {loadingLineup || scoring ? (
        <div className="py-8 flex justify-center"><Spinner /></div>
      ) : !lineup.length ? (
        <div className="mt-4 text-sm text-secondary">
          <p>
            We couldn&apos;t find this festival&apos;s lineup on Ticketmaster yet. Lineups usually appear there once
            tickets are on sale, so check back closer to the dates, or enter the lineup yourself.
          </p>
          <Button size="sm" variant="secondary" icon={ListMusic} className="mt-3" onClick={openEditor}>
            Enter the lineup
          </Button>
        </div>
      ) : (
        <>
          {picks.recommended.length > 0 && (
            <Group icon={Sparkles} title="Recommended for you" note="Bands you haven't seen that fans of your bands see often.">
              {picks.recommended.map((p) => (
                <BandSuggestionRow key={p.key} name={p.name} reason={becauseText(p.because)} compact />
              ))}
            </Group>
          )}
          {picks.love.length > 0 && (
            <Group icon={Heart} title="Bands you love">
              {picks.love.map((p) => (
                <BandSuggestionRow
                  key={p.key}
                  name={p.name}
                  detail={p.timesSeen > 0 ? `Seen ${p.timesSeen} time${p.timesSeen === 1 ? '' : 's'}${p.favorite ? ' · you follow them' : ''}` : 'You follow them'}
                  compact
                />
              ))}
            </Group>
          )}
          {picks.everyoneElse.length > 0 && (
            <Group icon={ListMusic} title={picks.recommended.length || picks.love.length ? 'Everyone else on the lineup' : 'The lineup'}>
              {picks.everyoneElse.map((p) => (
                <BandSuggestionRow key={p.key} name={p.name} badge={p.seenOnce ? 'Seen once' : null} compact />
              ))}
            </Group>
          )}
          <p className="text-xs text-muted mt-5">
            {fromTicketmaster ? (
              tm.url ? (
                <a href={tm.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary hover:underline">
                  {announced ? 'The announced lineup' : 'Lineup from Ticketmaster'} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              ) : (announced ? 'The announced lineup' : 'Lineup from Ticketmaster')
            ) : 'The lineup you entered. Only you can see it.'}
          </p>
        </>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Enter the lineup" subtitle="One band per line. Only you can see this." size="md">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} autoFocus placeholder={'Goose\nBilly Strings\nMy Morning Jacket'} />
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          <Button onClick={saveDraft} loading={saving}>Save lineup</Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}
