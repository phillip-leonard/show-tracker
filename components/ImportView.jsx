'use client';

// components/ImportView.jsx
//
// Import shows from a file the user exported or keeps themselves: a CSV or
// Excel sheet (a Concert Archives export, a Google Sheet, anything with an
// artist and a date column), or a screenshot of a ticketing app's past
// events. Nothing here reads another service's pages or private API; the
// file is all it has.
//
//   upload -> columns -> preview -> importing -> done
//
// The file is read by lib/importSheet.js (columns, dates, duplicates,
// several artists in one cell) and each show is matched by
// lib/importMatch.js (band archive, Internet Archive, setlist.fm) BEFORE
// anything is saved, so the preview says what each row will become. Saving
// goes one show at a time through addShow, and Stop keeps what is saved.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Upload, AlertTriangle, Camera, Loader2, Scissors, FileWarning } from 'lucide-react';
import { formatDate, parseCSV, resizeImageForUpload } from '@/lib/utils';
import { apiUrl } from '@/lib/api';
import {
  IMPORT_COLUMNS, detectColumns, headerSignature, inferDateOrder, buildRows, planShows,
  showKey, summaryLine, unmatchedCsv,
} from '@/lib/importSheet';
import { createMatchContext, matchShow, importShows } from '@/lib/importMatch';

const MAPPING_STORE = 'mysetlists.importMapping.v1';

function rememberedMapping(signature) {
  try {
    const all = JSON.parse(window.sessionStorage.getItem(MAPPING_STORE) || '{}');
    return all[signature] || null;
  } catch {
    return null;
  }
}

function rememberMapping(signature, mapping) {
  try {
    const all = JSON.parse(window.sessionStorage.getItem(MAPPING_STORE) || '{}');
    all[signature] = mapping;
    window.sessionStorage.setItem(MAPPING_STORE, JSON.stringify(all));
  } catch {
    // Storage unavailable: the columns are detected again next time.
  }
}

// The header row is the first of the top few rows that names an artist and
// a date column, so a title line above the headers doesn't become them.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(5, rows.length - 1); i++) {
    const m = detectColumns(rows[i]);
    if (m.artist !== undefined && m.date !== undefined) return i;
  }
  return 0;
}

function downloadText(name, text, type = 'text/csv;charset=utf-8;') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const showId = (s) => `${s.rowIndex}:${s.part}`;

const Panel = ({ children }) => (
  <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-5 sm:p-8">{children}</div>
);

