'use client';

import ScanImportView from '@/components/ScanImportView';
import { PageHeader } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export default function ScanImportPage() {
  const { addShow, updateShowData, shows, importedIds, navigateTo, user, guestMode, loadShows } = useApp();

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Scan / Import"
        subtitle="Add shows by scanning ticket stubs or importing a file."
      />
      <ScanImportView
        onImport={addShow}
        guestMode={guestMode}
        onUpdateShow={updateShowData}
        existingShows={shows}
        importedIds={importedIds}
        onNavigate={(view) => {
          navigateTo(view);
          if (view === 'shows' && user && !guestMode) {
            loadShows(user.uid);
          }
        }}
      />
    </>
  );
}
