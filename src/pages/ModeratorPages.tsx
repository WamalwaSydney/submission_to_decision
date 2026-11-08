import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { useApp } from '../context/AppContext';
import { ModerationAction, ReportEntry, ReviewerDecision, SubmissionStatus } from '../types';
import { api } from '../api/endpoints';
import { v4 as uuidv4 } from 'uuid';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Flag, Shield, Gavel, Users, FileText, Sparkles, Search, ChevronRight, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, DisclaimerBox, InfoBox, Badge, Label, SelectField, BtnPrimary, BtnSecondary, BtnDanger, StatusBadge, Pager as TablePager, usePaged } from '../components/UI';
import { treatmentStage } from '../utils/submissionStage';
import { confidenceClasses, confidenceBarClass, confidenceLabel } from '../utils/confidence';

function ReportTreatmentEditor({ entry }: { entry: ReportEntry }) {
  const { dispatch } = useApp();
  const [treatment, setTreatment] = useState<SubmissionStatus>(entry.treatment);
  const [reason, setReason] = useState(entry.stated_reason || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const changed = treatment !== entry.treatment || reason.trim() !== (entry.stated_reason || '').trim();

  useEffect(() => {
    setTreatment(entry.treatment);
    setReason(entry.stated_reason || '');
    setFeedback('');
  }, [entry.treatment, entry.stated_reason]);

  const save = async () => {
    if (treatment === 'unclassified' || treatment === 'awaiting committee report') return;
    if (treatment === 'rejected with reasons' && !reason.trim()) {
      setFeedback('Add the reason stated in the official report before saving this outcome.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      await api.updateReportEntry(entry.report_ref, entry.id, treatment, reason.trim() || undefined);
      dispatch({ type: 'UPDATE_REPORT_ENTRY', payload: { entryId: entry.id, treatment, stated_reason: reason.trim() || undefined } });
      setFeedback('Committee outcome saved.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to save the committee outcome.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mt-3 rounded-lg border border-surface-200 bg-white/80 p-3">
    <p className="text-xs font-bold text-surface-700 mb-2">Classify outcome from the official report</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Committee report outcome" value={treatment} onChange={event => { setTreatment(event.target.value as SubmissionStatus); setFeedback(''); }} disabled={saving} className="input-field min-h-10 flex-1 min-w-[190px] !py-2 text-sm">
        <option value="unclassified" disabled>Unclassified (choose an outcome)</option>
        <option value="adopted">Adopted</option>
        <option value="amended">Amended</option>
        <option value="rejected with reasons">Rejected with reasons</option>
        <option value="not addressed">Not addressed</option>
      </select>
      <button type="button" onClick={save} disabled={saving || !changed || treatment === 'unclassified'} className="btn-primary min-h-10 !px-4 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save outcome'}</button>
    </div>
    {treatment === 'rejected with reasons' && <textarea aria-label="Reason stated in committee report" value={reason} onChange={event => { setReason(event.target.value); setFeedback(''); }} rows={2} placeholder="Enter the reason stated in the committee report" className="input-field mt-2 text-sm" />}
    <p role="status" className={`mt-2 text-xs font-semibold ${feedback.includes('saved') ? 'text-green-700' : feedback ? 'text-red-700' : 'text-surface-500'}`}>
      {feedback || 'A confirmed match is recorded as adopted unless the official report supports a different treatment.'}
    </p>
  </div>;
}

type QueueTab = 'awaiting' | 'triage' | 'completed';
type TriageReason = 'ready' | 'extract' | 'mismatch' | 'no_report';
const QUEUE_PAGE_SIZE = 20;
const TRIAGE_LABELS: Record<TriageReason, string> = {
  ready: 'Ready to score',
  extract: 'Report needs reading',
  mismatch: 'Report reference conflict',
  no_report: 'No report yet',
};
const isFlagged = (explanation?: string) => /^Warning for moderators/.test(explanation || '');
const houseKey = (value?: string) => value?.toLowerCase().includes('senate') ? 'senate' : value?.toLowerCase().includes('national assembly') || value?.toLowerCase() === 'na' ? 'na' : value?.toLowerCase();

function Pager({ page, count, onPage }: { page: number; count: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / QUEUE_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="committee-notice-pagination">
      <p>Showing {(page - 1) * QUEUE_PAGE_SIZE + 1}–{Math.min(page * QUEUE_PAGE_SIZE, count)} of {count}</p>
      <div className="committee-notice-page-controls">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">‹</button>
        {Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, list) => (
          <React.Fragment key={n}>
            {i > 0 && n - list[i - 1] > 1 && <span className="px-1 text-surface-400">…</span>}
            <button type="button" className={n === page ? 'is-active' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
          </React.Fragment>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">›</button>
      </div>
    </div>
  );
}

export function ReviewerQueuePage() {
  const { state, dispatch } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as QueueTab) || 'awaiting';
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [decisionMatchId, setDecisionMatchId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const [generatingBillId, setGeneratingBillId] = useState<string | null>(null);
  const [extractingReportId, setExtractingReportId] = useState<string | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<Record<string, string>>({});
  const [bulkProgress, setBulkProgress] = useState('');
  // filters
  const [query, setQuery] = useState('');
  const [billFilter, setBillFilter] = useState('all');
  const [band, setBand] = useState<'all' | 'high' | 'moderate' | 'low'>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [triageFilter, setTriageFilter] = useState<'all' | TriageReason>('all');
  const [decisionFilter, setDecisionFilter] = useState<'all' | 'confirmed' | 'rejected'>('all');
  const [sort, setSort] = useState<'priority' | 'oldest' | 'newest'>('priority');
  const [page, setPage] = useState(1);
  // review panel
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canModerate = state.currentUser?.role === 'reviewer' || state.currentUser?.role === 'moderator';
  const receiptById = useMemo(() => new Map(state.receipts.map(r => [r.id, r])), [state.receipts]);
  const billById = useMemo(() => new Map(state.bills.map(b => [b.id, b])), [state.bills]);
  const entryById = useMemo(() => new Map(state.reportEntries.map(e => [e.id, e])), [state.reportEntries]);
  const pendingMatches = state.matches.filter(m => m.reviewer_decision === 'pending');
  const reviewedMatches = state.matches.filter(m => m.reviewer_decision === 'confirmed' || m.reviewer_decision === 'rejected');
  const unmatchedReceipts = state.receipts.filter(receipt => !state.matches.some(match => match.receipt_ref === receipt.id));

  const refreshQueue = async () => {
    const [snapshot, pending, queueReceipts] = await Promise.all([api.bootstrap(), api.pendingMatches(), api.reviewQueueReceipts()]);
    dispatch({ type: 'HYDRATE', payload: {
      bills: snapshot.bills,
      receipts: queueReceipts.receipts,
      reports: snapshot.reports,
      reportEntries: snapshot.report_entries,
      matches: [...snapshot.matches.filter(match => match.reviewer_decision !== 'pending'), ...pending.matches],
    } });
  };

  useEffect(() => {
    let cancelled = false;
    if (!canModerate) { setQueueLoading(false); return () => { cancelled = true; }; }
    setQueueLoading(true);
    api.autoProcessMatches().then(() => refreshQueue()).then(() => { if (!cancelled) setQueueError(''); }).catch(error => {
      if (!cancelled) setQueueError(error instanceof Error ? error.message : 'Unable to refresh the review queue.');
    }).finally(() => { if (!cancelled) setQueueLoading(false); });
    return () => { cancelled = true; };
  }, [dispatch, state.currentUser?.id, state.currentUser?.role]);

  const setTab = (next: QueueTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'awaiting') params.delete('tab'); else params.set('tab', next);
    setSearchParams(params, { replace: true });
    setPage(1); setBillFilter('all'); setQuery(''); setSort('priority');
  };

  // ---- triage reasons ----
  const triageReason = (receipt: typeof state.receipts[number]): { reason: TriageReason; reportToExtract?: string } => {
    const bill = billById.get(receipt.legislative_item_id);
    const reports = state.reports.filter(report => report.bill_ref === receipt.legislative_item_id);
    if (!reports.length) return { reason: 'no_report' };
    const mismatch = reports.some(report =>
      (report.bill_year != null && bill?.bill_year != null && report.bill_year !== bill.bill_year) ||
      (report.bill_number != null && bill?.bill_number != null && report.bill_number !== bill.bill_number) ||
      (report.bill_house && bill?.bill_house && houseKey(report.bill_house) !== houseKey(bill.bill_house)));
    if (mismatch) return { reason: 'mismatch' };
    const hasEntries = state.reportEntries.some(entry => reports.some(report => report.id === entry.report_ref));
    if (!hasEntries) return { reason: 'extract', reportToExtract: reports.find(report => report.source_url)?.id };
    return { reason: 'ready' };
  };

  // ---- decisions ----
  const handleDecision = async (matchId: string, decision: ReviewerDecision, reason?: string) => {
    if (!state.currentUser || decision === 'pending') return false;
    if (decision === 'rejected' && !reason?.trim()) {
      setDecisionError('Give a reason when you reject a proposed match.');
      return false;
    }
    setDecisionMatchId(matchId);
    setDecisionError('');
    try {
      const result = await api.decideMatch(matchId, decision === 'confirmed' ? 'confirm' : 'reject', reason?.trim());
      if (result?.match) dispatch({ type: 'UPSERT_MATCH', payload: result.match });
      else dispatch({ type: 'UPDATE_MATCH_DECISION', payload: { matchId, decision, reviewerId: state.currentUser.id } });
      dispatch({ type: 'ADD_AUDIT_LOG', payload: { id: uuidv4(), entity_type: 'match', entity_id: matchId, action: decision === 'confirmed' ? 'confirmed' : 'rejected', details: `Match ${decision} by ${state.currentUser.name}`, timestamp: new Date().toISOString() } });
      return true;
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Unable to update the match. Please refresh and try again.');
      return false;
    } finally {
      setDecisionMatchId(null);
    }
  };

  const scoreBill = async (billId: string, receiptId?: string) => {
    setGeneratingBillId(billId);
    if (receiptId) setGenerationFeedback(previous => ({ ...previous, [receiptId]: 'Scoring against the committee report…' }));
    try {
      const generated = await api.generateMatches(billId);
      if (receiptId) {
        const found = generated.matches.filter(match => match.receipt_ref === receiptId).length;
        setGenerationFeedback(previous => ({ ...previous, [receiptId]: found ? `${found} proposal${found === 1 ? '' : 's'} created — see Awaiting action.` : 'No defensible match was found in the report for this submission.' }));
      }
      return generated.matches.length;
    } finally {
      setGeneratingBillId(null);
    }
  };

  const scoreAllReady = async (billIds: string[]) => {
    let created = 0;
    for (const [index, billId] of billIds.entries()) {
      setBulkProgress(`Scoring bill ${index + 1} of ${billIds.length}…`);
      try { created += await scoreBill(billId); } catch { /* keep going; per-bill errors are rare and retriable */ }
    }
    await refreshQueue();
    setBulkProgress(`Done: ${created} new proposal${created === 1 ? '' : 's'} added to Awaiting action.`);
  };

  const retryExtraction = async (receiptId: string, reportId: string) => {
    setExtractingReportId(reportId);
    setGenerationFeedback(previous => ({ ...previous, [receiptId]: 'Reading the committee report PDF…' }));
    try {
      const result = await api.retryReportExtraction(reportId);
      setGenerationFeedback(previous => ({ ...previous, [receiptId]: result.entries_extracted ? `Read ${result.entries_extracted} report entr${result.entries_extracted === 1 ? 'y' : 'ies'}; ${result.matches.length} proposal${result.matches.length === 1 ? '' : 's'} created.` : 'The PDF still gave no readable entries. Check that the linked report is the right one.' }));
      await refreshQueue();
    } catch (error) {
      setGenerationFeedback(previous => ({ ...previous, [receiptId]: error instanceof Error ? error.message : 'Unable to read the report PDF.' }));
    } finally {
      setExtractingReportId(null);
    }
  };

  // ---- filtered lists ----
  const needle = query.trim().toLowerCase();
  const matchesText = (receipt?: typeof state.receipts[number], extra = '') => {
    if (!needle) return true;
    const bill = receipt ? billById.get(receipt.legislative_item_id) : undefined;
    return `${receipt?.public_id || ''} ${receipt?.submission_text || ''} ${bill?.title || ''} ${extra}`.toLowerCase().includes(needle);
  };
  const scoreBand = (score: number) => (score >= 0.75 ? 'high' : score >= 0.5 ? 'moderate' : 'low');

  const awaitingRows = pendingMatches
    .filter(match => { const receipt = receiptById.get(match.receipt_ref); return matchesText(receipt, entryById.get(match.report_entry_ref)?.extracted_summary); })
    .filter(match => billFilter === 'all' || receiptById.get(match.receipt_ref)?.legislative_item_id === billFilter)
    .filter(match => band === 'all' || scoreBand(match.confidence_score) === band)
    .filter(match => !flaggedOnly || isFlagged(match.explanation))
    .sort((a, b) => sort === 'oldest' ? (a.timestamp || '').localeCompare(b.timestamp || '')
      : sort === 'newest' ? (b.timestamp || '').localeCompare(a.timestamp || '')
      // Priority: possible manipulation first, then the strongest proposals.
      : Number(isFlagged(b.explanation)) - Number(isFlagged(a.explanation)) || b.confidence_score - a.confidence_score);

  const triageAll = unmatchedReceipts.map(receipt => ({ receipt, ...triageReason(receipt) }));
  const triageCounts = triageAll.reduce((counts, row) => ({ ...counts, [row.reason]: (counts[row.reason] || 0) + 1 }), {} as Record<TriageReason, number>);
  const triageRows = triageAll
    .filter(row => triageFilter === 'all' || row.reason === triageFilter)
    .filter(row => billFilter === 'all' || row.receipt.legislative_item_id === billFilter)
    .filter(row => matchesText(row.receipt))
    .sort((a, b) => sort === 'newest' ? (b.receipt.timestamp || '').localeCompare(a.receipt.timestamp || '') : (a.receipt.timestamp || '').localeCompare(b.receipt.timestamp || ''));
  const readyBillIds = Array.from(new Set(triageAll.filter(row => row.reason === 'ready').map(row => row.receipt.legislative_item_id)));

  const completedRows = reviewedMatches
    .filter(match => decisionFilter === 'all' || match.reviewer_decision === decisionFilter)
    .filter(match => billFilter === 'all' || receiptById.get(match.receipt_ref)?.legislative_item_id === billFilter)
    .filter(match => matchesText(receiptById.get(match.receipt_ref), match.reviewer_reason || ''))
    .sort((a, b) => sort === 'oldest' ? (a.timestamp || '').localeCompare(b.timestamp || '') : (b.timestamp || '').localeCompare(a.timestamp || ''));

  const rowsForTab = tab === 'awaiting' ? awaitingRows.length : tab === 'triage' ? triageRows.length : completedRows.length;
  const pageCount = Math.max(1, Math.ceil(rowsForTab / QUEUE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const slice = <T,>(rows: T[]) => rows.slice((currentPage - 1) * QUEUE_PAGE_SIZE, currentPage * QUEUE_PAGE_SIZE);

  const billsInTab = Array.from(new Set(
    (tab === 'awaiting' ? pendingMatches.map(m => receiptById.get(m.receipt_ref)?.legislative_item_id)
      : tab === 'triage' ? unmatchedReceipts.map(r => r.legislative_item_id)
      : reviewedMatches.map(m => receiptById.get(m.receipt_ref)?.legislative_item_id)).filter(Boolean) as string[],
  )).map(id => billById.get(id)).filter(Boolean).sort((a, b) => a!.title.localeCompare(b!.title)) as typeof state.bills;

  // ---- review panel ----
  const openMatch = state.matches.find(m => m.id === openMatchId) || null;
  const openIndex = openMatch ? awaitingRows.findIndex(m => m.id === openMatch.id) : -1;
  const closePanel = () => { setOpenMatchId(null); setRejecting(false); setRejectReason(''); setDecisionError(''); };
  const decideAndAdvance = async (decision: ReviewerDecision) => {
    if (!openMatch) return;
    const nextId = openMatch.reviewer_decision === 'pending' ? (awaitingRows[openIndex + 1] || awaitingRows[openIndex - 1])?.id : undefined;
    const ok = await handleDecision(openMatch.id, decision, decision === 'rejected' ? rejectReason : undefined);
    if (!ok) return;
    setRejecting(false); setRejectReason('');
    if (nextId && nextId !== openMatch.id) setOpenMatchId(nextId); else closePanel();
  };

  const tabs: { id: QueueTab; label: string; count: number; note: string }[] = [
    { id: 'awaiting', label: 'Awaiting action', count: pendingMatches.length, note: 'AI proposals to confirm or reject' },
    { id: 'triage', label: 'Triage', count: unmatchedReceipts.length, note: 'Submissions with no proposal yet' },
    { id: 'completed', label: 'Completed', count: reviewedMatches.length, note: 'Decisions already made' },
  ];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-3">Moderation</p>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-3">Match review</h1>
        <p className="text-lg text-surface-600 leading-relaxed max-w-3xl m-0">Check that each proposed committee response really answers the citizen's view. Nothing is shown to the public as an outcome until you confirm it.</p>
      </header>

      {!canModerate && <p className="notice-box is-closed">Sign in with a moderator account to review matches.</p>}
      {queueLoading && <p role="status" className="text-sm font-semibold text-surface-500 m-0">Refreshing the review queue…</p>}
      {queueError && <p role="alert" className="notice-box is-error">{queueError}</p>}

      <div className="queue-tabs" role="tablist" aria-label="Review queue">
        {tabs.map(item => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`queue-tab ${tab === item.id ? 'is-active' : ''}`} onClick={() => setTab(item.id)}>
            <strong>{item.count}</strong><span>{item.label}</span><small>{item.note}</small>
          </button>
        ))}
      </div>

      <section className="bill-filters" aria-label="Filter the queue">
        <div className="bill-filter-row">
          <div className="bill-search">
            <label htmlFor="queue-search" className="sr-only">Search</label>
            <Search className="h-5 w-5" aria-hidden="true" />
            <input id="queue-search" type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search receipt ID, submission text or bill" className="input-field" />
          </div>
          <label className="sr-only" htmlFor="queue-bill">Bill</label>
          <select id="queue-bill" className="input-field" value={billFilter} onChange={e => { setBillFilter(e.target.value); setPage(1); }}>
            <option value="all">All bills ({billsInTab.length})</option>
            {billsInTab.map(bill => <option key={bill.id} value={bill.id}>{bill.title}</option>)}
          </select>
          {tab === 'awaiting' && (
            <select aria-label="AI score" className="input-field" value={band} onChange={e => { setBand(e.target.value as typeof band); setPage(1); }}>
              <option value="all">Any AI score</option><option value="high">High (75%+)</option><option value="moderate">Moderate (50–74%)</option><option value="low">Low (under 50%)</option>
            </select>
          )}
          {tab === 'triage' && (
            <select aria-label="Why there is no proposal" className="input-field" value={triageFilter} onChange={e => { setTriageFilter(e.target.value as typeof triageFilter); setPage(1); }}>
              <option value="all">Any reason</option>
              {(Object.keys(TRIAGE_LABELS) as TriageReason[]).map(key => <option key={key} value={key}>{TRIAGE_LABELS[key]} ({triageCounts[key] || 0})</option>)}
            </select>
          )}
          {tab === 'completed' && (
            <select aria-label="Decision" className="input-field" value={decisionFilter} onChange={e => { setDecisionFilter(e.target.value as typeof decisionFilter); setPage(1); }}>
              <option value="all">Confirmed and rejected</option><option value="confirmed">Confirmed only</option><option value="rejected">Rejected only</option>
            </select>
          )}
          <select aria-label="Sort" className="input-field" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
            {tab === 'awaiting' && <option value="priority">Flagged first, then highest score</option>}
            {tab !== 'awaiting' && <option value="priority">{tab === 'triage' ? 'Oldest first' : 'Newest first'}</option>}
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        {tab === 'awaiting' && (
          <label className="flex items-center gap-2 text-sm font-semibold text-surface-700">
            <input type="checkbox" checked={flaggedOnly} onChange={e => { setFlaggedOnly(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[#a52d29]" />
            Only show submissions flagged for possible AI manipulation ({pendingMatches.filter(m => isFlagged(m.explanation)).length})
          </label>
        )}
        {tab === 'triage' && canModerate && readyBillIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="action-button is-secondary" disabled={generatingBillId !== null} onClick={() => scoreAllReady(readyBillIds)}>
              <Sparkles aria-hidden="true" /> Score all {triageCounts.ready || 0} ready submissions ({readyBillIds.length} bill{readyBillIds.length === 1 ? '' : 's'})
            </button>
            {bulkProgress && <span role="status" className="text-sm font-semibold text-surface-700">{bulkProgress}</span>}
          </div>
        )}
      </section>

      <p className="text-sm font-semibold text-surface-600 m-0" role="status">{rowsForTab} {rowsForTab === 1 ? 'item' : 'items'}{needle || billFilter !== 'all' ? ' match these filters' : ''}</p>

      {tab === 'awaiting' && (
        <div className="submissions-table-wrap">
          <table className="submissions-table">
            <thead><tr><th>Receipt</th><th>Bill</th><th>Proposed response</th><th>AI score</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {slice(awaitingRows).map(match => {
                const receipt = receiptById.get(match.receipt_ref);
                const bill = receipt ? billById.get(receipt.legislative_item_id) : undefined;
                const entry = entryById.get(match.report_entry_ref);
                const open = () => setOpenMatchId(match.id);
                return (
                  <tr key={match.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
                    <td><span className="receipt-id">{receipt?.public_id || '—'}</span>{isFlagged(match.explanation) && <span className="flag-chip">Flagged</span>}</td>
                    <td><div className="excerpt">{bill?.title || '—'}</div></td>
                    <td><div className="excerpt">{entry?.clause_ref ? `${entry.clause_ref}: ` : ''}{entry?.extracted_summary || '—'}</div></td>
                    <td><span className={`rounded-full border px-2.5 py-1 text-xs font-black whitespace-nowrap ${confidenceClasses(match.confidence_score)}`}>{Math.round(match.confidence_score * 100)}%</span></td>
                    <td className="chevron">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!awaitingRows.length && <p className="empty-note">{pendingMatches.length ? 'Nothing matches these filters.' : 'All caught up — no proposals are waiting for a decision.'}</p>}
          <Pager page={currentPage} count={awaitingRows.length} onPage={setPage} />
        </div>
      )}

      {tab === 'triage' && (
        <div className="submissions-table-wrap">
          <table className="submissions-table">
            <thead><tr><th>Receipt</th><th>Bill</th><th>Submission</th><th>Why there is no proposal</th><th>Action</th></tr></thead>
            <tbody>
              {slice(triageRows).map(({ receipt, reason, reportToExtract }) => {
                const bill = billById.get(receipt.legislative_item_id);
                return (
                  <tr key={receipt.id} className="!cursor-default">
                    <td><span className="receipt-id">{receipt.public_id}</span></td>
                    <td><div className="excerpt">{bill?.title || '—'}</div></td>
                    <td><div className="excerpt" title={receipt.submission_text}>{receipt.submission_text}</div></td>
                    <td><span className={`triage-chip is-${reason}`}>{TRIAGE_LABELS[reason]}</span>{generationFeedback[receipt.id] && <small className="block mt-1 text-xs text-surface-600 whitespace-normal">{generationFeedback[receipt.id]}</small>}</td>
                    <td>
                      {canModerate && reason === 'ready' && bill && <button type="button" className="action-button is-secondary !min-h-9 !py-1.5 !px-3 !text-sm" disabled={generatingBillId !== null} onClick={() => scoreBill(bill.id, receipt.id).then(refreshQueue).catch(error => setGenerationFeedback(p => ({ ...p, [receipt.id]: error instanceof Error ? error.message : 'Scoring failed.' })))}>{generatingBillId === bill.id ? 'Scoring…' : 'Score'}</button>}
                      {canModerate && reason === 'extract' && reportToExtract && <button type="button" className="action-button is-secondary !min-h-9 !py-1.5 !px-3 !text-sm" disabled={extractingReportId !== null} onClick={() => retryExtraction(receipt.id, reportToExtract)}>{extractingReportId === reportToExtract ? 'Reading…' : 'Read report'}</button>}
                      {(reason === 'no_report' || reason === 'mismatch') && <span className="text-xs text-surface-500">{reason === 'no_report' ? 'Waits for the report' : 'Check the report link'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!triageRows.length && <p className="empty-note">{unmatchedReceipts.length ? 'Nothing matches these filters.' : 'Every submission has a proposal or a decision.'}</p>}
          <Pager page={currentPage} count={triageRows.length} onPage={setPage} />
        </div>
      )}

      {tab === 'completed' && (
        <div className="submissions-table-wrap">
          <table className="submissions-table">
            <thead><tr><th>Receipt</th><th>Bill</th><th>Decision</th><th>Submission outcome</th><th>Decided</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {slice(completedRows).map(match => {
                const receipt = receiptById.get(match.receipt_ref);
                const bill = receipt ? billById.get(receipt.legislative_item_id) : undefined;
                const entry = entryById.get(match.report_entry_ref);
                const confirmed = match.reviewer_decision === 'confirmed';
                const open = () => setOpenMatchId(match.id);
                return (
                  <tr key={match.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
                    <td><span className="receipt-id">{receipt?.public_id || '—'}</span></td>
                    <td><div className="excerpt">{bill?.title || '—'}</div></td>
                    <td><Badge variant={confirmed ? 'green' : 'red'} showIcon>{confirmed ? 'Confirmed' : 'Rejected'}</Badge></td>
                    <td><StatusBadge status={confirmed ? treatmentStage(entry?.treatment) : 'not_addressed'} /></td>
                    <td className="whitespace-nowrap">{match.timestamp ? new Date(match.timestamp).toLocaleDateString('en-KE') : '—'}</td>
                    <td className="chevron">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!completedRows.length && <p className="empty-note">{reviewedMatches.length ? 'Nothing matches these filters.' : 'No decisions yet.'}</p>}
          <Pager page={currentPage} count={completedRows.length} onPage={setPage} />
        </div>
      )}

      <Dialog open={Boolean(openMatch)} onClose={closePanel} fullWidth maxWidth="lg" scroll="paper" aria-labelledby="review-title">
        {openMatch && (() => {
          const receipt = receiptById.get(openMatch.receipt_ref);
          const bill = receipt ? billById.get(receipt.legislative_item_id) : undefined;
          const entry = entryById.get(openMatch.report_entry_ref);
          const pending = openMatch.reviewer_decision === 'pending';
          return (
            <>
              <DialogTitle id="review-title" sx={{ pr: 7 }}>
                <span className="block text-xs font-black uppercase tracking-[0.16em] text-primary-600">{pending ? `Proposal ${openIndex + 1} of ${awaitingRows.length}` : openMatch.reviewer_decision === 'confirmed' ? 'Confirmed match' : 'Rejected match'}</span>
                <span className="block text-lg font-black text-surface-900 mt-1">{bill?.title || 'Bill'}</span>
                <IconButton onClick={closePanel} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><XCircle size={20} /></IconButton>
              </DialogTitle>
              <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
                {isFlagged(openMatch.explanation) && <p role="alert" className="notice-box is-error !m-0"><strong>Possible attempt to manipulate the AI.</strong> This submission contains text that reads like instructions to the matcher. Decide from the two texts yourself.</p>}
                <div className="review-compare">
                  <section>
                    <h3>Citizen's view <span className="font-mono">{receipt?.public_id}</span></h3>
                    {receipt?.clause_ref && <p className="text-xs font-bold text-surface-600 m-0">Clause: {receipt.clause_ref}</p>}
                    <p className="submission-detail-text">{receipt?.submission_text || 'Submission text unavailable.'}</p>
                  </section>
                  <section>
                    <h3>Committee report entry</h3>
                    {entry?.clause_ref && <p className="text-xs font-bold text-surface-600 m-0">Clause: {entry.clause_ref}</p>}
                    <p className="submission-detail-text">{entry?.extracted_summary || 'Report entry unavailable.'}</p>
                    <p className="text-xs text-surface-600 m-0">Report records: <strong>{entry?.treatment && entry.treatment !== 'unclassified' ? entry.treatment : 'no explicit treatment (confirming records it as adopted)'}</strong>{entry?.stated_reason ? ` — ${entry.stated_reason}` : ''}</p>
                  </section>
                </div>
                <div className="notice-box is-info !m-0"><strong>Why the AI proposed this ({Math.round(openMatch.confidence_score * 100)}% score):</strong> {openMatch.explanation.replace(/^Warning for moderators:[^.]*\.[^.]*\.\s*/, '')}</div>
                {!pending && openMatch.reviewer_reason && <p className="notice-box is-closed !m-0"><strong>Reason given:</strong> {openMatch.reviewer_reason}</p>}
                {canModerate && entry && (pending || openMatch.reviewer_decision === 'confirmed') && <ReportTreatmentEditor entry={entry} />}
                {pending && rejecting && (
                  <div>
                    <label htmlFor="reject-reason" className="field-label">Why does this report entry not answer the view?</label>
                    <textarea id="reject-reason" autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} className="input-field !min-h-24" placeholder="For example: the entry is about licensing fees, the view is about consultation." />
                    <p className="field-hint">The citizen's submission will show as "Not addressed in the report", with this reason.</p>
                  </div>
                )}
                {decisionError && <p role="alert" className="notice-box is-error !m-0">{decisionError}</p>}
              </DialogContent>
              <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {pending && canModerate ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {!rejecting ? (
                        <>
                          <button type="button" className="action-button is-go" disabled={decisionMatchId !== null} onClick={() => decideAndAdvance('confirmed')}><CheckCircle2 aria-hidden="true" /> {decisionMatchId ? 'Saving…' : 'Confirm — it answers the view'}</button>
                          <button type="button" className="action-button is-secondary" disabled={decisionMatchId !== null} onClick={() => setRejecting(true)}><XCircle aria-hidden="true" /> Reject</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="action-button is-primary" disabled={decisionMatchId !== null || !rejectReason.trim()} onClick={() => decideAndAdvance('rejected')}>{decisionMatchId ? 'Saving…' : 'Reject with this reason'}</button>
                          <button type="button" className="action-button is-secondary" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</button>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="action-button is-secondary" disabled={openIndex <= 0} onClick={() => { setRejecting(false); setOpenMatchId(awaitingRows[openIndex - 1].id); }}>‹ Previous</button>
                      <button type="button" className="action-button is-secondary" disabled={openIndex < 0 || openIndex >= awaitingRows.length - 1} onClick={() => { setRejecting(false); setOpenMatchId(awaitingRows[openIndex + 1].id); }}>Skip ›</button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="action-button is-secondary" onClick={closePanel}>Close</button>
                )}
              </DialogActions>
            </>
          );
        })()}
      </Dialog>
    </div>
  );
}

const CASES_PER_PAGE = 10;
type CaseFilter = 'pending' | 'upheld' | 'dismissed' | 'all';
const CASE_FILTERS: { id: CaseFilter; label: string }[] = [
  { id: 'pending', label: 'Awaiting decision' },
  { id: 'upheld', label: 'Upheld' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
];
const CONTENT_TYPE_LABELS: Record<string, string> = { receipt: 'Submission', report_entry: 'Report entry', profile: 'Profile' };
const contentTypeLabel = (type: string) => CONTENT_TYPE_LABELS[type] || type;
const decisionVariant = (decision: string) => (decision === 'pending' ? 'yellow' : decision === 'upheld' ? 'red' : 'green');
const decisionLabel = (decision: string) => (decision === 'pending' ? 'Awaiting decision' : decision === 'upheld' ? 'Upheld' : 'Dismissed');

export function ReportedContentPage() {
  const { state, dispatch } = useApp();
  const [loadError, setLoadError] = useState('');
  const [savingCase, setSavingCase] = useState<string | null>(null);
  const [filter, setFilter] = useState<CaseFilter>('pending');
  const [query, setQuery] = useState('');
  const [contentType, setContentType] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!state.currentUser || !['reviewer', 'moderator'].includes(state.currentUser.role)) return;
    api.moderationCases().then(result => {
      dispatch({ type: 'HYDRATE', payload: { moderationActions: result.cases } });
      setLoadError('');
    }).catch(error => setLoadError(error instanceof Error ? error.message : 'Unable to load moderation reports.'));
  }, [state.currentUser?.id, state.currentUser?.role, dispatch]);

  const handleDecision = async (id: string, decision: 'upheld' | 'dismissed') => {
    if (!state.currentUser) return;
    setSavingCase(id);
    setLoadError('');
    try {
      const result = await api.decideModerationCase(id, decision);
      dispatch({ type: 'UPDATE_MODERATION', payload: { id, decision: result.action.decision, reviewerId: result.action.reviewer_id } });
      setSelectedId(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to save moderation decision.');
    } finally {
      setSavingCase(null);
    }
  };

  const cases = state.moderationActions;
  const receiptsById = useMemo(() => new Map(state.receipts.map(r => [r.id, r])), [state.receipts]);
  const billTitles = useMemo(() => new Map(state.bills.map(b => [b.id, b.title])), [state.bills]);
  // The API names what was reported; fall back to loaded receipts for older responses.
  const describe = (action: ModerationAction) => {
    const receipt = action.content_type === 'receipt' ? receiptsById.get(action.content_id) : undefined;
    const billId = action.bill_id || receipt?.legislative_item_id;
    return {
      label: action.content_label || receipt?.public_id || `${action.content_id.slice(0, 8)}…`,
      text: action.content_text ?? receipt?.submission_text ?? '',
      billId,
      billTitle: billId ? billTitles.get(billId) : undefined,
    };
  };
  const contentTypes = useMemo(() => [...new Set(cases.map(c => c.content_type))].sort(), [cases]);

  // Every filter except the decision chips, so each chip shows what it would leave.
  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases
      .filter(c => contentType === 'all' || c.content_type === contentType)
      .filter(c => {
        if (!needle) return true;
        const d = describe(c);
        return `${c.reason} ${d.label} ${d.text} ${d.billTitle || ''}`.toLowerCase().includes(needle);
      });
  }, [cases, contentType, query, receiptsById, billTitles]);

  const counts: Record<CaseFilter, number> = {
    pending: base.filter(c => c.decision === 'pending').length,
    upheld: base.filter(c => c.decision === 'upheld').length,
    dismissed: base.filter(c => c.decision === 'dismissed').length,
    all: base.length,
  };

  const visible = useMemo(() => base
    .filter(c => filter === 'all' || c.decision === filter)
    .sort((a, b) => (sortBy === 'newest' ? -1 : 1) * (a.timestamp || '').localeCompare(b.timestamp || '')),
  [base, filter, sortBy]);

  const paged = usePaged(visible, CASES_PER_PAGE, `${filter}|${query}|${contentType}|${sortBy}`);
  const selected = cases.find(c => c.id === selectedId) || null;
  const selectedInfo = selected ? describe(selected) : null;
  const filtersActive = filter !== 'pending' || query.trim() !== '' || contentType !== 'all';
  const clearFilters = () => { setFilter('pending'); setQuery(''); setContentType('all'); };

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Safety</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Reported <span className="gradient-text">Content</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Review citizen-submitted reports about public submissions. These cases are separate from committee reports used for OCR and outcome matching; no submission is automatically deleted.
      </p>

      {loadError && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{loadError}</p>}
      <Card className="!p-6 md:!p-7">
        <div className="inline-flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white shadow-md shadow-red-500/30">
            <Flag className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-red-600 mb-1">Case Queue</div>
            <h2 className="text-2xl font-black text-surface-900 tracking-tight">Moderation Cases ({cases.length})</h2>
          </div>
        </div>

        {cases.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-4">
              <Shield className="h-10 w-10 text-surface-400" />
            </div>
            <p className="text-lg font-semibold text-surface-700 mb-1">All clear</p>
            <p className="text-surface-500">No reported content cases.</p>
          </div>
        ) : (
          <>
            <section className="bill-filters mb-4" aria-label="Filter moderation cases">
              <div className="bill-filter-chips" role="tablist" aria-label="Decision">
                {CASE_FILTERS.map(item => (
                  <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`bill-chip ${filter === item.id ? 'is-active' : ''}`} onClick={() => setFilter(item.id)}>
                    {item.label} <span>{counts[item.id]}</span>
                  </button>
                ))}
              </div>
              <div className="bill-filter-row case-filter-row">
                <div className="bill-search">
                  <label htmlFor="case-search" className="sr-only">Search cases</label>
                  <Search className="h-5 w-5" aria-hidden="true" />
                  <input id="case-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search reason, receipt or text" className="input-field" />
                </div>
                <label className="sr-only" htmlFor="case-type">Content type</label>
                <select id="case-type" className="input-field" value={contentType} onChange={e => setContentType(e.target.value)}>
                  <option value="all">All content</option>
                  {contentTypes.map(t => <option key={t} value={t}>{contentTypeLabel(t)}</option>)}
                </select>
                <label className="sr-only" htmlFor="case-sort">Sort</label>
                <select id="case-sort" className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-sm font-semibold text-surface-600 m-0" role="status">
                {visible.length ? `${paged.summary} ${visible.length === 1 ? 'case' : 'cases'}` : 'No cases'}
                {visible.length !== cases.length ? ` (filtered from ${cases.length})` : ''}
              </p>
              {filtersActive && <button type="button" onClick={clearFilters} className="text-sm font-bold text-primary-600 hover:underline">Show all pending</button>}
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-surface-300 p-8 text-center text-sm text-surface-600">
                <p className="font-bold text-surface-800 mb-1">{filter === 'pending' && !query && contentType === 'all' ? 'No cases are awaiting a decision.' : 'No cases match these filters.'}</p>
                <p className="m-0">Use the tabs above to see decided cases.</p>
              </div>
            ) : (
              <div className="submissions-table-wrap">
                <table className="submissions-table">
                  <thead>
                    <tr><th>Reported content</th><th>Reason</th><th>Reported</th><th>Decision</th><th>Appeal</th><th><span className="sr-only">Open</span></th></tr>
                  </thead>
                  <tbody>
                    {paged.rows.map(action => {
                      const info = describe(action);
                      const open = () => setSelectedId(action.id);
                      return (
                        <tr key={action.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} aria-label={`Open case about ${info.label}`}>
                          <td>
                            <span className="receipt-id">{info.label}</span>
                            <div className="text-xs text-surface-500">{contentTypeLabel(action.content_type)}</div>
                          </td>
                          <td><div className="excerpt !max-w-[340px]">{action.reason}</div></td>
                          <td className="whitespace-nowrap">{new Date(action.timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' })}</td>
                          <td><Badge variant={decisionVariant(action.decision) as any}>{decisionLabel(action.decision)}</Badge></td>
                          <td className="whitespace-nowrap text-xs font-semibold capitalize">{action.appeal_status === 'none' ? '—' : action.appeal_status}</td>
                          <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <TablePager page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} label="Case pages" className="mt-4 !border !border-[#e2ded5] !rounded-2xl" />
          </>
        )}
      </Card>

      <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} fullWidth maxWidth="md" scroll="paper" aria-labelledby="case-dialog-title">
        {selected && selectedInfo && (
          <>
            <DialogTitle id="case-dialog-title" sx={{ pr: 7, pb: 1 }}>
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#a52d29]">Moderation case · {contentTypeLabel(selected.content_type)}</span>
              <span className="block font-mono text-2xl font-black text-[#11521f] mt-1">{selectedInfo.label}</span>
              <IconButton onClick={() => setSelectedId(null)} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><X size={20} /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'grid', gap: 2.5 }}>
              <dl className="submission-detail-meta">
                <div><dt>Reported</dt><dd>{new Date(selected.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
                <div><dt>Decision</dt><dd>{decisionLabel(selected.decision)}</dd></div>
                <div><dt>Appeal</dt><dd className="capitalize">{selected.appeal_status === 'none' ? 'None' : selected.appeal_status}</dd></div>
                {selectedInfo.billId && (
                  <div style={{ gridColumn: '1 / -1' }}><dt>Bill</dt><dd>{selectedInfo.billTitle ? <Link to={`/bills/${selectedInfo.billId}`} className="underline">{selectedInfo.billTitle}</Link> : 'Bill no longer listed'}</dd></div>
                )}
              </dl>
              <div>
                <h3 className="text-sm font-black text-[#182020] mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" /> Why it was reported</h3>
                <p className="submission-detail-text whitespace-pre-wrap">{selected.reason}</p>
              </div>
              <div>
                <h3 className="text-sm font-black text-[#182020] mb-2">Reported content</h3>
                {selectedInfo.text
                  ? <p className="submission-detail-text whitespace-pre-wrap">{selectedInfo.text}</p>
                  : <p className="notice-box is-closed !m-0">The reported content's text is not available here.</p>}
              </div>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
              {selected.content_type === 'receipt' && selectedInfo.label && !selectedInfo.label.endsWith('…') && (
                <Link to={`/receipt-lookup?id=${selectedInfo.label}`} className="action-button is-secondary mr-auto">View receipt</Link>
              )}
              {selected.decision === 'pending' && state.currentUser ? (
                <>
                  <button type="button" onClick={() => void handleDecision(selected.id, 'dismissed')} disabled={savingCase === selected.id} className="action-button is-secondary">Dismiss report</button>
                  <button type="button" onClick={() => void handleDecision(selected.id, 'upheld')} disabled={savingCase === selected.id} className="btn-danger inline-flex items-center gap-2 text-sm disabled:opacity-50">
                    {savingCase === selected.id ? 'Saving…' : 'Uphold report'}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setSelectedId(null)} className="action-button is-primary">Close</button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}
