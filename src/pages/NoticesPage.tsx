import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { getDaysOfNotice, getWindowLength } from '../utils/noticeDates';
import { Link } from 'react-router-dom';
import { Download, AlertTriangle, Info, FileText, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge, DisclaimerBox, InfoBox, Card } from '../components/UI';
import type { NoticeRecord } from '../types';

type NoticeStatus = 'all' | 'open' | 'upcoming' | 'closed';
type NoticeSort = 'newest' | 'oldest' | 'closing' | 'longest' | 'title';

const STATUS_FILTERS: { id: NoticeStatus; label: string; note: string }[] = [
  { id: 'all', label: 'All notices', note: 'Every notice on record' },
  { id: 'open', label: 'Open now', note: 'The window includes today' },
  { id: 'upcoming', label: 'Upcoming', note: 'The window has not started' },
  { id: 'closed', label: 'Closed', note: 'The window has ended' },
];

const NOTICES_PER_PAGE = 10;

const today = () =>new Date().toISOString().slice(0, 10);

function noticeStatus(notice: NoticeRecord, on = today()): Exclude<NoticeStatus, 'all'> {
  if (notice.window_start && on < notice.window_start) return 'upcoming';
  if (notice.window_end && on > notice.window_end) return 'closed';
  return 'open';
}

