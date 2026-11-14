// components/festivals/FestivalFormModal.jsx
//
// Create/edit modal for a Festival — name (required), start/end date
// (end >= start validated client-side) or, behind "I don't know the exact
// dates", only the year (5.58.0), then location + notes (optional). Reuses the same Modal/Input/Textarea/Button primitives as
// other form modals in the app (see components/VenueRatingModal.jsx).
//
// CREATE MODE also runs the shared-festival dedup: as the name and dates
// fill in, it looks for a canonical festival someone has already created
// and offers to join it instead. Rules of that offer, all deliberate:
//   - It never auto-joins. Joining is always one explicit tap.
//   - It never blocks creation. "Create it anyway" stays one click away
//     with the match still on screen.
//   - It never hides a second candidate — same name and dates in two
//     cities means two real festivals, and both are shown.
// The match rule itself is lib/festivalMatch.js; the bounded query behind
// it is findFestivalMatches in context/AppContext.jsx.
//
// EDIT MODE distinguishes the creator from everyone else. Shared details
// belong to the creator, so a non-creator gets a plain explanation and
// their own notes field rather than a form full of disabled inputs. A
// festival from the catalog (lib/festivalCatalog.js) has no creator at all,
// so its explanation says that instead of "someone else created it".

'use client';

import { useEffect, useState } from 'react';
import { Users, Info } from 'lucide-react';
import { festivalNameProblem, MIN_FESTIVAL_YEAR, MAX_FESTIVAL_YEAR } from '@/lib/festivalMatch';
import { isSeededFestival } from '@/lib/festivalCatalog';
import { festivalWhenLabel, isYearOnly } from '@/lib/festivalDates';
import { Modal, Button, Input, Textarea, Card, Spinner } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { showYear } from '@/lib/showDate';

// Wait this long after the last keystroke before looking for matches, so
// typing "Bonnaroo" is one lookup rather than eight.
const MATCH_DEBOUNCE_MS = 400;

// The year field as a whole year in range, or null. The bounds are the
// match rule's, which firestore.rules repeats.
function parseYear(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return y >= MIN_FESTIVAL_YEAR && y <= MAX_FESTIVAL_YEAR ? y : null;
}

