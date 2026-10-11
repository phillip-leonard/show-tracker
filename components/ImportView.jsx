'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Music, Check, Download, Upload, AlertTriangle, Camera, RefreshCw } from 'lucide-react';
import { formatDate, parseCSV, parseImportDate, autoDetectMapping, resizeImageForUpload } from '@/lib/utils';
import { IMPORT_FIELDS } from '@/lib/constants';
import Tip from '@/components/ui/Tip';
import { apiUrl } from '@/lib/api';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import { fetchBandSetlist } from '@/lib/bandSetlist';

function ImportView({ onImport, onUpdateShow, existingShows, onNavigate }) {
  const [step, setStep] = useState('upload');
  const [fileName, setFileName] = useState('');
  const [rawData, setRawData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importResults, setImportResults] = useState({ imported: 0, failed: 0, skipped: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [setlistFetchStep, setSetlistFetchStep] = useState(null); // null | 'fetching' | 'complete'
  const [setlistFetchProgress, setSetlistFetchProgress] = useState(0);
  const [setlistFetchTotal, setSetlistFetchTotal] = useState(0);
  const [setlistsFound, setSetlistsFound] = useState(0);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotError, setScreenshotError] = useState(null);
  const [failedRows, setFailedRows] = useState([]);

  const fields = IMPORT_FIELDS;

  const processFileData = (rows) => {
    if (rows.length < 2) {
      setParseError('File must contain a header row and at least one data row.');
      return;
    }
    const hdrs = rows[0];
    const data = rows.slice(1).filter(row => row.some(cell => cell !== ''));
    if (data.length === 0) {
      setParseError('No data rows found in file.');
      return;
    }
    setHeaders(hdrs);
    setRawData(data);
    const detected = autoDetectMapping(hdrs);
    setMapping(detected);
    setStep('mapping');
    setParseError(null);
  };

  const handleFile = async (file) => {
    setFileName(file.name);
    setParseError(null);
    setScreenshotError(null);
    const extMatch = file.name.match(/\.([^.]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';

    if (ext === 'csv') {
      const text = await file.text();
      const rows = parseCSV(text);
      processFileData(rows);
    } else if (ext === 'xlsx' || ext === 'xls') {
      try {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const stringRows = rows.map(row => row.map(cell => String(cell)));
        processFileData(stringRows);
      } catch (err) {
        setParseError('Failed to read Excel file. Please ensure it is a valid .xlsx or .xls file.');
      }
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      await handleScreenshot(file);
    } else {
      setParseError('Unsupported file type. Please upload a .csv, .xlsx, .xls, or image file (.png, .jpg).');
    }
  };

  const handleScreenshot = async (file) => {
    setScreenshotAnalyzing(true);
    setScreenshotError(null);

    try {
      const { base64, mediaType } = await resizeImageForUpload(file);

      const response = await fetch(apiUrl('/.netlify/functions/analyze-screenshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType })
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Server returned invalid response (status ${response.status}). The image may be too large \u2014 try cropping it or using a smaller screenshot.`);
      }

      if (!response.ok) {
        const detail = data.details ? ` (${JSON.stringify(data.details)})` : '';
        throw new Error((data.error || 'Failed to analyze screenshot') + detail);
      }

      const shows = Array.isArray(data.shows) ? data.shows : [];
      if (shows.length === 0) {
        setScreenshotError('No shows were detected in this screenshot. Try a different image showing your past events.');
        setScreenshotAnalyzing(false);
        return;
      }

      const rows = [];
      for (const show of shows) {
        try {
          const record = {
            artist: show.artist || '',
            venue: show.venue || '',
            date: show.date || '',
            city: show.city || '',
            country: '',
            rating: '',
            comment: '',
            tour: '',
          };

          const errors = [];
          if (!record.artist) errors.push('Missing artist');
          if (!record.venue) errors.push('Missing venue');
          if (!record.date) errors.push('Missing date');

          let parsedDate = null;
          if (record.date) {
            parsedDate = parseImportDate(record.date);
            if (!parsedDate) errors.push('Invalid date');
          }

          const isDuplicate = parsedDate && existingShows.some(s =>
            s.artist?.toLowerCase() === record.artist?.toLowerCase() &&
            s.venue?.toLowerCase() === record.venue?.toLowerCase() &&
            s.date === parsedDate
          );

          rows.push({
            raw: record,
            parsedDate,
            rating: null,
            errors,
            isDuplicate,
            skip: isDuplicate,
          });
        } catch (rowErr) {
          console.error('Error processing show:', show, rowErr);
        }
      }

      setPreviewRows(rows);
      setStep('preview');
    } catch (err) {
      setScreenshotError(err.message || 'Failed to analyze screenshot. Please try again.');
    } finally {
      setScreenshotAnalyzing(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  };

  // Build preview rows with validation
  const buildPreviewRows = useCallback(() => {
    return rawData.map((row) => {
      const record = {};
      const errors = [];

      fields.forEach(field => {
        const colIndex = mapping[field.key];
        const value = colIndex !== undefined && colIndex !== '' ? (row[colIndex] || '') : '';
        record[field.key] = value;
      });

      if (!record.artist) errors.push('Missing artist');
      if (!record.venue) errors.push('Missing venue');
      if (!record.date) errors.push('Missing date');

      let parsedDate = null;
      if (record.date) {
        parsedDate = parseImportDate(record.date);
        if (!parsedDate) errors.push('Invalid date');
      }

      let rating = null;
      if (record.rating) {
        const r = Number(record.rating);
        if (isNaN(r) || r < 1 || r > 10) {
          errors.push('Rating must be 1-10');
        } else {
          rating = r;
        }
      }

      const isDuplicate = parsedDate && existingShows.some(show =>
        show.artist?.toLowerCase() === record.artist?.toLowerCase() &&
        show.venue?.toLowerCase() === record.venue?.toLowerCase() &&
        show.date === parsedDate &&
        (!record.city || !show.city || show.city.toLowerCase() === record.city.toLowerCase())
      );

      return {
        raw: record,
        parsedDate,
        rating,
        errors,
        isDuplicate,
        skip: isDuplicate,
      };
    });
  }, [rawData, mapping, existingShows, fields]);

  useEffect(() => {
    if (step === 'preview' && headers.length > 0) {
      setPreviewRows(buildPreviewRows());
    }
  }, [step, headers.length, buildPreviewRows]);

  const validRows = previewRows.filter(r => r.errors.length === 0 && !r.skip);
  const errorRows = previewRows.filter(r => r.errors.length > 0);
  const duplicateRows = previewRows.filter(r => r.isDuplicate && r.errors.length === 0);

  const toggleRowSkip = (index) => {
    setPreviewRows(prev => prev.map((row, i) => i === index ? { ...row, skip: !row.skip } : row));
  };

  const downloadTemplate = () => {
    const header = fields.map(f => f.label).join(',');
    const example = '"The Strokes","Madison Square Garden","2024-06-15","New York","USA","9","Incredible energy","This Is It Tour"';
    const blob = new Blob([`${header}\n${example}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'show-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const fetchSetlistForShow = async ({ artist, date, venue }) => {
    try {
      if (!artist || !date) return null;

      // A band source owns this artist? One date-addressed request, and
      // we're done — no page loop, no name variants. Falls through to the
      // setlist.fm search below on any failure, silently, which is the
      // whole contract of lib/bandSetlist.js.
      const band = await fetchBandSetlist({ artist, date, venue });
      if (band) {
        return {
          setlist: band.songs,
          setlistfmId: null,
          tour: band.tour || null,
          setlistSource: band.source,
          sourceShowId: band.sourceShowId,
          sourcePermalink: band.sourcePermalink,
          setlistNotes: band.setlistNotes,
        };
      }

      const year = date.split('-')[0];

      const searchAndMatch = async (searchArtist) => {
        for (let page = 1; page <= 3; page++) {
          const params = new URLSearchParams({ artistName: searchArtist, year, p: String(page) });
          const response = await fetch(apiUrl(`/.netlify/functions/search-setlists?${params.toString()}`));
          if (!response.ok) return null;
          const data = await response.json();
          if (!data.setlist || data.setlist.length === 0) return null;

          const match = data.setlist.find(s => {
            if (!s.eventDate) return false;
            const parts = s.eventDate.split('-');
            if (parts.length !== 3) return false;
            return `${parts[2]}-${parts[1]}-${parts[0]}` === date;
          });

          if (match) return match;
          if (data.setlist.length < 20) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        return null;
      };

      let match = await searchAndMatch(artist);

      if (!match && artist.includes('&')) {
        match = await searchAndMatch(artist.replace(/&/g, 'and'));
      }
      if (!match && artist.toLowerCase().startsWith('the ')) {
        match = await searchAndMatch(artist.substring(4));
      } else if (!match) {
        match = await searchAndMatch('The ' + artist);
      }

      if (!match) return null;

      const songs = extractSongsFromSetlist(match);

      if (songs.length === 0) return null;

      return {
        setlist: songs,
        setlistfmId: match.id,
        tour: match.tour ? match.tour.name : null,
        setlistSource: 'setlistfm',
      };
    } catch (err) {
      console.warn('Setlist fetch failed for', artist, date, err);
      return null;
    }
  };

  const handleStartImport = async (rowsOverride) => {
    const toImport = rowsOverride || validRows.filter(r => !r.skip);
    setImportTotal(toImport.length);
    setImportProgress(0);
    setSetlistFetchStep(null);
    setSetlistFetchProgress(0);
    setSetlistsFound(0);
    setStep('importing');

    let imported = 0;
    let failed = 0;
    const importedShows = [];
    const newlyFailedRows = [];

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i];
      try {
        const showData = {
          artist: row.raw.artist,
          venue: row.raw.venue,
          date: row.parsedDate,
          city: row.raw.city || '',
          country: row.raw.country || '',
          rating: row.rating || null,
          comment: row.raw.comment || '',
          tour: row.raw.tour || '',
          setlist: [],
        };
        // Silent: a row-by-row import would otherwise flash one "Added" toast per row.
        const showId = await onImport(showData, { silent: true });
        imported++;
        if (showId) {
          importedShows.push({ showId, artist: showData.artist, date: showData.date, venue: showData.venue, city: showData.city });
        }
      } catch (err) {
        failed++;
        newlyFailedRows.push({ ...row, error: err.message || 'Import failed' });
      }
      setImportProgress(i + 1);
      if (i < toImport.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    setFailedRows(newlyFailedRows);

    if (importedShows.length > 0 && onUpdateShow) {
      setSetlistFetchStep('fetching');
      setSetlistFetchTotal(importedShows.length);
      let found = 0;

      for (let i = 0; i < importedShows.length; i++) {
        const show = importedShows[i];
        try {
          const result = await fetchSetlistForShow({ artist: show.artist, date: show.date, venue: show.venue });
          if (result) {
            const updates = {
              setlist: result.setlist,
              setlistfmId: result.setlistfmId,
              isManual: false,
              setlistSource: result.setlistSource || 'setlistfm',
            };
            if (result.tour) updates.tour = result.tour;
            // Band-source-only show fields. Absent on the setlist.fm path,
            // so a non-Goose/Phish import writes exactly what it wrote
            // before plus the explicit source stamp.
            if (result.sourceShowId) updates.sourceShowId = result.sourceShowId;
            if (result.sourcePermalink) updates.sourcePermalink = result.sourcePermalink;
            if (result.setlistNotes) updates.setlistNotes = result.setlistNotes;
            if (result.setlistSource && result.setlistSource !== 'setlistfm') {
              updates.setlistFetchedAt = new Date().toISOString();
            }
            await onUpdateShow(show.showId, updates);
            found++;
          }
        } catch (err) {
          console.warn('Setlist fetch error for', show.artist, show.date, err);
        }
        setSetlistFetchProgress(i + 1);
        setSetlistsFound(found);
        if (i < importedShows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      setSetlistFetchStep('complete');
    }

    setImportResults(prev => ({
      imported: (rowsOverride ? prev.imported : 0) + imported,
      failed,
      skipped: rowsOverride ? prev.skipped : previewRows.length - toImport.length,
    }));
    setStep('complete');
  };

  const handleRetryFailed = () => {
    if (failedRows.length === 0) return;
    handleStartImport(failedRows);
  };

  const resetImport = () => {
    setStep('upload');
    setFileName('');
    setRawData([]);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    setImportProgress(0);
    setImportTotal(0);
    setImportResults({ imported: 0, failed: 0, skipped: 0 });
    setParseError(null);
    setSetlistFetchStep(null);
    setSetlistFetchProgress(0);
    setSetlistFetchTotal(0);
    setSetlistsFound(0);
    setScreenshotAnalyzing(false);
    setScreenshotError(null);
    setFailedRows([]);
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Step indicator */}
      {(() => {
        const isScreenshotFlow = headers.length === 0 && step !== 'upload';
        const stepLabels = isScreenshotFlow
          ? ['Upload', 'Preview', 'Import']
          : ['Upload', 'Map Columns', 'Preview', 'Import'];
        const stepKeys = isScreenshotFlow
          ? ['upload', 'preview', 'importing', 'complete']
          : ['upload', 'mapping', 'preview', 'importing', 'complete'];
        const stepIndex = stepKeys.indexOf(step);
        const maxStepIndex = stepLabels.length - 1;

        return (
          <div className="flex items-center gap-2 mb-8">
            {stepLabels.map((label, i) => {
              const isActive = i <= stepIndex;
              const isCurrent = i === Math.min(stepIndex, maxStepIndex);
              return (
                <React.Fragment key={label}>
                  {i > 0 && <div className={`flex-1 h-0.5 ${isActive ? 'bg-brand' : 'bg-hover'}`} />}
                  <div className={`flex items-center gap-2 ${isCurrent ? 'text-brand' : isActive ? 'text-secondary' : 'text-muted'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      isActive ? 'bg-brand-subtle border border-brand/50' : 'bg-hover border border-subtle'
                    }`}>
                      {i < stepIndex ? <Check className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium">{label}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        );
      })()}

      {/* Upload Step */}
      {step === 'upload' && (
        <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-8">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
              screenshotAnalyzing ? 'border-amber bg-amber-subtle' :
              dragOver ? 'border-brand bg-brand-subtle' : 'border-active hover:border-white/40 cursor-pointer'
            }`}
            onClick={() => !screenshotAnalyzing && document.getElementById('import-file-input').click()}
          >
            {screenshotAnalyzing ? (
              <>
                <Camera className="w-12 h-12 mx-auto mb-4 text-amber animate-pulse" />
                <p className="text-lg font-medium text-primary mb-2">Analyzing Screenshot...</p>
                <p className="text-secondary mb-4">AI is identifying shows from your image</p>
                <div className="w-48 h-1.5 bg-hover rounded-full mx-auto overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber to-amber rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
              </>
            ) : (
              <>
                <Upload className={`w-12 h-12 mx-auto mb-4 ${dragOver ? 'text-brand' : 'text-muted'}`} />
                <p className="text-lg font-medium text-primary mb-2">
                  {dragOver ? 'Drop your file here' : 'Drag & drop your file here'}
                </p>
                <p className="text-secondary mb-4">or click to browse</p>
                <p className="text-muted text-sm">Supports .csv, .xlsx, .xls, and screenshot images (.png, .jpg)</p>
              </>
            )}
            <input
              id="import-file-input"
              type="file"
              accept=".csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          {parseError && (
            <div className="mt-4 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-danger text-sm">{parseError}</p>
            </div>
          )}

          {screenshotError && (
            <div className="mt-4 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-danger text-sm">{screenshotError}</p>
            </div>
          )}

          <div className="mt-8 p-4 bg-hover rounded-xl">
            <h3 className="text-primary font-medium mb-3">Import options</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li className="flex items-start gap-2">
                <Upload className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                <span>CSV or Excel file with columns for Artist, Venue, Date (+ optional City, Rating, etc.)</span>
              </li>
              <li className="flex items-start gap-2">
                <Camera className="w-4 h-4 text-amber mt-0.5 flex-shrink-0" />
                <span>Screenshot from Ticketmaster, AXS, or any ticket platform showing your past events</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                <span>Google Sheets: File &rarr; Download &rarr; CSV or Excel</span>
              </li>
            </ul>
            <button
              onClick={downloadTemplate}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-hover hover:bg-active border border-subtle rounded-lg text-secondary text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Download CSV template
            </button>
          </div>
        </div>
      )}

      {/* Mapping Step */}
      {step === 'mapping' && (
        <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-primary">Map Your Columns</h2>
              <p className="text-secondary text-sm mt-1">
                We detected {headers.length} columns from <span className="text-secondary">{fileName}</span>
              </p>
            </div>
          </div>

          <div className="space-y-4 mb-8">
            {fields.map(field => (
              <div key={field.key} className="flex items-center gap-4">
                <label className="w-28 text-sm text-secondary flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-danger">*</span>}
                </label>
                <select
                  value={mapping[field.key] !== undefined ? mapping[field.key] : ''}
                  onChange={(e) => setMapping(prev => ({
                    ...prev,
                    [field.key]: e.target.value === '' ? undefined : Number(e.target.value)
                  }))}
                  className="flex-1 px-4 py-2.5 bg-hover border border-subtle rounded-xl text-primary focus:outline-none focus:ring-2 focus:ring-brand/50 [&>option]:bg-elevated"
                >
                  <option value="">&mdash; Skip &mdash;</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Preview of first 3 rows */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-secondary mb-3">Preview (first 3 rows)</h3>
            <div data-no-swipe className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle">
                    {fields.filter(f => mapping[f.key] !== undefined).map(f => (
                      <th key={f.key} className="text-left px-3 py-2 text-secondary font-medium">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawData.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-b border-subtle">
                      {fields.filter(f => mapping[f.key] !== undefined).map(f => (
                        <td key={f.key} className="px-3 py-2 text-secondary">{row[mapping[f.key]] || '\u2014'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={resetImport}
              className="px-5 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => {
                const missingRequired = fields
                  .filter(f => f.required && mapping[f.key] === undefined)
                  .map(f => f.label);
                if (missingRequired.length > 0) {
                  setParseError(`Please map required columns: ${missingRequired.join(', ')}`);
                  return;
                }
                setParseError(null);
                setStep('preview');
              }}
              className="px-5 py-2.5 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary rounded-xl font-medium transition-all shadow-lg shadow-brand/20"
            >
              Preview Import
            </button>
          </div>

          {parseError && (
            <div className="mt-4 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-danger text-sm">{parseError}</p>
            </div>
          )}
        </div>
      )}

      {/* Preview Step */}
      {step === 'preview' && (
        <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-primary">Review Import</h2>
              <p className="text-secondary text-sm mt-1">{previewRows.length} rows found in {fileName}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mb-6">
            <span className="px-3 py-1.5 bg-brand-subtle text-brand rounded-lg text-sm font-medium">
              {validRows.length} ready to import
            </span>
            {errorRows.length > 0 && (
              <span className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-sm font-medium">
                {errorRows.length} with errors
              </span>
            )}
            {duplicateRows.length > 0 && (
              <span className="px-3 py-1.5 bg-brand-subtle text-brand rounded-lg text-sm font-medium">
                {duplicateRows.length} possible duplicates
              </span>
            )}
          </div>

          {duplicateRows.length > 0 && (
            <p className="text-muted text-xs mb-4">
              Possible duplicates are unchecked by default. Use the "Import?" checkbox on a row to include it anyway.
            </p>
          )}

          <div data-no-swipe className="overflow-x-auto mb-6 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-elevated/95">
                <tr className="border-b border-subtle">
                  <th className="text-left px-3 py-2 text-secondary font-medium w-8">#</th>
                  <th className="text-left px-3 py-2 text-secondary font-medium">Artist</th>
                  <th className="text-left px-3 py-2 text-secondary font-medium">Venue</th>
                  <th className="text-left px-3 py-2 text-secondary font-medium">Date</th>
                  <th className="text-left px-3 py-2 text-secondary font-medium">City</th>
                  <th className="text-left px-3 py-2 text-secondary font-medium w-24">Status</th>
                  <th className="text-left px-3 py-2 text-secondary font-medium w-16">Import?</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-subtle ${
                      row.errors.length > 0
                        ? 'bg-danger/5'
                        : row.isDuplicate
                        ? 'bg-brand/5'
                        : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-muted">{i + 1}</td>
                    <td className="px-3 py-2 text-secondary">{row.raw.artist || '\u2014'}</td>
                    <td className="px-3 py-2 text-secondary">{row.raw.venue || '\u2014'}</td>
                    <td className="px-3 py-2 text-secondary">
                      {row.parsedDate ? formatDate(row.parsedDate) : <span className="text-danger">{row.raw.date || '\u2014'}</span>}
                    </td>
                    <td className="px-3 py-2 text-secondary">{row.raw.city || '\u2014'}</td>
                    <td className="px-3 py-2">
                      {row.errors.length > 0 ? (
                        <Tip text={row.errors.join(', ')}>
                          <span className="text-danger text-xs">
                            <AlertTriangle className="w-4 h-4 inline mr-1" />
                            Error
                          </span>
                        </Tip>
                      ) : row.isDuplicate ? (
                        <span className="text-brand text-xs">Duplicate?</span>
                      ) : (
                        <span className="text-brand text-xs">
                          <Check className="w-4 h-4 inline" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.errors.length === 0 && (
                        <input
                          type="checkbox"
                          checked={!row.skip}
                          onChange={() => toggleRowSkip(i)}
                          className="w-4 h-4 accent-brand cursor-pointer"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {errorRows.length > 0 && (
            <div className="mb-6 p-4 bg-danger/10 border border-danger/20 rounded-xl">
              <p className="text-danger text-sm font-medium mb-2">Rows with errors will be skipped:</p>
              <ul className="text-danger/70 text-xs space-y-1">
                {errorRows.slice(0, 5).map((row, i) => (
                  <li key={i}>Row {previewRows.indexOf(row) + 1}: {row.errors.join(', ')}</li>
                ))}
                {errorRows.length > 5 && (
                  <li>...and {errorRows.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => headers.length === 0 ? resetImport() : setStep('mapping')}
              className="px-5 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleStartImport}
              disabled={validRows.length === 0}
              className={`px-5 py-2.5 rounded-xl font-medium transition-all shadow-lg ${
                validRows.length > 0
                  ? 'bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary shadow-brand/20'
                  : 'bg-hover text-muted cursor-not-allowed shadow-none'
              }`}
            >
              Import {validRows.length} Show{validRows.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Importing Step */}
      {step === 'importing' && (
        <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-8 text-center">
          {!setlistFetchStep ? (
            <>
              <div className="w-16 h-16 bg-brand-subtle rounded-full flex items-center justify-center mx-auto mb-6">
                <Download className="w-8 h-8 text-brand animate-pulse" />
              </div>
              <h2 className="text-lg font-semibold text-primary mb-2">Importing Shows...</h2>
              <p className="text-secondary mb-6">{importProgress} of {importTotal}</p>
              <div className="w-full bg-hover rounded-full h-3 overflow-hidden max-w-md mx-auto">
                <div
                  className="h-full bg-gradient-to-r from-brand to-amber rounded-full transition-all duration-300"
                  style={{ width: `${importTotal > 0 ? (importProgress / importTotal) * 100 : 0}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-amber-subtle rounded-full flex items-center justify-center mx-auto mb-6">
                <Music className="w-8 h-8 text-amber animate-pulse" />
              </div>
              <h2 className="text-lg font-semibold text-primary mb-2">Fetching Setlists...</h2>
              <p className="text-secondary mb-2">Searching setlist.fm for your shows</p>
              <p className="text-secondary mb-6">{setlistFetchProgress} of {setlistFetchTotal} &mdash; {setlistsFound} found</p>
              <div className="w-full bg-hover rounded-full h-3 overflow-hidden max-w-md mx-auto">
                <div
                  className="h-full bg-gradient-to-r from-amber to-amber rounded-full transition-all duration-300"
                  style={{ width: `${setlistFetchTotal > 0 ? (setlistFetchProgress / setlistFetchTotal) * 100 : 0}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Complete Step */}
      {step === 'complete' && (
        <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-brand-subtle rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-brand" />
          </div>
          <h2 className="text-lg font-semibold text-primary mb-2">Import Complete!</h2>

          <div className="flex flex-wrap justify-center gap-4 my-6">
            <div className="px-4 py-3 bg-brand-subtle rounded-xl">
              <p className="text-2xl font-bold text-brand">{importResults.imported}</p>
              <p className="text-secondary text-sm">Imported</p>
            </div>
            {importResults.failed > 0 && (
              <div className="px-4 py-3 bg-danger/10 rounded-xl">
                <p className="text-2xl font-bold text-danger">{importResults.failed}</p>
                <p className="text-secondary text-sm">Failed</p>
              </div>
            )}
            {importResults.skipped > 0 && (
              <div className="px-4 py-3 bg-hover rounded-xl">
                <p className="text-2xl font-bold text-secondary">{importResults.skipped}</p>
                <p className="text-secondary text-sm">Skipped</p>
              </div>
            )}
            {setlistsFound > 0 && (
              <div className="px-4 py-3 bg-amber-subtle rounded-xl">
                <p className="text-2xl font-bold text-amber">{setlistsFound}</p>
                <p className="text-secondary text-sm">Setlists Found</p>
              </div>
            )}
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={() => onNavigate('shows')}
              className="px-5 py-2.5 bg-gradient-to-r from-brand to-amber hover:from-brand hover:to-amber text-primary rounded-xl font-medium transition-all shadow-lg shadow-brand/20"
            >
              View My Shows
            </button>
            {failedRows.length > 0 && (
              <button
                onClick={handleRetryFailed}
                className="px-5 py-2.5 bg-danger/10 hover:bg-danger/20 text-danger rounded-xl font-medium transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry {failedRows.length} Failed
              </button>
            )}
            <button
              onClick={resetImport}
              className="px-5 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium transition-colors"
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImportView;
