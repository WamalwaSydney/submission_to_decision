import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { LegislativeItem } from '../types';
import { StagePill, participationFor } from '../components/Participation';

type View = 'needs' | 'suggested' | 'confirmed';
const PAGE_SIZE = 20;

export const ASSIGNMENT_SOURCE_LABEL: Record<string, string> = {
  'official record': 'Named by Parliament or the assembly',
  'subject matter': 'Assigned by subject — awaiting confirmation',
  administrator: 'Confirmed by an administrator',
};

/**
 * Administrators make sure every bill sits with the right committee, so that
 * committee staff can manage it. Bills no official source assigns are given a
 * committee by subject; those wait here for confirmation.
 */
export function CommitteeAssignments() {
  const { state, dispatch } = useApp();
  const [view, setView] = useState<View>('needs');
  const [legislature, setLegislature] = useState('all');
  const [query, setQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.bills(), api.committees()]).then(([bills, committees]) => {
      if (!cancelled) dispatch({ type: 'HYDRATE', payload: { bills: bills.bills, committees: committees.committees } });
    }).catch(() => { /* keep cached data */ });
    return () => { cancelled = true; };
  }, [dispatch]);

  const committeeName = (id?: string) => state.committees.find(c => c.id === id)?.name || '';
  const groupOf = (bill: LegislativeItem): View => !bill.committee_id ? 'needs' : bill.committee_assignment_source === 'subject matter' ? 'suggested' : 'confirmed';
  const counts = useMemo(() => state.bills.reduce((acc, bill) => ({ ...acc, [groupOf(bill)]: acc[groupOf(bill)] + 1 }), { needs: 0, suggested: 0, confirmed: 0 } as Record<View, number>), [state.bills]);
  const legislatures = Array.from(new Set(state.bills.map(b => b.institution))).sort();
  const needle = query.trim().toLowerCase();
  const rows = state.bills
    .filter(bill => groupOf(bill) === view)
    .filter(bill => legislature === 'all' || bill.institution === legislature)
    .filter(bill => !openOnly || participationFor(bill).accepting)
    .filter(bill => !needle || `${bill.title} ${bill.identifier} ${committeeName(bill.committee_id)}`.toLowerCase().includes(needle))
    // Bills open for views first: those are the ones committee staff need now.
    .sort((a, b) => Number(participationFor(b).accepting) - Number(participationFor(a).accepting) || a.title.localeCompare(b.title));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const updateBill = (bill: any) => dispatch({ type: 'HYDRATE', payload: { bills: state.bills.map(b => b.id === bill.id ? { ...b, ...bill } : b) } });

  const save = async (bill: LegislativeItem) => {
    const committeeId = choices[bill.id] ?? bill.committee_id ?? '';
    setBusy(true); setMessage('');
    try {
      const result = await api.setBillCommittee(bill.id, committeeId || null);
      updateBill(result.bill);
      setMessage(committeeId ? `${bill.title}: assigned to ${committeeName(committeeId)}.` : `${bill.title}: committee cleared.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the committee.');
    } finally { setBusy(false); }
  };

  const confirmSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true); setMessage('');
    try {
      const result = await api.confirmBillCommittees(ids);
      dispatch({ type: 'HYDRATE', payload: { bills: state.bills.map(b => selected.has(b.id) ? { ...b, committee_assignment_source: 'administrator' } : b) } });
      setSelected(new Set());
      setMessage(`Confirmed ${result.confirmed} committee assignment${result.confirmed === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not confirm these assignments.');
    } finally { setBusy(false); }
  };

  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allVisibleSelected = visible.length > 0 && visible.every(bill => selected.has(bill.id));

  const views: { id: View; label: string; note: string }[] = [
    { id: 'needs', label: 'Needs a committee', note: 'No committee yet; committee staff cannot manage these' },
    { id: 'suggested', label: 'Assigned by subject', note: 'Suggested from the bill title; please confirm' },
    { id: 'confirmed', label: 'Confirmed', note: 'Named officially or confirmed by an administrator' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-surface-900 m-0">Committee assignments</h2>
        <p className="text-sm text-surface-600 mt-2 mb-0 max-w-3xl">Parliament's trackers rarely say which committee a bill was committed to. Where an official source names it, that is used. Otherwise the platform suggests the committee whose subject area matches the bill; confirm or correct those here. The nightly sync never changes an assignment you have made.</p>
      </div>

      <div className="queue-tabs" role="tablist" aria-label="Assignment status">
        {views.map(item => (
          <button key={item.id} type="button" role="tab" aria-selected={view === item.id} className={`queue-tab ${view === item.id ? 'is-active' : ''}`} onClick={() => { setView(item.id); setPage(1); setSelected(new Set()); }}>
            <strong>{counts[item.id]}</strong><span>{item.label}</span><small>{item.note}</small>
          </button>
        ))}
      </div>

      <section className="bill-filters">
        <div className="bill-filter-row">
          <div className="bill-search">
            <label htmlFor="assign-search" className="sr-only">Search</label>
            <Search className="h-5 w-5" aria-hidden="true" />
            <input id="assign-search" type="search" className="input-field" placeholder="Search by bill title, number or committee" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
          </div>
          <select aria-label="Legislature" className="input-field" value={legislature} onChange={e => { setLegislature(e.target.value); setPage(1); }}>
            <option value="all">All legislatures</option>
            {legislatures.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm font-semibold text-surface-700">
            <input type="checkbox" className="h-4 w-4 accent-[#a52d29]" checked={openOnly} onChange={e => { setOpenOnly(e.target.checked); setPage(1); }} />
            Open for views only
          </label>
          <span />
        </div>
        {view === 'suggested' && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="action-button is-go" disabled={busy || !selected.size} onClick={confirmSelected}>Confirm {selected.size || ''} selected</button>
            <span className="text-sm text-surface-600">Tick the suggestions that are right, then confirm them together.</span>
          </div>
        )}
      </section>

      {message && <p role="status" className="notice-box is-info !m-0">{message}</p>}

      <div className="submissions-table-wrap">
        <table className="submissions-table">
          <thead>
            <tr>
              {view === 'suggested' && <th><input type="checkbox" aria-label="Select all on this page" checked={allVisibleSelected} onChange={() => setSelected(previous => { const next = new Set(previous); visible.forEach(bill => allVisibleSelected ? next.delete(bill.id) : next.add(bill.id)); return next; })} /></th>}
              <th>Bill</th><th>Stage</th><th>Committee</th><th><span className="sr-only">Save</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(bill => {
              const options = state.committees.filter(c => c.institution === bill.institution && !/simulated/i.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
              const value = choices[bill.id] ?? bill.committee_id ?? '';
              const changed = value !== (bill.committee_id ?? '');
              return (
                <tr key={bill.id} className="!cursor-default">
                  {view === 'suggested' && <td><input type="checkbox" aria-label={`Select ${bill.title}`} checked={selected.has(bill.id)} onChange={() => toggle(bill.id)} /></td>}
                  <td><strong className="block text-surface-900 whitespace-normal max-w-[380px]">{bill.title}</strong><small className="text-surface-500">{bill.institution} · <span className="font-mono">{bill.identifier}</span></small></td>
                  <td><StagePill stage={bill.stage} /></td>
                  <td>
                    <select aria-label={`Committee for ${bill.title}`} className="input-field !min-h-10 !py-1.5 min-w-[240px]" value={value} onChange={e => setChoices(previous => ({ ...previous, [bill.id]: e.target.value }))}>
                      <option value="">No committee</option>
                      {options.map(committee => <option key={committee.id} value={committee.id}>{committee.name}</option>)}
                    </select>
                    {!options.length && <small className="block mt-1 text-xs text-primary-700">No committees exist for this legislature yet — add one in the Committees tab.</small>}
                  </td>
                  <td><button type="button" className="action-button is-secondary !min-h-9 !py-1.5 !px-3 !text-sm" disabled={busy || (!changed && view !== 'suggested')} onClick={() => save(bill)}>{changed ? 'Save' : view === 'suggested' ? 'Confirm' : 'Saved'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="empty-note">Nothing here{needle || legislature !== 'all' || openOnly ? ' for these filters' : ''}.</p>}
        {pageCount > 1 && (
          <div className="committee-notice-pagination">
            <p>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length}</p>
            <div className="committee-notice-page-controls">
              <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">‹</button>
              <span className="px-2 text-sm font-bold">{currentPage} / {pageCount}</span>
              <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page">›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