export default function FestivalFormModal({ open, onClose, onSubmit, onJoin, festival = null }) {
  const { findFestivalMatches } = useApp();
  const isEdit = !!festival;
  // A pre-migration record has no canonical document, so its owner is
  // still the only person who can see or edit it at all.
  const canEditDetails = !isEdit || festival.isCreator || festival.unmigrated;

  const [name, setName] = useState(festival?.name || '');
  const [startDate, setStartDate] = useState(festival?.startDate || '');
  const [endDate, setEndDate] = useState(festival?.endDate || '');
  // "I don't know the exact dates": the year stands in for both dates.
  const [yearOnly, setYearOnly] = useState(isYearOnly(festival));
  const [year, setYear] = useState(festival?.year ? String(festival.year) : '');
  const [location, setLocation] = useState(festival?.location || '');
  const [notes, setNotes] = useState(festival?.notes || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [matches, setMatches] = useState([]);
  const [matching, setMatching] = useState(false);
  const [joiningId, setJoiningId] = useState('');

  // This component stays mounted between openings (Modal returns null when
  // closed), so without this the create form would still be holding the
  // previous festival's values the second time it's opened — and the edit
  // form wouldn't pick up a festival edited elsewhere.
  useEffect(() => {
    if (!open) return;
    setName(festival?.name || '');
    setStartDate(festival?.startDate || '');
    setEndDate(festival?.endDate || '');
    setYearOnly(isYearOnly(festival));
    setYear(festival?.year ? String(festival.year) : '');
    setLocation(festival?.location || '');
    setNotes(festival?.notes || '');
    setError('');
    setMatches([]);
    setJoiningId('');
  }, [open, festival]);

  // Dedup lookup, create mode only — editing an existing festival is not a
  // moment to be offered a different one.
  useEffect(() => {
    if (!open || isEdit) return;
    const knownYear = yearOnly ? parseYear(year) : null;
    if (!name.trim() || (yearOnly ? !knownYear : !startDate)) {
      setMatches([]);
      return;
    }

    let cancelled = false;
    setMatching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await findFestivalMatches(yearOnly
          ? { name: name.trim(), year: knownYear, location: location.trim() }
          : { name: name.trim(), startDate, endDate: endDate || startDate, location: location.trim() });
        if (!cancelled) setMatches(found);
      } finally {
        if (!cancelled) setMatching(false);
      }
    }, MATCH_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); setMatching(false); };
  }, [open, isEdit, name, startDate, endDate, yearOnly, year, location, findFestivalMatches]);

  // Switching to the year carries over the year of a start date already
  // picked, so ticking the box never loses what was typed.
  const toggleYearOnly = (checked) => {
    setYearOnly(checked);
    if (checked && !year && startDate) setYear(showYear(startDate));
    setError('');
  };

  const validate = () => {
    // Name limits mirror the `festivals` rule in firestore.rules, so an
    // over-long name is a form error naming the field rather than an
    // unexplained permission denial from Firestore.
    const nameProblem = festivalNameProblem(name);
    if (nameProblem) return nameProblem;
    if (yearOnly) {
      if (!parseYear(year)) return `Enter the year as four digits, from ${MIN_FESTIVAL_YEAR} to ${MAX_FESTIVAL_YEAR}.`;
      return '';
    }
    if (!startDate || !endDate) return 'Add the start and end dates, or tick “I don’t know the exact dates”.';
    if (endDate < startDate) return 'End date can’t be before the start date.';
    return '';
  };

  const handleSubmit = async () => {
    // A non-creator's "save" only ever carries their own notes.
    if (!canEditDetails) {
      setSaving(true);
      try {
        await onSubmit({ notes });
        onClose();
      } catch {
        // AppContext surfaces a toast; keep the modal open to retry.
      } finally {
        setSaving(false);
      }
      return;
    }

    const problem = validate();
    if (problem) return setError(problem);
    setError('');
    setSaving(true);
    try {
      await onSubmit(yearOnly
        ? { name: name.trim(), startDate: '', endDate: '', year: parseYear(year), location, notes }
        : { name: name.trim(), startDate, endDate, location, notes });
      onClose();
    } catch {
      // AppContext already surfaces a toast on failure — keep the modal
      // open so the user can retry without re-typing everything.
    } finally {
      setSaving(false);
    }
  };

  const handleJoin = async (canonical) => {
    if (!onJoin) return;
    setJoiningId(canonical.id);
    try {
      await onJoin(canonical);
      onClose();
    } catch {
      setJoiningId('');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit festival' : 'New festival'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>
            {isEdit
              ? (canEditDetails ? 'Save changes' : 'Save my notes')
              : (matches.length > 0 ? 'Create it anyway' : 'Create festival')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isEdit && !canEditDetails && (
          <div className="flex items-start gap-2 bg-hover border border-subtle rounded-xl p-3 text-sm text-secondary">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            {isSeededFestival(festival) ? (
              <span>
                <span className="font-semibold text-primary">{festival.name}</span> comes from the
                MySetlists festival catalog, so its name, dates and location can’t be edited here.
                Your notes and the shows you attach are yours alone.
              </span>
            ) : (
              <span>
                Someone else created <span className="font-semibold text-primary">{festival.name}</span>,
                so its name, dates and location are theirs to change — and any change they make shows up
                here for everyone. Your notes and the shows you attach are yours alone.
              </span>
            )}
          </div>
        )}

        {canEditDetails && (
          <>
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bonnaroo 2023"
              autoFocus
            />
            {yearOnly ? (
              <Input
                label="Year"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 2019"
                hint="You can add the dates later."
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Start date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <Input
                  label="End date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-secondary -mt-1 min-h-[44px] md:fine:min-h-0 cursor-pointer">
              <input
                type="checkbox"
                checked={yearOnly}
                onChange={(e) => toggleYearOnly(e.target.checked)}
                className="w-5 h-5 accent-brand flex-shrink-0"
              />
              I don’t know the exact dates
            </label>
            <Input
              label="Location (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Manchester, TN"
            />
          </>
        )}

        {/* Matches sit between the shared details and the personal notes,
            so they're visible while the fields that produced them are. */}
        {!isEdit && matching && matches.length === 0 && (
          <Spinner size="sm" label="Checking for this festival…" />
        )}

        {!isEdit && matches.length > 0 && (
          <Card padding="sm" className="border-brand/30">
            <p className="text-sm font-semibold text-primary mb-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-brand" aria-hidden="true" />
              {matches.length > 1
                ? `${matches.length} festivals look like this one`
                : isSeededFestival(matches[0].festival)
                  ? 'This festival is already listed'
                  : 'Someone already added this festival'}
            </p>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              {matches.map(({ festival: candidate }) => (
                <li key={candidate.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-primary truncate">{candidate.name}</div>
                    <div className="text-xs text-secondary truncate">
                      {festivalWhenLabel(candidate)}
                      {candidate.location ? ` · ${candidate.location}` : ''}
                      {isSeededFestival(candidate) ? ' · from the festival catalog' : ' · created by another user'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleJoin(candidate)}
                    loading={joiningId === candidate.id}
                    className="flex-shrink-0"
                  >
                    Join
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-2">
              Joining adds it to your festivals with your own notes and shows. Not the same event?
              Create yours anyway.
            </p>
          </Card>
        )}

        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything you want to remember about this one"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
