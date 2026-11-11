'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import SearchView from '@/components/SearchView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?returnTo= from Year in Review's "Missing a show? Add it": a way back
  // after adding one or more. Only a Year in Review address is followed.
  const returnTo = searchParams.get('returnTo') || '';
  const back = /^\/year-in-review\/\?year=\d{4}$/.test(returnTo) ? returnTo : '';
  const { addShow, importedIds, showIdBySetlistfmId, setShowForm, shows, user, guestMode, addShowsFromTour, bulkAdd } = useApp();

  return (
    <>
      {back && (
        <Link
          href={back}
          className="flex items-center gap-2 mb-4 px-4 py-3 min-h-[44px] rounded-xl bg-brand-subtle text-brand font-semibold text-sm"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to your {back.slice(-4)} recap
        </Link>
      )}
      <PageHeader
        eyebrow="Discover"
        title="Search"
        subtitle="Find a show on setlist.fm and add it to your history, or search a venue and year to add them all at once."
      />
      <SearchView
        onImport={addShow}
        importedIds={importedIds}
        showIdBySetlistfmId={showIdBySetlistfmId}
        // "Add all" writes through the same throttled, de-duplicating bulk
        // add the tour browser uses. It's for signed-in accounts only:
        // guest shows live in this browser, one at a time.
        onImportMany={user && !guestMode ? addShowsFromTour : undefined}
        bulkAddProgress={bulkAdd}
        existingShows={shows}
        // The manual form renders on My Shows, so go there: setting the flag
        // alone left it open on a page the user wasn't looking at.
        onAddManually={() => { setShowForm(true); router.push('/shows/'); }}
      />
    </>
  );
}
