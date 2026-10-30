'use client';

import React, { useEffect, useState } from 'react';
import { Camera, Upload } from 'lucide-react';
import TicketScanner from '@/components/TicketScanner';
import ImportView from '@/components/ImportView';
import { Tabs } from '@/components/ui';

function ScanImportView({ onImport, onUpdateShow, existingShows, importedIds, onNavigate, guestMode = false }) {
  const [activeTab, setActiveTab] = useState('scan');

  // /scan-import/?import=1 opens on the file import: the "Switching from
  // Concert Archives" page links here (IMPORT_HREF in lib/comparePages.js).
  // Read after mount rather than with useSearchParams, which would cost
  // the page its static HTML (see components/SearchParamsListener.jsx).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('import')) setActiveTab('import');
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        className="mb-6"
        tabs={[
          { id: 'scan', label: 'Scan Tickets', icon: Camera },
          { id: 'import', label: 'Import File', icon: Upload },
        ]}
      />

      {activeTab === 'scan' && (
        <TicketScanner onImport={onImport} importedIds={importedIds} existingShows={existingShows} />
      )}
      {activeTab === 'import' && (
        <ImportView onImport={onImport} existingShows={existingShows} onNavigate={onNavigate} guestMode={guestMode} />
      )}
    </div>
  );
}

export default ScanImportView;
