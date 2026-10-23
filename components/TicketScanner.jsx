'use client';

import React, { useState } from 'react';
import { toIsoDate } from '@/lib/utils';
import { Camera, X, RefreshCw, Search, Check, Download, Plus, ChevronDown } from 'lucide-react';
import { resizeImageForUpload } from '@/lib/utils';
import { apiUrl } from '@/lib/api';
import { isNativePlatform } from '@/lib/native-auth';
import { extractSongsFromSetlist } from '@/lib/setlistParser';
import { Card, Button } from '@/components/ui';
import {
  PERMISSION_KIND, requestNativePermission, openAppSettings,
} from '@/lib/nativePermissions';

function TicketScanner({ onImport, importedIds, existingShows }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [extractedShows, setExtractedShows] = useState([]);
  const [expandedSetlist, setExpandedSetlist] = useState(null);
  // Set when a permission is refused for good, so the error can offer the
  // only thing that actually fixes it rather than "please try again".
  const [permissionBlocked, setPermissionBlocked] = useState(false);

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    const imageFiles = selected.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setError('Please select image files (JPG, PNG, etc.)');
      return;
    }
    setFiles(prev => [...prev, ...imageFiles]);
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreviews(prev => [...prev, { name: file.name, url: ev.target.result }]);
      };
      reader.readAsDataURL(file);
    });
    setError('');
  };

  /**
   * Take a photo, or pick one from the library.
   *
   * `kind` is decided by which button the user pressed, BEFORE anything is
   * requested — see lib/nativePermissions.js for why that matters. The
   * previous version asked for both permissions at once and used
   * CameraSource.Prompt to decide afterwards, which is what stopped the
   * camera prompt from ever appearing.
   */
  const handleNativeCapture = async (kind) => {
    setError('');
    setPermissionBlocked(false);

    const verdict = await requestNativePermission(kind);
    if (!verdict.ok) {
      setPermissionBlocked(!!verdict.blocked);
      setError(
        verdict.blocked
          ? `${verdict.message} You can turn it back on in Settings.`
          : verdict.message,
      );
      return;
    }

    try {
      const { Camera: CapCamera, CameraResultType, CameraSource } = await import('@capacitor/camera');

      const photo = await CapCamera.getPhoto({
        quality: 90,
        resultType: CameraResultType.Uri,
        // Explicit, because the permission above was requested for this
        // one source. CameraSource.Prompt would let the user pick the
        // other one, for which they may have granted nothing.
        source: kind === PERMISSION_KIND.CAMERA ? CameraSource.Camera : CameraSource.Photos,
        correctOrientation: true,
        width: 1600,
        height: 1600,
        presentationStyle: 'fullScreen',
      });

      const photoUrl = photo.webPath || photo.dataUrl;
      if (photoUrl) {
        const res = await fetch(photoUrl);
        const blob = await res.blob();
        const file = new File([blob], `ticket-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
        setFiles(prev => [...prev, file]);
        setPreviews(prev => [...prev, { name: file.name, url: URL.createObjectURL(blob) }]);
        setError('');
      }
    } catch (err) {
      // Backing out of the camera or the picker is not an error.
      const msg = err?.message || '';
      if (/cancel|dismiss/i.test(msg)) return;
      console.error('Camera error:', err);
      setError(
        kind === PERMISSION_KIND.CAMERA
          ? 'Couldn’t open the camera. Please try again.'
          : 'Couldn’t open your photos. Please try again.',
      );
    }
  };

  const removeImage = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const analyzeTickets = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    setError('');
    setExtractedShows([]);

    try {
      const images = [];
      for (const file of files) {
        const { base64, mediaType } = await resizeImageForUpload(file);
        images.push({ base64, mediaType });
      }

      const response = await fetch(apiUrl('/.netlify/functions/analyze-tickets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images })
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned invalid response (status ${response.status}). Images may be too large — try fewer or smaller images.`);
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze tickets');
      }

      const shows = Array.isArray(data.shows) ? data.shows : [];
      if (shows.length === 0) {
        setError('No shows detected in the ticket images. Try different or clearer images.');
        setAnalyzing(false);
        return;
      }

      const initial = shows.map(s => ({
        ...s,
        setlistResults: [],
        searching: true,
        imported: false,
        noResults: false,
      }));
      setExtractedShows(initial);
      setAnalyzing(false);

      // Search setlist.fm for each extracted show
      for (let i = 0; i < shows.length; i++) {
        const show = shows[i];
        if (!show.artist) {
          setExtractedShows(prev => prev.map((s, idx) => idx === i ? { ...s, searching: false, noResults: true } : s));
          continue;
        }

        try {
          const artistParams = new URLSearchParams({ artistName: show.artist });
          const artistRes = await fetch(apiUrl(`/.netlify/functions/search-artists?${artistParams.toString()}`));
          let artistMbid = null;

          if (artistRes.ok) {
            const artistData = await artistRes.json();
            if (artistData.artist && artistData.artist.length > 0) {
              const exactMatch = artistData.artist.find(a => a.name.toLowerCase() === show.artist.toLowerCase());
              artistMbid = (exactMatch || artistData.artist[0]).mbid;
            }
          }

          const params = new URLSearchParams();
          if (artistMbid) {
            params.set('artistMbid', artistMbid);
          } else {
            params.set('artistName', show.artist);
          }
          if (show.date) {
            const yearMatch = show.date.match(/(\d{4})/);
            if (yearMatch) params.set('year', yearMatch[1]);
          }

          const setlistRes = await fetch(apiUrl(`/.netlify/functions/search-setlists?${params.toString()}`));

          if (setlistRes.ok) {
            const setlistData = await setlistRes.json();
            const results = setlistData.setlist || [];
            setExtractedShows(prev => prev.map((s, idx) =>
              idx === i ? { ...s, setlistResults: results.slice(0, 10), searching: false, noResults: results.length === 0 } : s
            ));
          } else {
            setExtractedShows(prev => prev.map((s, idx) =>
              idx === i ? { ...s, searching: false, noResults: true } : s
            ));
          }

          if (i < shows.length - 1) await new Promise(r => setTimeout(r, 400));
        } catch {
          setExtractedShows(prev => prev.map((s, idx) =>
            idx === i ? { ...s, searching: false, noResults: true } : s
          ));
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to analyze tickets. Please try again.');
      setAnalyzing(false);
    }
  };

  const importSetlist = (showIdx, setlist) => {
    const songs = extractSongsFromSetlist(setlist);

    onImport({
      artist: setlist.artist.name,
      venue: setlist.venue.name,
      city: setlist.venue.city.name,
      country: setlist.venue.city.country.name,
      // setlist.fm sends DD-MM-YYYY. Every other add path reverses it before
      // saving; this one stored it verbatim, so shows added by scanning a
      // ticket carried a date no band-source archive could be asked about.
      date: toIsoDate(setlist.eventDate) || setlist.eventDate,
      setlist: songs,
      setlistfmId: setlist.id,
      setlistfmUrl: setlist.url || null,
      tour: setlist.tour ? setlist.tour.name : null
    });

    setExtractedShows(prev => prev.map((s, idx) =>
      idx === showIdx ? { ...s, imported: true } : s
    ));
  };

  const importManually = (showIdx) => {
    const show = extractedShows[showIdx];
    onImport({
      artist: show.artist || '',
      venue: show.venue || '',
      city: show.city || '',
      date: toIsoDate(show.date) || show.date || '',
      setlist: [],
    });
    setExtractedShows(prev => prev.map((s, idx) =>
      idx === showIdx ? { ...s, imported: true } : s
    ));
  };

  const isAlreadyImported = (setlistId) => importedIds.has(setlistId);

  const formatSetlistDate = (dateStr) => {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).toLocaleDateString();
    }
    return dateStr;
  };

  const reset = () => {
    setFiles([]);
    setPreviews([]);
    setExtractedShows([]);
    setError('');
    setExpandedSetlist(null);
  };

  return (
    <div>
      {/* Upload Area */}
      {extractedShows.length === 0 && (
        <Card padding="md" className="mb-6">
          <div className="flex flex-col items-center justify-center py-8">
            <Camera className="w-12 h-12 text-muted mb-4" />
            <p className="text-secondary mb-4 text-center">
              Upload photos of your concert ticket stubs or digital tickets
            </p>
            {isNativePlatform() ? (
              /* Two buttons, not one: the permission is requested for the
                 source the user actually chose, at the moment they choose
                 it. That is both the fix for the dropped camera prompt and
                 what Guideline 5.1.1 means by asking in context. */
              <div className="flex flex-wrap gap-2.5 justify-center">
                <Button variant="primary" icon={Camera}
                        onClick={() => handleNativeCapture(PERMISSION_KIND.CAMERA)}>
                  Take Photo
                </Button>
                <Button variant="secondary"
                        onClick={() => handleNativeCapture(PERMISSION_KIND.PHOTOS)}>
                  Choose from Library
                </Button>
              </div>
            ) : (
              <label className="inline-flex items-center justify-center gap-2 text-[15px] font-bold px-[18px] py-2.5 rounded-full cursor-pointer whitespace-nowrap select-none transition-all duration-150 bg-brand text-[#2a2a4e] hover:bg-[#059669] shadow-[0_1px_2px_rgba(16,185,129,0.25)] hover:shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:-translate-y-0.5 active:translate-y-0">
                <Camera size={16} strokeWidth={2.4} />
                {files.length > 0 ? 'Add More Images' : 'Select Images'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Image Previews */}
          {previews.length > 0 && (
            <div className="mt-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {previews.map((preview, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={preview.url}
                      alt={preview.name}
                      className="w-full h-32 object-cover rounded-xl border border-subtle"
                    />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-1 right-1 p-1 bg-sidebar/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4 text-on-dark" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-sidebar/50 text-on-dark-muted text-xs px-2 py-1 rounded-b-xl truncate">
                      {preview.name}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-4">
                <Button
                  variant="primary"
                  full
                  icon={analyzing ? undefined : Search}
                  loading={analyzing}
                  onClick={analyzeTickets}
                  disabled={analyzing}
                >
                  {analyzing
                    ? `Analyzing ${files.length} ticket${files.length !== 1 ? 's' : ''}...`
                    : `Analyze ${files.length} Ticket${files.length !== 1 ? 's' : ''}`}
                </Button>
                <Button variant="secondary" onClick={reset} disabled={analyzing}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-xl p-4 mb-6">
          <p className="text-danger text-sm">{error}</p>
          {/* A refused permission cannot be re-requested — iOS will not
              show the prompt a second time — so "please try again" is a
              dead end and Settings is the only thing that fixes it. */}
          {permissionBlocked && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={openAppSettings}
              data-testid="open-settings"
            >
              Open Settings
            </Button>
          )}
        </div>
      )}

      {/* Results */}
      {extractedShows.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-primary">
              Found {extractedShows.length} show{extractedShows.length !== 1 ? 's' : ''} from tickets
            </h2>
            <Button variant="secondary" size="sm" icon={Camera} onClick={reset}>
              Scan More
            </Button>
          </div>

          {extractedShows.map((show, showIdx) => (
            <Card key={showIdx} padding="none" className="overflow-hidden">
              {/* Extracted show header */}
              <div className="p-4 border-b border-subtle bg-base">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-primary">{show.artist || 'Unknown Artist'}</div>
                    <div className="text-sm text-secondary mt-1">
                      {show.venue || 'Unknown Venue'}
                      {show.city && <span> &middot; {show.city}</span>}
                    </div>
                    {show.date && (
                      <div className="text-sm text-muted mt-1">
                        {(() => { try { return new Date(show.date).toLocaleDateString(); } catch { return show.date; } })()}
                      </div>
                    )}
                  </div>
                  {show.imported && (
                    <span className="flex items-center gap-1 text-sm text-brand">
                      <Check className="w-4 h-4" />
                      Imported
                    </span>
                  )}
                </div>
              </div>

              {/* Setlist search results */}
              <div className="p-4">
                {show.searching && (
                  <div className="flex items-center gap-3 text-secondary text-sm py-4">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Searching setlist.fm for matching shows...
                  </div>
                )}

                {!show.searching && show.noResults && !show.imported && (
                  <div className="text-center py-4">
                    <p className="text-muted text-sm mb-3">No setlists found on setlist.fm</p>
                    <Button variant="secondary" size="sm" icon={Plus} onClick={() => importManually(showIdx)}>
                      Add Without Setlist
                    </Button>
                  </div>
                )}

                {!show.searching && show.setlistResults.length > 0 && !show.imported && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted uppercase tracking-wide mb-2">Select matching setlist:</p>
                    {show.setlistResults.map((setlist) => {
                      const songCount = setlist.sets?.set?.reduce((acc, s) => acc + (s.song?.length || 0), 0) || 0;
                      const isExpanded = expandedSetlist === `${showIdx}-${setlist.id}`;
                      const alreadyAdded = isAlreadyImported(setlist.id);

                      return (
                        <div key={setlist.id} className="bg-surface border border-subtle rounded-xl overflow-hidden">
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-primary">{setlist.artist.name}</div>
                                <div className="text-xs text-secondary mt-0.5">
                                  {setlist.venue.name} &middot; {setlist.venue.city.name}
                                </div>
                                <div className="text-xs text-muted mt-0.5">
                                  {formatSetlistDate(setlist.eventDate)}
                                  {setlist.tour && <span className="text-brand ml-2">{setlist.tour.name}</span>}
                                </div>
                                {songCount > 0 && (
                                  <button
                                    onClick={() => setExpandedSetlist(isExpanded ? null : `${showIdx}-${setlist.id}`)}
                                    className="flex items-center gap-1 text-xs text-secondary hover:text-primary mt-1 transition-colors"
                                  >
                                    <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    {songCount} songs
                                  </button>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={alreadyAdded ? 'ghost' : 'secondary'}
                                icon={alreadyAdded ? Check : Download}
                                onClick={() => !alreadyAdded && importSetlist(showIdx, setlist)}
                                disabled={alreadyAdded}
                                className={alreadyAdded ? 'bg-brand-subtle text-brand cursor-default' : ''}
                              >
                                {alreadyAdded ? 'Added' : 'Add'}
                              </Button>
                            </div>
                          </div>

                          {isExpanded && setlist.sets?.set && (
                            <div className="border-t border-subtle bg-base p-3">
                              <div className="space-y-1 max-h-48 overflow-y-auto">
                                {setlist.sets.set.map((set, setIdx) => (
                                  <div key={setIdx}>
                                    {set.name && (
                                      <div className="text-xs font-semibold text-brand uppercase tracking-wide mt-1 mb-1">{set.name}</div>
                                    )}
                                    {set.encore && !set.name && (
                                      <div className="text-xs font-semibold text-brand uppercase tracking-wide mt-1 mb-1">Encore</div>
                                    )}
                                    {set.song?.map((song, songIdx) => (
                                      <div key={songIdx} className="flex items-center gap-2 py-0.5 text-xs text-secondary">
                                        <span className="text-muted w-5 text-right">{songIdx + 1}.</span>
                                        <span>{song.name}</span>
                                        {song.cover && <span className="text-muted">({song.cover.name} cover)</span>}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default TicketScanner;
