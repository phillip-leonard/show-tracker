// components/bucketlist/BucketListView.jsx
//
// /bucket-list page body. Lists shows the user has saved as "want to see" —
// distinct from the song-level Wishlist (lib/wishlist.js) and from
// UpcomingShowsView (which only browses Ticketmaster/SeatGeek results for
// tracked artists, without letting you save one). Entries here come from
// AddToBucketListButton (used on UpcomingShows event cards and show
// search results) or the "Add manually" form below.
//
// "Mark as Attended" removes the entry and hands off to the existing
// manual Add Show flow via setBucketListPrefill + a route change to
// /shows, rather than writing a Firestore show doc directly here — that
// keeps show-creation logic (tagging, dedup, etc.) in one place.

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, Calendar, MapPin, ExternalLink, Trash2, CheckCircle2, Share2, Plus, Search as SearchIcon } from 'lucide-react';
import { Card, EmptyState, Spinner, Badge, Button, Input, Tabs } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { listBucketList, removeFromBucketList, addToBucketList } from '@/lib/bucketList';
import MeetupCard from '@/components/meetups/MeetupCard';
import VenueBucketListSection from '@/components/bucketlist/VenueBucketListSection';
import { today as localToday, toIsoDate, compareShowDates } from '@/lib/showDate';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function googleCalendarUrl(item) {
  const start = (item.date || '').replace(/-/g, '');
  const location = [item.venue, item.city, item.state].filter(Boolean).join(', ');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${item.artist} at ${item.venue || 'TBD'}`,
    dates: `${start}/${start}`,
    location,
    details: item.ticketUrl ? `Tickets: ${item.ticketUrl}` : '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function BucketListCard({ item, onRemove, onMarkAttended, removing }) {
  const location = [item.venue, [item.city, item.state].filter(Boolean).join(', ')].filter(Boolean);
  return (
    <Card padding="md" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-primary truncate">{item.artist}</div>
          <div className="flex items-center gap-1.5 text-sm text-secondary mt-0.5">
            <Calendar size={13} className="flex-shrink-0" />
            {formatDate(item.date)}
          </div>
          {location.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-muted mt-0.5">
              <MapPin size={13} className="flex-shrink-0" />
              <span className="truncate">{location.join(' · ')}</span>
            </div>
          )}
        </div>
        {item.source !== 'manual' && (
          <Badge tone="neutral" size="sm">{item.source === 'ticketmaster' ? 'Ticketmaster' : 'SeatGeek'}</Badge>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-1">
        <Button size="sm" variant="ghost" icon={Calendar} onClick={() => window.open(googleCalendarUrl(item), '_blank', 'noopener,noreferrer')}>
          Add to Calendar
        </Button>
        {item.ticketUrl && (
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.open(item.ticketUrl, '_blank', 'noopener,noreferrer')}>
            Tickets
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={CheckCircle2} onClick={() => onMarkAttended(item)}>
          Mark Attended
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          loading={removing}
          className="text-danger hover:bg-[#fdecec] ml-auto"
          onClick={() => onRemove(item)}
        >
          Remove
        </Button>
      </div>

      <div className="pt-2 border-t border-subtle">
        <MeetupCard show={item} />
      </div>
    </Card>
  );
}

function ManualAddForm({ onAdd, adding }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ artist: '', venue: '', city: '', state: '', date: '' });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.artist || !form.date) return;
    await onAdd({ ...form, source: 'manual' });
    setForm({ artist: '', venue: '', city: '', state: '', date: '' });
    setOpen(false);
  };

  if (!open) {
    return (
      <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpen(true)}>
        Add a show manually
      </Button>
    );
  }

  return (
    <Card variant="inset" padding="md">
      <form onSubmit={submit} className="space-y-3">
        <Input placeholder="Artist/Band" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} required />
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={adding}>Add to Bucket List</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export default function BucketListView() {
  const { user, setToast, setBucketListPrefill } = useApp();
  const router = useRouter();

  const [section, setSection] = useState('shows'); // 'shows' | 'venues'
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('date'); // 'date' | 'artist'
  const [filterText, setFilterText] = useState('');
  const [removingKey, setRemovingKey] = useState(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await listBucketList(user.uid);
      setItems(list);
    } catch (err) {
      console.error('[bucketList] Failed to load:', err);
      setToast?.("Couldn't load your bucket list. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [user, setToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const today = useMemo(() => localToday(), []);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    let list = items.filter((i) => toIsoDate(i.date) >= today);
    if (q) {
      list = list.filter((i) =>
        (i.artist || '').toLowerCase().includes(q) || (i.venue || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) =>
      sortBy === 'artist' ? a.artist.localeCompare(b.artist) : compareShowDates(a.date, b.date)
    );
  }, [items, filterText, sortBy, today]);

  const handleAdd = async (item) => {
    setAdding(true);
    try {
      await addToBucketList(user.uid, item);
      await refresh();
      setToast?.('Added to your bucket list.');
    } catch (err) {
      setToast?.("Couldn't add that show. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (item) => {
    setRemovingKey(item.key);
    try {
      await removeFromBucketList(user.uid, item.key);
      setItems((prev) => prev.filter((i) => i.key !== item.key));
    } catch (err) {
      setToast?.("Couldn't remove that show. Please try again.");
    } finally {
      setRemovingKey(null);
    }
  };

  const handleMarkAttended = async (item) => {
    setBucketListPrefill?.({
      artist: item.artist,
      venue: item.venue || '',
      date: item.date,
      bucketListKey: item.key,
    });
    router.push('/shows');
  };

  const handleShare = async () => {
    const text = `My concert bucket list:\n${filtered.map((i) => `- ${i.artist} — ${formatDate(i.date)}${i.venue ? ` @ ${i.venue}` : ''}`).join('\n')}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My Bucket List', text });
      } else {
        await navigator.clipboard.writeText(text);
        setToast?.('Bucket list copied to clipboard.');
      }
    } catch (_) { /* user cancelled share — not an error */ }
  };

  return (
    <div className="space-y-5">
      <Tabs
        value={section}
        onChange={setSection}
        tabs={[
          { id: 'shows', label: 'Shows' },
          { id: 'venues', label: 'Venues' },
        ]}
      />

      {section === 'venues' ? (
        <VenueBucketListSection />
      ) : loading ? (
        <div className="py-12"><Spinner size="md" label="Loading your bucket list…" /></div>
      ) : (
        <BucketListShowsSection
          items={items}
          filtered={filtered}
          today={today}
          filterText={filterText}
          setFilterText={setFilterText}
          sortBy={sortBy}
          setSortBy={setSortBy}
          adding={adding}
          removingKey={removingKey}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onMarkAttended={handleMarkAttended}
          onShare={handleShare}
        />
      )}
    </div>
  );
}

function BucketListShowsSection({
  items, filtered, today, filterText, setFilterText, sortBy, setSortBy,
  adding, removingKey, onAdd, onRemove, onMarkAttended, onShare,
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <ManualAddForm onAdd={onAdd} adding={adding} />
        {filtered.length > 0 && (
          <Button size="sm" variant="ghost" icon={Share2} onClick={onShare}>
            Share with friends
          </Button>
        )}
      </div>

      {items.filter((i) => i.date >= today).length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Filter by artist or venue"
              icon={SearchIcon}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <Tabs
            value={sortBy}
            onChange={setSortBy}
            tabs={[
              { id: 'date', label: 'Soonest' },
              { id: 'artist', label: 'A–Z' },
            ]}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={Bookmark}
            tone="brand"
            title={items.length === 0 ? 'Nothing on your bucket list yet' : 'No matches'}
            body={items.length === 0
              ? "Save shows you want to catch from Upcoming Shows, or add one manually."
              : 'Try a different search or clear the filter.'}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((item) => (
            <BucketListCard
              key={item.key}
              item={item}
              removing={removingKey === item.key}
              onRemove={onRemove}
              onMarkAttended={onMarkAttended}
            />
          ))}
        </div>
      )}
    </div>
  );
}