const Notice = ({ tone = 'danger', children }) => (
  <div className={`mt-4 p-4 rounded-xl flex items-start gap-3 border ${tone === 'danger' ? 'bg-danger/10 border-danger/30' : 'bg-amber-subtle border-amber/30'}`}>
    <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${tone === 'danger' ? 'text-danger' : 'text-amber'}`} />
    <div className={`text-sm ${tone === 'danger' ? 'text-danger' : 'text-primary'}`}>{children}</div>
  </div>
);

const PrimaryButton = ({ className = '', ...props }) => (
  <button
    {...props}
    className={`px-5 py-2.5 min-h-touch bg-gradient-to-r from-brand to-amber text-[#1f1f3a] rounded-xl font-semibold transition-all shadow-lg shadow-brand/20 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
  />
);

const SecondaryButton = ({ className = '', ...props }) => (
  <button
    {...props}
    className={`px-5 py-2.5 min-h-touch bg-hover hover:bg-active border border-subtle text-secondary rounded-xl font-medium transition-colors disabled:opacity-40 ${className}`}
  />
);

function ImportView({ onImport, existingShows = [], onNavigate, guestMode = false }) {
  const [step, setStep] = useState('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [dateOrder, setDateOrder] = useState('mdy');
  const [dateOrderConfirmed, setDateOrderConfirmed] = useState(false);
  const [splitRows, setSplitRows] = useState(() => new Set());
  const [picked, setPicked] = useState(() => new Map()); // showId -> true/false, the user's ticks
  const [matches, setMatches] = useState(() => new Map()); // show key -> matchShow result
  const [checking, setChecking] = useState({ running: false, stopped: false });
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [result, setResult] = useState(null);

  // Shows saved by this view, so importing the same file again before My
  // Shows reloads still sees them as duplicates.
  const importedKeys = useRef(new Set());
  const matchCtx = useRef(null);
  const stopChecking = useRef(false);
  const stopImport = useRef(false);
  const checkingNow = useRef(false);

  // ── Reading the file ──────────────────────────────────────────────

  const loadTable = (rows, name) => {
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (nonEmpty.length < 2) {
      setError('The file needs a header row and at least one show.');
      return;
    }
    const h = findHeaderRow(nonEmpty);
    const hdrs = nonEmpty[h].map((c) => String(c));
    const data = nonEmpty.slice(h + 1);
    const signature = headerSignature(hdrs);
    const dateCol = (rememberedMapping(signature) || detectColumns(hdrs)).date;
    setFileName(name);
    setHeaders(hdrs);
    setDataRows(data);
    setMapping(rememberedMapping(signature) || detectColumns(hdrs));
    setDateOrder(inferDateOrder(data.map((r) => r[dateCol])));
    setDateOrderConfirmed(false);
    setSplitRows(new Set());
    setPicked(new Map());
    setMatches(new Map());
    setError(null);
    setStep('columns');
  };

  const handleFile = async (file) => {
    setError(null);
    const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
    try {
      if (ext === 'csv' || ext === 'txt' || file.type === 'text/csv') {
        const text = (await file.text()).replace(/^﻿/, '');
        const firstLine = text.split(/\r?\n/, 1)[0] || '';
        const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        loadTable(parseCSV(text, delimiter), file.name);
      } else if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // raw: a date cell comes back as Excel's day number, which
        // parseShowDate reads exactly; the formatted text ("6/3/19") would
        // be ambiguous.
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        loadTable(rows.map((row) => row.map((c) => (c == null ? '' : String(c)))), file.name);
      } else if (['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext) || file.type.startsWith('image/')) {
        await handleScreenshot(file);
      } else {
        setError('That file type isn\'t supported. Use a .csv or .xlsx file, or a screenshot.');
      }
    } catch (e) {
      setError(ext === 'xlsx' || ext === 'xls'
        ? "Couldn't read that Excel file. Try saving it again as .xlsx or .csv."
        : `Couldn't read that file (${e.message}).`);
    }
  };

  const handleScreenshot = async (file) => {
    setScreenshotAnalyzing(true);
    try {
      const { base64, mediaType } = await resizeImageForUpload(file);
      const response = await fetch(apiUrl('/.netlify/functions/analyze-screenshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType }),
      });
      let data;
      try { data = await response.json(); } catch {
        throw new Error(`The server couldn't read that image (HTTP ${response.status}). Try cropping it or a smaller screenshot.`);
      }
      if (!response.ok) throw new Error(data.error || 'Failed to analyze screenshot');
      const shows = Array.isArray(data.shows) ? data.shows : [];
      if (shows.length === 0) throw new Error('No shows were found in this screenshot. Try one that shows your past events.');
      // Into the same table shape as a file, with the columns already known.
      loadTable([['Artist', 'Venue', 'Date', 'City'], ...shows.map((s) => [s.artist || '', s.venue || '', s.date || '', s.city || ''])], file.name);
    } catch (e) {
      setError(e.message || 'Failed to analyze the screenshot.');
    } finally {
      setScreenshotAnalyzing(false);
    }
  };

  const downloadTemplate = () => {
    downloadText('mysetlists-import-template.csv',
      'Artist,Date,Venue,City,State,Country,Rating,Notes,Tour\r\n"Goose","2024-06-15","Forest Hills Stadium","Queens","NY","USA","9","Incredible Arcadia",""\r\n');
  };

  // ── Rows, shows and duplicates ────────────────────────────────────

  const rows = useMemo(
    () => buildRows(dataRows, mapping, { order: dateOrder, existingShows }),
    [dataRows, mapping, dateOrder, existingShows]
  );

  const ambiguousCount = rows.filter((r) => r.date.ambiguous).length;
  const multiArtistRows = rows.filter((r) => r.artists.length > 1 && !r.problems.length);

  // Every show the file would become, with the duplicate check run per act
  // (a split row's acts are checked one by one) against My Shows, this
  // session's imports and earlier rows.
  const shows = useMemo(() => planShows(rows, {
    split: splitRows,
    existingKeys: new Set([...existingShows.map((s) => showKey(s.artist, s.date)), ...importedKeys.current]),
  }), [rows, splitRows, existingShows, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPicked = useCallback((s) => {
    if (s.problem || s.duplicate) return false;
    if (picked.has(showId(s))) return picked.get(showId(s));
    // An artist setlist.fm has never heard of is usually a typo, so it
    // starts unticked; ticking it imports it anyway (a local band).
    return matches.get(s.key)?.status !== 'unknown-artist';
  }, [picked, matches]);

  const toCheck = shows.filter((s) => !s.problem && !s.duplicate && !matches.has(s.key));

  // ── Matching, before anything is saved ────────────────────────────

  const runChecks = useCallback(async () => {
    if (checkingNow.current) return;
    checkingNow.current = true;
    if (!matchCtx.current) matchCtx.current = createMatchContext();
    stopChecking.current = false;
    setChecking({ running: true, stopped: false });
    const queue = [...new Map(toCheck.map((s) => [s.key, s])).values()];
    for (const s of queue) {
      if (stopChecking.current) break;
      // eslint-disable-next-line no-await-in-loop
      const m = await matchShow({ artist: s.artist, date: s.date, venue: s.venue }, matchCtx.current);
      setMatches((prev) => new Map(prev).set(s.key, m));
    }
    checkingNow.current = false;
    setChecking({ running: false, stopped: stopChecking.current });
  }, [toCheck]);

  useEffect(() => {
    if (step === 'preview' && !checking.running && !checking.stopped && toCheck.length > 0) runChecks();
  }, [step, toCheck.length, checking.running, checking.stopped, runChecks]);

  // ── Saving ─────────────────────────────────────────────────────────

  const startImport = async () => {
    stopChecking.current = true;
    stopImport.current = false;
    if (!matchCtx.current) matchCtx.current = createMatchContext();
    const total = shows.filter(isPicked).length;
    setStep('importing');
    setProgress({ done: 0, total, label: 'Saving shows' });
    const { counts, unmatched, savedKeys } = await importShows(shows, {
      isPicked,
      matches,
      match: (s) => matchShow({ artist: s.artist, date: s.date, venue: s.venue }, matchCtx.current),
      save: (data) => onImport(data, { silent: true }),
      shouldStop: () => stopImport.current,
      onProgress: (done) => setProgress({ done, total, label: 'Saving shows' }),
      artistColumn: mapping.artist,
      isSplit: (rowIndex) => splitRows.has(rowIndex),
    });
    savedKeys.forEach((k) => importedKeys.current.add(k));
    setResult({ counts, unmatched });
    setStep('done');
  };

  const reset = () => {
    stopChecking.current = true;
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setSplitRows(new Set());
    setPicked(new Map());
    setMatches(new Map());
    setChecking({ running: false, stopped: false });
    setResult(null);
    setError(null);
  };

  // ── Views ──────────────────────────────────────────────────────────

  const steps = ['Upload', 'Columns', 'Preview', 'Import'];
  const stepIndex = { upload: 0, columns: 1, preview: 2, importing: 3, done: 3 }[step];

  const missingRequired = IMPORT_COLUMNS.filter((c) => c.required && mapping[c.key] === undefined);
  const pickedShows = shows.filter(isPicked);
  const checkedCount = shows.filter((s) => !s.problem && !s.duplicate && matches.has(s.key)).length;
  const checkTotal = shows.filter((s) => !s.problem && !s.duplicate).length;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {steps.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <div className={`flex-1 h-0.5 ${i <= stepIndex ? 'bg-brand' : 'bg-hover'}`} />}
            <div className={`flex items-center gap-2 ${i === stepIndex ? 'text-brand' : i < stepIndex ? 'text-secondary' : 'text-muted'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i <= stepIndex ? 'bg-brand-subtle border border-brand/50' : 'bg-hover border border-subtle'}`}>
                {i < stepIndex ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className="hidden sm:inline text-sm font-medium">{label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {step === 'upload' && (
        <Panel>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            onClick={() => !screenshotAnalyzing && document.getElementById('import-file-input').click()}
            className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all ${
              screenshotAnalyzing ? 'border-amber bg-amber-subtle' : dragOver ? 'border-brand bg-brand-subtle' : 'border-active cursor-pointer'
            }`}
          >
            {screenshotAnalyzing ? (
              <>
                <Camera className="w-12 h-12 mx-auto mb-4 text-amber animate-pulse" />
                <p className="text-lg font-medium text-primary">Reading your screenshot…</p>
              </>
            ) : (
              <>
                <Upload className={`w-12 h-12 mx-auto mb-4 ${dragOver ? 'text-brand' : 'text-muted'}`} />
                <p className="text-lg font-medium text-primary mb-1">Choose a file</p>
                <p className="text-secondary text-sm">CSV or Excel (.xlsx), or a screenshot of your past events</p>
              </>
            )}
            <input
              id="import-file-input"
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,image/*"
              onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; }}
              className="hidden"
            />
          </div>
          {error && <Notice>{error}</Notice>}

          <div className="mt-8 p-4 bg-hover rounded-xl text-sm text-secondary space-y-2">
            <h3 className="text-primary font-medium">What the file needs</h3>
            <p>One show per row, with an artist and a date. Venue, city, state, country, rating and notes come along if they&apos;re there. Column names don&apos;t matter: you&apos;ll match them up next.</p>
            <p>Switching from Concert Archives? Export or copy your concerts into a spreadsheet and import that. <a href="/switch/concert-archives/" className="text-brand hover:underline">How to switch</a></p>
            <p>Google Sheets: File &rarr; Download &rarr; CSV or Excel.</p>
            <button onClick={downloadTemplate} className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-hover hover:bg-active border border-subtle rounded-lg text-secondary font-medium">
              <Download className="w-4 h-4" /> Download a template
            </button>
          </div>
        </Panel>
      )}

      {step === 'columns' && (
        <Panel>
          <h2 className="text-lg font-semibold text-primary">Match your columns</h2>
          <p className="text-secondary text-sm mt-1 mb-6">
            {dataRows.length} row{dataRows.length === 1 ? '' : 's'} in <span className="text-primary">{fileName}</span>. Fix any column that&apos;s wrong.
          </p>
          <div className="space-y-3 mb-6">
            {IMPORT_COLUMNS.map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <label htmlFor={`col-${c.key}`} className="w-28 flex-shrink-0 text-sm text-secondary">
                  {c.label}{c.required && <span className="text-danger"> *</span>}
                </label>
                <select
                  id={`col-${c.key}`}
                  value={mapping[c.key] ?? ''}
                  onChange={(e) => setMapping((prev) => {
                    const next = { ...prev };
                    if (e.target.value === '') delete next[c.key];
                    else next[c.key] = Number(e.target.value);
                    return next;
                  })}
                  className="flex-1 min-w-0 px-3 py-2.5 bg-hover border border-subtle rounded-xl text-primary focus:outline-none focus:ring-2 focus:ring-brand/50 [&>option]:bg-elevated"
                >
                  <option value="">— Not in this file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div data-no-swipe className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  {IMPORT_COLUMNS.filter((c) => mapping[c.key] !== undefined).map((c) => (
                    <th key={c.key} className="text-left px-3 py-2 text-secondary font-medium">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-b border-subtle">
                    {IMPORT_COLUMNS.filter((c) => mapping[c.key] !== undefined).map((c) => (
                      <td key={c.key} className="px-3 py-2 text-secondary">{row[mapping[c.key]] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <SecondaryButton onClick={reset}>Back</SecondaryButton>
            <PrimaryButton
              disabled={missingRequired.length > 0}
              onClick={() => {
                rememberMapping(headerSignature(headers), mapping);
                setStep('preview');
              }}
            >
              Preview
            </PrimaryButton>
          </div>
          {missingRequired.length > 0 && (
            <p className="mt-3 text-sm text-danger">Choose the column for {missingRequired.map((c) => c.label).join(' and ')}.</p>
          )}
        </Panel>
      )}

      {step === 'preview' && (
        <Panel>
          <h2 className="text-lg font-semibold text-primary">Check before importing</h2>
          <p className="text-secondary text-sm mt-1">
            Each row shows the show and setlist it matched. Untick anything you don&apos;t want. Nothing is saved until you import.
          </p>

          {ambiguousCount > 0 && (
            <Notice tone="amber">
              <p className="font-medium mb-2">
                {ambiguousCount} date{ambiguousCount === 1 ? '' : 's'} could be read two ways (like 03/04/2019). How does this file write dates?
              </p>
              <div className="flex flex-wrap gap-2">
                {[['mdy', 'Month first (03/04 is March 4)'], ['dmy', 'Day first (03/04 is 3 April)']].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setDateOrder(value); setDateOrderConfirmed(true); setMatches(new Map()); setChecking({ running: false, stopped: false }); }}
                    className={`px-3 py-2 rounded-lg text-sm border ${dateOrder === value && dateOrderConfirmed ? 'bg-brand text-[#1f1f3a] border-brand' : 'bg-hover border-subtle text-secondary'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Notice>
          )}

          {multiArtistRows.length > 0 && (
            <div className="mt-4 p-4 rounded-xl border border-subtle bg-hover text-sm text-secondary flex flex-wrap items-center gap-3">
              <Scissors className="w-4 h-4 text-brand" />
              <span className="flex-1">{multiArtistRows.length} row{multiArtistRows.length === 1 ? ' lists' : 's list'} more than one artist, like a festival or a bill.</span>
              <button
                onClick={() => setSplitRows(new Set(multiArtistRows.map((r) => r.index)))}
                className="px-3 py-1.5 rounded-lg border border-subtle hover:bg-active text-primary"
              >
                Split all into separate shows
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            {checking.running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-brand" />
                <span className="text-secondary">Finding setlists: {checkedCount} of {checkTotal}</span>
                <button onClick={() => { stopChecking.current = true; }} className="text-brand hover:underline">Stop</button>
              </>
            ) : toCheck.length > 0 ? (
              <>
                <span className="text-secondary">{toCheck.length} not checked yet; they&apos;ll be checked as they&apos;re saved.</span>
                <button onClick={() => setChecking({ running: false, stopped: false })} className="text-brand hover:underline">Check them now</button>
              </>
            ) : (
              <span className="text-secondary">All {checkTotal} checked.</span>
            )}
          </div>

          <ul className="mt-4 divide-y divide-subtle border-y border-subtle">
            {shows.map((s) => {
              const m = matches.get(s.key);
              const id = showId(s);
              const ticked = isPicked(s);
              const disabled = !!(s.problem || s.duplicate);
              return (
                <li key={id} className={`py-3 flex gap-3 ${disabled ? 'opacity-60' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Import ${s.artist}`}
                    checked={ticked}
                    disabled={disabled}
                    onChange={() => setPicked((prev) => new Map(prev).set(id, !ticked))}
                    className="mt-1 w-5 h-5 accent-brand flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-primary font-medium truncate">
                      {s.artist || <span className="text-muted">No artist</span>}
                      {m?.artist && m.artist !== s.artist && m.status !== 'unknown-artist' && <span className="text-muted font-normal"> → {m.artist}</span>}
                    </p>
                    <p className="text-secondary text-sm">
                      {s.row.date.iso ? formatDate(s.row.date.iso) : s.row.rawDate || 'No date'}
                      {s.row.date.ambiguous && !dateOrderConfirmed && <span className="text-amber"> (check the date)</span>}
                      {(s.venue || m?.venue) && <> · {s.venue || m.venue}</>}
                      {(s.city || m?.city) && <>, {s.city || m.city}</>}
                    </p>
                    <p className="text-xs mt-1">
                      {s.problem && <span className="text-danger">Can&apos;t import: {s.problem}</span>}
                      {s.duplicate && <span className="text-muted">Skipped: {s.duplicate}</span>}
                      {!disabled && !m && <span className="text-muted">Checking…</span>}
                      {!disabled && m?.setlist && <span className="text-brand">Setlist from {m.sourceLabel}</span>}
                      {!disabled && m?.proposal && (
                        <span className="text-amber">{m.setlist ? ' · ' : ''}Setlist from a tape on the Internet Archive, to review</span>
                      )}
                      {!disabled && m && !m.setlist && !m.proposal && m.status !== 'unknown-artist' && (
                        <span className="text-muted">No setlist found{m.status === 'error' ? ` (${m.reason})` : ''}; imports without one</span>
                      )}
                      {!disabled && m?.status === 'unknown-artist' && (s.row.artists.length > 1 && !splitRows.has(s.rowIndex)
                        ? <span className="text-danger">Not matched: this row lists {s.row.artists.length} artists. Split it to match each one.</span>
                        : <span className="text-danger">Not matched: {m.reason} Tick to import anyway.</span>)}
                    </p>
                    {s.part === 0 && s.row.artists.length > 1 && !s.problem && (
                      <button
                        onClick={() => setSplitRows((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.rowIndex)) next.delete(s.rowIndex); else next.add(s.rowIndex);
                          return next;
                        })}
                        className="mt-1 text-xs text-brand hover:underline"
                      >
                        {splitRows.has(s.rowIndex) ? 'Keep as one show' : `Split into ${s.row.artists.length} shows`}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-wrap gap-3 items-center">
            <SecondaryButton onClick={() => { stopChecking.current = true; setStep('columns'); }}>Back</SecondaryButton>
            <PrimaryButton
              disabled={pickedShows.length === 0 || (ambiguousCount > 0 && !dateOrderConfirmed)}
              onClick={startImport}
            >
              Import {pickedShows.length} show{pickedShows.length === 1 ? '' : 's'}
            </PrimaryButton>
            {ambiguousCount > 0 && !dateOrderConfirmed && <span className="text-sm text-amber">Choose how dates are written first.</span>}
            <p className="basis-full text-xs text-muted">Setlists come from the band&apos;s own archive where it has one, then the Internet Archive, then setlist.fm.</p>
          </div>
        </Panel>
      )}

      {step === 'importing' && (
        <Panel>
          <div className="text-center py-6">
            <Loader2 className="w-10 h-10 mx-auto mb-4 text-brand animate-spin" />
            <h2 className="text-lg font-semibold text-primary mb-2">Importing…</h2>
            <p className="text-secondary mb-4">{progress.done} of {progress.total} saved</p>
            <div className="w-full max-w-md mx-auto h-2 bg-hover rounded-full overflow-hidden mb-6">
              <div className="h-full bg-gradient-to-r from-brand to-amber transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <SecondaryButton onClick={() => { stopImport.current = true; }}>Stop (keeps what&apos;s saved)</SecondaryButton>
          </div>
        </Panel>
      )}

      {step === 'done' && result && (
        <Panel>
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-brand-subtle flex items-center justify-center">
              <Check className="w-7 h-7 text-brand" />
            </div>
            <h2 className="text-lg font-semibold text-primary mb-2">{result.counts.cancelled ? 'Import stopped' : 'Import complete'}</h2>
            <p className="text-secondary mb-6" data-testid="import-summary">{summaryLine(result.counts)}.</p>
            {result.counts.toReview > 0 && (
              <p className="text-sm text-secondary mb-6">
                {guestMode
                  ? 'Tape setlists from the Internet Archive come with your shows when you create a free account, and wait there for you to review. Tape setlists can be incomplete, so nothing is written until you accept one.'
                  : 'Tape setlists from the Internet Archive are waiting for you to review on My Shows. Tape setlists can be incomplete, so nothing is written until you accept one.'}
              </p>
            )}
            <div className="flex flex-wrap gap-3 justify-center">
              {result.unmatched.length > 0 && (
                <SecondaryButton onClick={() => downloadText(`not-imported-${fileName.replace(/\.[^.]+$/, '') || 'shows'}.csv`, unmatchedCsv(headers, result.unmatched))}>
                  <span className="inline-flex items-center gap-2"><FileWarning className="w-4 h-4" /> Download the {result.unmatched.length} not imported</span>
                </SecondaryButton>
              )}
              <PrimaryButton onClick={() => onNavigate && onNavigate('shows')}>View my shows</PrimaryButton>
              <SecondaryButton onClick={reset}>Import another file</SecondaryButton>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

export default ImportView;
