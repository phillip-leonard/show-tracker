'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, Trash2, Eye, RotateCcw, Check, Copy, ChevronDown, ChevronUp, Clock, UserCheck, UserPlus } from 'lucide-react';
import { popupManager, POPUP_STORAGE_KEY } from '@/lib/popupManager';
import { POPUPS, getPopupById } from '@/lib/popups';
import PopupOverlay from '@/components/PopupOverlay';
import { useApp } from '@/context/AppContext';

/**
 * AdminPopups — admin tab for managing popup dismissals.
 */
export default function AdminPopups() {
  const { userCreatedAt, isReturningUser } = useApp();
  const [popupStates, setPopupStates] = useState([]);
  const [previewPopupId, setPreviewPopupId] = useState(null);
  const [showRawData, setShowRawData] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const refreshStates = () => {
    const states = POPUPS.map((popup) => ({
      ...popup,
      ...popupManager.getPopupInfo(popup.id),
    }));
    setPopupStates(states);
  };

  useEffect(() => {
    refreshStates();
  }, []);

  const handleResetOne = (popupId) => {
    popupManager.resetPopup(popupId);
    refreshStates();
  };

  const handleResetAll = () => {
    popupManager.clearAll();
    refreshStates();
  };

  const handleCopyRawData = () => {
    const data = popupManager.getAllDismissedPopups();
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCleanup = () => {
    const removed = popupManager.cleanupExpiredDismissals();
    refreshStates();
    alert(`Cleaned up ${removed} expired dismissal(s).`);
  };

  const previewPopup = previewPopupId ? getPopupById(previewPopupId) : null;

  const [testAsNewUser, setTestAsNewUser] = useState(false);

  const dismissedCount = popupStates.filter((p) => p.dismissed).length;
  const activeCount = popupStates.filter((p) => !p.dismissed && p.enabled !== false).length;

  const accountAgeDays = userCreatedAt
    ? Math.floor((Date.now() - userCreatedAt) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="space-y-6">
      {/* Account Age Info */}
      <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-amber" />
          <h3 className="text-sm font-semibold text-primary">Tooltip Eligibility</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-muted">Account Created</span>
            <div className="text-secondary font-medium mt-0.5">
              {userCreatedAt ? new Date(userCreatedAt).toLocaleDateString() : 'Unknown'}
            </div>
          </div>
          <div>
            <span className="text-muted">Account Age</span>
            <div className="text-secondary font-medium mt-0.5">
              {accountAgeDays !== null ? `${accountAgeDays} day${accountAgeDays !== 1 ? 's' : ''}` : 'Unknown'}
            </div>
          </div>
          <div>
            <span className="text-muted">Classification</span>
            <div className="mt-0.5">
              {isReturningUser ? (
                <span className="inline-flex items-center gap-1 text-amber font-medium">
                  <UserCheck className="w-3 h-3" /> Returning User
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-brand font-medium">
                  <UserPlus className="w-3 h-3" /> New User
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-subtle flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={testAsNewUser}
              onChange={() => setTestAsNewUser(!testAsNewUser)}
              className="rounded"
            />
            Test as New User (preview which popups would show for accounts &lt; 7 days)
          </label>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Popups', value: POPUPS.length, color: 'from-amber to-amber' },
          { label: 'Active', value: activeCount, color: 'from-brand to-amber' },
          { label: 'Dismissed', value: dismissedCount, color: 'from-brand to-brand' },
          { label: 'Disabled', value: POPUPS.filter((p) => p.enabled === false).length, color: 'from-amber to-danger' },
        ].map((stat) => (
          <div key={stat.label} className="bg-hover backdrop-blur-xl rounded-2xl p-5 border border-subtle">
            <div className={`text-3xl font-bold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
              {stat.value}
            </div>
            <div className="text-sm font-medium text-secondary mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleResetAll}
          className="flex items-center gap-2 px-4 py-2.5 bg-danger/10 hover:bg-danger/20 text-danger rounded-xl font-medium text-sm transition-colors border border-danger/20"
        >
          <Trash2 className="w-4 h-4" />
          Reset All Dismissals
        </button>
        <button
          onClick={handleCleanup}
          className="flex items-center gap-2 px-4 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium text-sm transition-colors border border-subtle"
        >
          <RotateCcw className="w-4 h-4" />
          Cleanup Expired
        </button>
        <button
          onClick={refreshStates}
          className="flex items-center gap-2 px-4 py-2.5 bg-hover hover:bg-hover text-secondary rounded-xl font-medium text-sm transition-colors border border-subtle"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Popup List */}
      <div className="space-y-3">
        {popupStates.map((popup) => (
          <div
            key={popup.id}
            className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-4 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-primary text-sm">{popup.title}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    popup.enabled === false
                      ? 'bg-muted/20 text-muted'
                      : popup.dismissed
                        ? 'bg-amber-subtle text-amber'
                        : 'bg-brand-subtle text-brand'
                  }`}>
                    {popup.enabled === false ? 'DISABLED' : popup.dismissed ? 'DISMISSED' : 'ACTIVE'}
                  </span>
                  <span className="text-[10px] text-muted bg-hover px-2 py-0.5 rounded-full border border-subtle">
                    {popup.variant}
                  </span>
                  <span className="text-[10px] text-muted bg-hover px-2 py-0.5 rounded-full border border-subtle">
                    v{popup.releaseVersion}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    popup.newUsersOnly !== false
                      ? 'bg-amber-subtle text-amber'
                      : 'bg-brand-subtle text-brand'
                  }`}>
                    {popup.newUsersOnly !== false ? 'NEW ONLY' : 'ALL USERS'}
                  </span>
                </div>
                <p className="text-xs text-muted mt-1 font-mono truncate">{popup.id}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setPreviewPopupId(popup.id)}
                  className="p-2 rounded-lg hover:bg-surface text-secondary hover:text-brand transition-colors"
                  title="Preview popup"
                >
                  <Eye className="w-4 h-4" />
                </button>
                {popup.dismissed && (
                  <button
                    onClick={() => handleResetOne(popup.id)}
                    className="p-2 rounded-lg hover:bg-surface text-secondary hover:text-brand transition-colors"
                    title="Reset dismissal"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setExpandedId(expandedId === popup.id ? null : popup.id)}
                  className="p-2 rounded-lg hover:bg-surface text-secondary transition-colors"
                >
                  {expandedId === popup.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Expanded details */}
            {expandedId === popup.id && (
              <div className="mt-3 pt-3 border-t border-subtle space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Target Audience</span>
                  <span className="text-secondary font-medium">{popup.targetAudience}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">New Users Only</span>
                  <span className="text-secondary font-medium">{popup.newUsersOnly !== false ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Eligible for You</span>
                  <span className={`font-medium ${
                    (!isReturningUser || testAsNewUser || popup.newUsersOnly === false) ? 'text-brand' : 'text-danger'
                  }`}>
                    {(!isReturningUser || testAsNewUser || popup.newUsersOnly === false) ? 'Yes' : 'Suppressed (returning user)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Dismissed</span>
                  <span className="text-secondary font-medium">{popup.dismissed ? 'Yes' : 'No'}</span>
                </div>
                {popup.dismissedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted">Dismissed At</span>
                    <span className="text-secondary font-medium">{new Date(popup.dismissedAt).toLocaleString()}</span>
                  </div>
                )}
                {popup.dismissed && popup.daysUntilReeligible > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Re-eligible In</span>
                    <span className="text-secondary font-medium">{popup.daysUntilReeligible} days</span>
                  </div>
                )}
                {popup.expiresAt && (
                  <div className="flex justify-between">
                    <span className="text-muted">Expires At</span>
                    <span className="text-secondary font-medium">{new Date(popup.expiresAt).toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-2">
                  <span className="text-muted block mb-1">Content</span>
                  <p className="text-secondary bg-surface rounded-lg p-2 border border-subtle">{popup.content}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Raw localStorage Data */}
      <div className="bg-hover backdrop-blur-xl border border-subtle rounded-2xl p-4">
        <button
          onClick={() => setShowRawData(!showRawData)}
          className="flex items-center justify-between w-full text-left"
        >
          <h3 className="text-sm font-semibold text-primary">Raw localStorage Data</h3>
          {showRawData ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
        </button>
        {showRawData && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-muted font-mono">Key: {POPUP_STORAGE_KEY}</span>
              <button
                onClick={handleCopyRawData}
                className="flex items-center gap-1 text-xs text-secondary hover:text-brand transition-colors"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="text-xs text-secondary bg-surface rounded-xl p-3 border border-subtle overflow-x-auto max-h-60 overflow-y-auto">
              {JSON.stringify(popupManager.getAllDismissedPopups(), null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewPopup && (
        <PopupOverlay
          popupId={`preview-${previewPopup.id}`}
          title={previewPopup.title}
          variant={previewPopup.variant}
          onDismiss={() => setPreviewPopupId(null)}
          learnMoreUrl={previewPopup.learnMoreUrl}
          learnMoreLabel={previewPopup.learnMoreLabel}
          dismissLabel="Close Preview"
        >
          <p>{previewPopup.content}</p>
        </PopupOverlay>
      )}
    </div>
  );
}