export function NoticesPage() {
  const { state } = useApp();
  const [status, setStatus] = useState<NoticeStatus>('all');
  const [query, setQuery] = useState('');
  const [institution, setInstitution] = useState('all');
  const [mode, setMode] = useState('all');
  const [sortBy, setSortBy] = useState<NoticeSort>('newest');

  const titles = useMemo(() => new Map(state.bills.map(b => [b.id, b.title])), [state.bills]);
  const billTitle = (notice: NoticeRecord) => titles.get(notice.bill_ref) || notice.bill_ref;
  const institutions = useMemo(() => [...new Set(state.notices.map(n => n.institution).filter(Boolean))].sort(), [state.notices]);
  const modes = useMemo(() => [...new Set(state.notices.map(n => n.mode).filter(Boolean))].sort(), [state.notices]);

  // Every filter except status, so each status chip can show how many notices it would leave.
  const baseNotices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.notices
      .filter(n => institution === 'all' || n.institution === institution)
      .filter(n => mode === 'all' || n.mode === mode)
      .filter(n => !needle || `${billTitle(n)} ${n.bill_ref} ${n.institution}`.toLowerCase().includes(needle));
  }, [state.notices, titles, query, institution, mode]);

  const counts = useMemo(() => {
    const result: Record<NoticeStatus, number> = { all: baseNotices.length, open: 0, upcoming: 0, closed: 0 };
    baseNotices.forEach(n => { result[noticeStatus(n)] += 1; });
    return result;
  }, [baseNotices]);

  const notices = useMemo(() => {
    const sorters: Record<NoticeSort, (a: NoticeRecord, b: NoticeRecord) => number> = {
      newest: (a, b) => (b.notice_date || '').localeCompare(a.notice_date || ''),
      oldest: (a, b) => (a.notice_date || '').localeCompare(b.notice_date || ''),
      closing: (a, b) => (a.window_end || '9999').localeCompare(b.window_end || '9999'),
      longest: (a, b) => getWindowLength(b) - getWindowLength(a),
      title: (a, b) => billTitle(a).localeCompare(billTitle(b)),
    };
    return baseNotices.filter(n => status === 'all' || noticeStatus(n) === status).sort(sorters[sortBy]);
  }, [baseNotices, status, sortBy, titles]);

  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [status, query, institution, mode, sortBy]);
  const pageCount = Math.max(1, Math.ceil(notices.length / NOTICES_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * NOTICES_PER_PAGE;
  const pageNotices = notices.slice(pageStart, pageStart + NOTICES_PER_PAGE);

  const filtersActive =status !== 'all' || query.trim() !== '' || institution !== 'all' || mode !== 'all';
  const clearFilters = () => { setStatus('all'); setQuery(''); setInstitution('all'); setMode('all'); };

  // Exports contain what the filters currently show.
  const exportCSV = () => {
    const headers = ['Bill', 'Institution', 'Notice Date', 'Window Start', 'Window End', 'Window Length (days)', 'Days of Notice', 'Mode', 'Bill Text Accessible'];
    const rows = notices.map(n => {
      const bill = state.bills.find(b => b.id === n.bill_ref);
      return [
        bill?.title || n.bill_ref,
        n.institution,
        n.notice_date,
        n.window_start,
        n.window_end,
        getWindowLength(n).toString(),
        getDaysOfNotice(n).toString(),
        n.mode,
        n.bill_text_accessible ? 'Yes' : 'No',
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notice-adequacy-data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const data = notices.map(n => {
      const bill = state.bills.find(b => b.id === n.bill_ref);
      return {
        bill_title: bill?.title || n.bill_ref,
        institution: n.institution,
        notice_date: n.notice_date,
        window_start: n.window_start,
        window_end: n.window_end,
        window_length_days: getWindowLength(n),
        days_of_notice: getDaysOfNotice(n),
        mode: n.mode,
        bill_text_accessible: n.bill_text_accessible,
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notice-adequacy-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-2">
        <div>
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Notice Adequacy</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
            Notice <span className="gradient-text">Adequacy Tracker</span>
          </h1>
          <p className="text-lg text-surface-600 leading-relaxed max-w-3xl">
            For each observed call for public participation: notice date, window length, mode, and bill-text accessibility.
          </p>
        </div>
        <div className="inline-flex flex-wrap gap-2">
          <button onClick={exportCSV} className="btn-secondary inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={exportJSON} className="btn-primary inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> Export JSON
          </button>
        </div>
      </div>

      <DisclaimerBox className="!p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm">
              This data is observational and neutral. It records what was published and when. It does not judge adequacy or allege misconduct. Days of notice and window length are computed from published dates.
            </p>
          </div>
        </div>
      </DisclaimerBox>

      <Card className="!p-7 md:!p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-lg shadow-primary-500/25">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-600">Observational Record</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Participation Notices</h2>
            </div>
          </div>

          <section className="bill-filters mb-4" aria-label="Filter notices">
            <div className="bill-filter-chips" role="tablist" aria-label="Notice status">
              {STATUS_FILTERS.map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={status === item.id} className={`bill-chip ${status === item.id ? 'is-active' : ''}`} onClick={() => setStatus(item.id)} title={item.note}>
                  {item.label} <span>{counts[item.id]}</span>
                </button>
              ))}
            </div>
            <div className="bill-filter-row notice-filter-row">
              <div className="bill-search">
                <label htmlFor="notice-search" className="sr-only">Search notices</label>
                <Search className="h-5 w-5" aria-hidden="true" />
                <input id="notice-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search bills" className="input-field" />
              </div>
              <label className="sr-only" htmlFor="notice-institution">Legislature</label>
              <select id="notice-institution" className="input-field" value={institution} onChange={e => setInstitution(e.target.value)}>
                <option value="all">All legislatures</option>
                {institutions.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <label className="sr-only" htmlFor="notice-mode">Mode</label>
              <select id="notice-mode" className="input-field" value={mode} onChange={e => setMode(e.target.value)}>
                <option value="all">All modes</option>
                {modes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <label className="sr-only" htmlFor="notice-sort">Sort</label>
              <select id="notice-sort" className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value as NoticeSort)}>
                <option value="newest">Newest notice first</option>
                <option value="oldest">Oldest notice first</option>
                <option value="closing">Closing soonest</option>
                <option value="longest">Longest window</option>
                <option value="title">Bill title A–Z</option>
              </select>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-sm font-semibold text-surface-600 m-0" role="status">
              {notices.length === 0
                ? `Showing 0 of ${state.notices.length} notices`
                : `Showing ${pageStart + 1}–${pageStart + pageNotices.length} of ${notices.length} ${notices.length === 1 ? 'notice' : 'notices'}${notices.length !== state.notices.length ? ` (filtered from ${state.notices.length})` : ''}`}
            </p>
            {filtersActive && <button type="button" onClick={clearFilters} className="text-sm font-bold text-primary-600 hover:underline">Clear filters</button>}
          </div>

          {notices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-surface-300 p-8 text-center text-sm text-surface-600">
              <p className="font-bold text-surface-800 mb-1">No notices match these filters.</p>
              <p className="m-0">Try another status, legislature or search term.</p>
            </div>
          ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Institution</th>
                  <th>Notice Date</th>
                  <th>Window</th>
                  <th>Length (days)</th>
                  <th>Days of Notice</th>
                  <th>Mode</th>
                  <th>Bill Text Accessible</th>
                </tr>
              </thead>
              <tbody>
                {pageNotices.map((notice, idx) => {
                  const bill = state.bills.find(b => b.id === notice.bill_ref);
                  return (
                    <motion.tr
                      key={notice.id}
                      initial={{ opacity: 0, y: 16 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: Math.min(idx, 10) * 0.03 }}
                    >
                      <td>
                        <Link to={`/bills/${notice.bill_ref}`} className="text-primary-600 hover:underline font-semibold">
                          {bill?.title || notice.bill_ref}
                        </Link>
                      </td>
                      <td className="font-medium">{notice.institution}</td>
                      <td>{notice.notice_date}</td>
                      <td className="text-xs whitespace-nowrap">{notice.window_start} → {notice.window_end}</td>
                      <td className="font-bold text-surface-900">{getWindowLength(notice)}</td>
                      <td className="font-bold text-surface-900">{getDaysOfNotice(notice)}</td>
                      <td className="text-xs">
                        <Badge variant="blue" className="!text-[10px]">{notice.mode}</Badge>
                      </td>
                      <td>{notice.bill_text_accessible ? <Link to={`/bills/${notice.bill_ref}#documents`} className="inline-flex"><Badge variant="green" showIcon className="!text-[10px]">Open bill text</Badge></Link> : <Badge variant="yellow" showIcon className="!text-[10px]">No</Badge>}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {pageCount > 1 && (
            <nav className="committee-notice-pagination !border !border-[#e2ded5] !rounded-2xl mt-4" aria-label="Notice pages">
              <p>Page {currentPage} of {pageCount}</p>
              <div className="committee-notice-page-controls">
                <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">‹</button>
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === pageCount || Math.abs(n - currentPage) <= 1)
                  .map((n, i, list) => (
                    <React.Fragment key={n}>
                      {i > 0 && n - list[i - 1] > 1 && <span className="px-1 text-surface-400">…</span>}
                      <button type="button" className={n === currentPage ? 'is-active' : ''} aria-current={n === currentPage ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>
                    </React.Fragment>
                  ))}
                <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page">›</button>
              </div>
            </nav>
          )}
        </div>
      </Card>

      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-primary-900 mb-1">About Notice Adequacy</h3>
            <p className="text-sm text-primary-800/85 leading-relaxed">
              Kenyan courts test public participation as "reasonable, meaningful, and effective" (Constitution of Kenya 2010, Arts. 10(2)(a), 118(1)(b), 196).
              This tracker records observable facts about notice publication: when notice was given, how long the participation window was,
              what mode was used, and whether the bill text was accessible alongside the notice. It does not make legal determinations.
            </p>
          </div>
        </div>
      </InfoBox>
    </div>
  );
}
