// components/admin/UsersTab.jsx
//
// Admin → Users (v5.44.0). Everyone who signed up in a date range, full
// accounts and guest trials together, with account-type and test-user
// filters and sortable columns. All filtering and sorting is client-side
// over what AdminView already loaded; the rows and the rules for every
// column live in lib/adminUsers.js.

'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronUp, ChevronDown, Search, Trash2, AlertTriangle, FlaskConical } from 'lucide-react';
import Tip from '@/components/ui/Tip';
import { presetRange, matchPreset, filterRows, sortRows } from '@/lib/adminUsers';

const PRESETS = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
];
const ACCOUNT_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'full', label: 'Full accounts' },
  { key: 'trial', label: 'Trial (guest)' },
];
const TEST_FILTERS = [
  { key: 'real', label: 'Real users' },
  { key: 'test', label: 'Test users' },
  { key: 'all', label: 'All' },
];
const SORTS = [
  { key: 'signupDate', label: 'Signup date', desc: 'Newest first', asc: 'Oldest first' },
  { key: 'showCount', label: 'Shows', desc: 'Most first', asc: 'Fewest first' },
  { key: 'invitesSent', label: 'Invites sent', desc: 'Most first', asc: 'Fewest first' },
  { key: 'invitedBy', label: 'Invited by', desc: 'Invited first', asc: 'Not invited first' },
  { key: 'converted', label: 'Converted', desc: 'Converted first', asc: 'Not converted first' },
];

const chip = (active) => `shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
  active ? 'bg-brand-subtle text-brand border-brand/30' : 'bg-hover text-secondary hover:text-primary border-subtle'
}`;
const dateInput = 'w-full bg-base border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand';
const th = 'px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide whitespace-nowrap';

function fmt(date) {
  return date ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
}

