'use client';

import { useRouter } from 'next/navigation';
import SearchView from '@/components/SearchView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function SearchPage() {
  const router = useRouter();
  const { addShow, importedIds, showIdBySetlistfmId, setShowForm, shows, user, guestMode, addShowsFromTour, bulkAdd } = useApp();

  return (
    <>
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
