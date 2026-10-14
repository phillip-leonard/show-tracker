'use client';

import React, { useState, useEffect } from 'react';
import { Star, X, RefreshCw } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { collection, doc, setDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

function VenueRatingModal({ show, currentUser, onClose, onSaved }) {
  const SUB_LABELS = [
    { key: 'soundQuality', label: 'Sound Quality' },
    { key: 'sightlines', label: 'Sightlines' },
    { key: 'atmosphere', label: 'Atmosphere' },
    { key: 'accessibility', label: 'Accessibility' },
    { key: 'foodDrinks', label: 'Food & Drinks' },
  ];

  const [overallRating, setOverallRating] = useState(0);
  const [subRatings, setSubRatings] = useState({ soundQuality: 0, sightlines: 0, atmosphere: 0, accessibility: 0, foodDrinks: 0 });
  const [review, setReview] = useState('');
  const [existingId, setExistingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const venueKey = `${(show.venue || '').trim().toLowerCase()}::${(show.city || '').trim().toLowerCase()}`;

  useEffect(() => {
    async function loadExisting() {
      if (!currentUser) { setLoading(false); return; }
      try {
        const snap = await getDocs(query(
          collection(db, 'venueRatings'),
          where('venueKey', '==', venueKey),
          where('userId', '==', currentUser.uid)
        ));
        if (!snap.empty) {
          const d = snap.docs[0].data();
          setExistingId(snap.docs[0].id);
          setOverallRating(d.overallRating || 0);
          setSubRatings({ soundQuality: 0, sightlines: 0, atmosphere: 0, accessibility: 0, foodDrinks: 0, ...d.subRatings });
          setReview(d.review || '');
        }
      } catch (e) {
        console.error('Failed to load venue rating:', e);
      }
      setLoading(false);
    }
    loadExisting();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!overallRating) return;
    setSaving(true);
    try {
      const docId = existingId || `${currentUser.uid}_${venueKey.replace(/[^a-z0-9]/g, '_').slice(0, 60)}`;
      await setDoc(doc(db, 'venueRatings', docId), {
        venueName: (show.venue || '').trim().toLowerCase(),
        venueCity: (show.city || '').trim().toLowerCase(),
        venueKey,
        venueDisplayName: show.venue || '',
        venueCityDisplay: show.city || '',
        userId: currentUser.uid,
        userDisplayName: currentUser.displayName || 'Anonymous',
        overallRating,
        subRatings,
        review: review.trim() || null,
        updatedAt: serverTimestamp(),
        ...(existingId ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });
      if (onSaved) onSaved(); else onClose();
    } catch (e) {
      console.error('Failed to save venue rating:', e);
      alert('Failed to save rating. Please try again.');
    }
    setSaving(false);
  };

  const StarPicker = ({ value, onChange, size = 'w-7 h-7' }) => (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? 0 : n)}
          className={`${size} transition-colors ${n <= value ? 'text-brand' : 'text-muted hover:text-brand/50'}`}
        >
          <Star className="w-full h-full" fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 md:left-64 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <Card variant="elevated" padding="none" className="w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-subtle flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-primary">{existingId ? 'Edit Your Rating' : 'Rate This Venue'}</h2>
            <p className="text-secondary text-sm mt-0.5">{show.venue}{show.city ? `, ${show.city}` : ''}</p>
          </div>
          <Button variant="ghost" icon={X} onClick={onClose} />
        </div>
        {loading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <RefreshCw className="w-6 h-6 text-muted animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Overall rating */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-2">Overall Rating <span className="text-danger">*</span></label>
              <StarPicker value={overallRating} onChange={setOverallRating} size="w-9 h-9" />
            </div>
            {/* Sub-ratings */}
            <div className="space-y-3">
              <p className="text-sm text-secondary">Optional sub-ratings</p>
              {SUB_LABELS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-secondary w-32">{label}</span>
                  <StarPicker value={subRatings[key] || 0} onChange={v => setSubRatings(p => ({ ...p, [key]: v }))} />
                </div>
              ))}
            </div>
            {/* Review */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-2">Review <span className="text-muted">(optional)</span></label>
              <textarea
                value={review}
                onChange={e => setReview(e.target.value.slice(0, 500))}
                placeholder="What did you think of the venue?"
                rows={3}
                className="w-full px-4 py-2.5 bg-hover border border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/50 text-primary text-sm placeholder-muted resize-none"
              />
              <p className="text-xs text-muted mt-1 text-right">{review.length}/500</p>
            </div>
          </div>
        )}
        <div className="p-6 border-t border-subtle flex gap-3">
          <Button variant="ghost" full onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            full
            onClick={handleSave}
            disabled={!overallRating || saving}
            loading={saving}
          >
            {saving ? 'Saving...' : existingId ? 'Update Rating' : 'Save Rating'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default VenueRatingModal;