function ChipGroup({ label, options, value, onChange }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.key} type="button" onClick={() => onChange(o.key)} className={chip(value === o.key)} aria-pressed={value === o.key}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function UsersTab({
  rows,
  loading,
  authDatesStatus, // 'loading' | 'ok' | 'error'
  onSelectUser,
  onDeleteUser,
  onToggleTestUser,
  togglingIds,
}) {
  const [range, setRange] = useState(() => presetRange('30d'));
  const [accountType, setAccountType] = useState('all');
  const [testFilter, setTestFilter] = useState('real');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'signupDate', dir: 'desc' });

  const activePreset = matchPreset(range.from, range.to);

  const visible = useMemo(
    () => sortRows(filterRows(rows, { ...range, accountType, testFilter, search }), sort),
    [rows, range, accountType, testFilter, search, sort],
  );
  const counts = useMemo(() => ({
    full: visible.filter((r) => r.kind === 'full').length,
    trial: visible.filter((r) => r.kind === 'trial').length,
  }), [visible]);

  const clickSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const SortHeader = ({ k, label, align = 'text-left' }) => {
    const active = sort.key === k;
    const Icon = active && sort.dir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <th className={`${th} ${align}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => clickSort(k)} className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-primary ${active ? 'text-brand' : ''}`}>
          {label}
          <Icon className={`w-3.5 h-3.5 ${active ? '' : 'opacity-30'}`} />
        </button>
      </th>
    );
  };

  const currentSort = SORTS.find((s) => s.key === sort.key);

  return (
    <>
      {/* Filters */}
      <div className="bg-hover border border-subtle rounded-2xl p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 lg:items-end">
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <div>
              <label htmlFor="admin-users-from" className="block text-xs text-muted mb-1">Signed up from</label>
              <input id="admin-users-from" type="date" value={range.from} max={range.to || undefined}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={dateInput} />
            </div>
            <div>
              <label htmlFor="admin-users-to" className="block text-xs text-muted mb-1">To</label>
              <input id="admin-users-to" type="date" value={range.to} min={range.from || undefined}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={dateInput} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => setRange(presetRange(p.key))} className={chip(activePreset === p.key)} aria-pressed={activePreset === p.key}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4">
          <ChipGroup label="Account type" options={ACCOUNT_TYPES} value={accountType} onChange={setAccountType} />
          <ChipGroup label="Test users" options={TEST_FILTERS} value={testFilter} onChange={setTestFilter} />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-base border border-subtle rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand text-primary placeholder-muted"
            />
          </div>
          {/* Column headers sort on wider screens; this is the same control
              for a phone, where the table scrolls sideways. */}
          <div className="flex gap-2 md:hidden">
            <select
              aria-label="Sort by"
              value={sort.key}
              onChange={(e) => setSort({ key: e.target.value, dir: 'desc' })}
              className="flex-1 bg-base border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button type="button" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'desc' ? 'asc' : 'desc' }))}
              className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium bg-hover border border-subtle text-secondary">
              {currentSort?.[sort.dir]}
            </button>
          </div>
        </div>
      </div>

      {/* Count */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-2xl font-bold text-primary">
          {loading ? '…' : visible.length.toLocaleString()}
          <span className="text-sm font-medium text-secondary ml-2">{visible.length === 1 ? 'user' : 'users'}</span>
        </div>
        {!loading && (
          <div className="text-xs text-muted">
            {counts.full.toLocaleString()} full · {counts.trial.toLocaleString()} trial
          </div>
        )}
      </div>

      {authDatesStatus === 'error' && (
        <div className="flex items-start gap-2 bg-amber/10 border border-amber/30 text-amber rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Couldn&rsquo;t load signup dates from Firebase Auth. Using profile dates where they exist; accounts without one show as Unknown and are left out of date ranges.</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-hover border border-subtle rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="bg-hover border-b border-subtle">
                <th className={`${th} text-left`}>User</th>
                <SortHeader k="signupDate" label="Signed up" />
                <th className={`${th} text-left`}>Type</th>
                <SortHeader k="showCount" label="Shows" align="text-center" />
                <SortHeader k="invitesSent" label="Invites sent" align="text-center" />
                <SortHeader k="invitedBy" label="Invited by" />
                <SortHeader k="converted" label="Converted" />
                <th className={`${th} text-center`}>Test</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visible.map((r) => {
                const full = r.kind === 'full';
                const toggling = togglingIds.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={full ? 'hover:bg-hover transition-colors cursor-pointer' : ''}
                    onClick={full ? () => onSelectUser(r.profile) : undefined}
                  >
                    <td className="px-4 py-3 max-w-[240px]">
                      {full ? (
                        <>
                          <div className="font-medium text-primary truncate">{r.name || 'Anonymous'}</div>
                          <div className="text-xs text-muted truncate">{r.email || '—'}</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-secondary">Guest</div>
                          <div className="text-xs text-muted font-mono truncate">{r.session.id.slice(0, 8)}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {fmt(r.signupDate) || <span className="text-muted italic">Unknown</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                        full ? 'bg-brand-subtle text-brand' : 'bg-amber/20 text-amber'
                      }`}>
                        {full ? 'Full' : 'Trial'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-brand-subtle text-brand px-2.5 py-0.5 rounded-full text-sm font-semibold">{r.showCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-secondary">{full ? r.invitesSent : '—'}</td>
                    <td className="px-4 py-3 text-sm max-w-[200px]">
                      {r.invitedBy ? (
                        <>
                          <div className="text-primary truncate">{r.invitedBy.name || 'Unknown'}</div>
                          {r.invitedBy.email && <div className="text-xs text-muted truncate">{r.invitedBy.email}</div>}
                        </>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {r.converted ? (
                        <>
                          <span className="text-brand font-medium">Yes</span>
                          {r.convertedAt && <div className="text-xs text-muted">{fmt(r.convertedAt)}</div>}
                        </>
                      ) : <span className="text-muted">No</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {full ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.isTestUser}
                          aria-label={`${r.isTestUser ? 'Unmark' : 'Mark'} ${r.name || r.email || 'user'} as a test user`}
                          disabled={toggling}
                          onClick={(e) => { e.stopPropagation(); onToggleTestUser(r); }}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all disabled:opacity-50 ${
                            r.isTestUser
                              ? 'bg-amber/20 text-amber border-amber/30'
                              : 'bg-transparent text-muted border-subtle hover:text-primary'
                          }`}
                        >
                          <FlaskConical className="w-3 h-3" />
                          {toggling ? '…' : r.isTestUser ? 'Test' : 'Mark'}
                        </button>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-2 py-3">
                      {full && (
                        <div className="flex items-center gap-1">
                          <Tip text="Delete user">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onDeleteUser(r.profile); }}
                              className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </Tip>
                          <ChevronRight className="w-4 h-4 text-muted" />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && visible.length === 0 && (
          <div className="text-center py-12 text-muted">No users match these filters</div>
        )}
        {loading && (
          <div className="text-center py-12 text-muted">Loading users...</div>
        )}
      </div>
    </>
  );
}
