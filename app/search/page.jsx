'use client';

import SearchView from '@/components/SearchView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function SearchPage() {
  const { addShow, importedIds, setShowForm, shows, user, guestMode, addShowsFromTour, bulkAdd } = useApp();

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
        // "Add all" writes through the same throttled, de-duplicating bulk
        // add the tour browser uses. It's for signed-in accounts only:
        // guest shows live in this browser, one at a time.
        onImportMany={user && !guestMode ? addShowsFromTour : undefined}
        bulkAddProgress={bulkAdd}
        existingShows={shows}
        onAddManually={() => setShowForm(true)}
      />
    </>
  );
}
