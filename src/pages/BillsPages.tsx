import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getDaysOfNotice, getWindowLength } from '../utils/noticeDates';
import { ParticipationReceipt, SubmissionStatus } from '../types';
import {
  FileText, Clock, Building2, ArrowRight, ArrowLeft, ChevronRight, X, Search,
  FileCheck, Calendar, FileSearch, Gavel, Users, Download, SlidersHorizontal, RotateCcw, Flag, BookOpenText
} from 'lucide-react';
import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { CallForViewsBadge, Deadline, EditSubmissionAction, EditBlock, StagePill, SubmissionProgress, callForViews, participationFor, formatDate, formatBytes, stageTone } from '../components/Participation';
import { motion } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import {
  Card, Badge, InfoBox, DisclaimerBox, SectionHeader,
  Label, InputField, StatCard, StatusBadge
} from '../components/UI';
import { confidenceClasses, confidenceLabel } from '../utils/confidence';
import { api } from '../api/endpoints';
import { getApiUrl } from '../api/client';
import { reportDocumentHref } from '../utils/reportLinks';
import { FinalActPanel, HousePanel, ReportAnalysisPanel, ReportSubmissionsTable, useParticipationSummary } from '../components/ParticipationSummary';
import type { ReportDecision } from '../api/endpoints';
import type { SubmissionStage } from '../utils/submissionStage';

function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return StatusBadge({ status });
}

function downloadReadableBillDocument(
  bill: { title: string; identifier: string; institution: string; stage: string; status_history: { date: string; stage: string; note: string }[] },
  documentName: string,
) {
  const content = [
    documentName,
    `Bill: ${bill.title}`,
    `Identifier: ${bill.identifier}`,
    `Institution: ${bill.institution}`,
    `Current stage: ${bill.stage}`,
    '',
    'Legislative timeline',
    ...(bill.status_history || []).map(item => `${item.date} — ${item.stage}: ${item.note}`),
    '',
    'This readable document was generated from the bill record. It is provided for reference and does not replace an official source document.',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${bill.identifier.replace(/[^a-z0-9]+/gi, '-')}-${documentName.replace(/[^a-z0-9]+/gi, '-')}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const BILLS_PER_PAGE = 20;
type BillFilter = 'open' | 'calls' | 'submissions' | 'parliament' | 'law' | 'ended' | 'all';
const BILL_FILTERS: { id: BillFilter; label: string; note: string }[] = [
  { id: 'all', label: 'All bills', note: 'Every bill on the platform' },
  { id: 'open', label: 'Open for views', note: 'Committees are taking public views now' },
  { id: 'calls', label: 'Has a call for views', note: 'The committee has published a call for memoranda (open, upcoming or closed)' },
  { id: 'parliament', label: 'In progress', note: 'Being debated, or not yet open for views' },
  { id: 'submissions', label: 'Has submissions', note: 'Submissions sent on this platform or recorded in the committee report' },
  { id: 'law', label: 'Now law', note: 'Assented to by the President' },
  { id: 'ended', label: 'Ended', note: 'Withdrawn, lapsed or defeated' },
];

function billGroup(bill: { stage: string; participation?: { accepting: boolean } }): BillFilter {
  if (participationFor(bill as any).accepting) return 'open';
  const tone = stageTone(bill.stage);
  if (tone === 'law') return 'law';
  if (tone === 'ended') return 'ended';
  return 'parliament';
}

export function BillsListPage() {
  const { state, dispatch } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get('show') as BillFilter) || 'all';
  const isOfficer = state.currentUser?.role === 'committee_officer';
  const committee = isOfficer ? 'all' : searchParams.get('committee') || 'all';
  const legislature = isOfficer ? 'all' : searchParams.get('legislature') || 'all';
  const [query, setQuery] = useState('');
  const [sortChoice, setSortBy] = useState<'deadline' | 'recent' | 'title' | 'submissions' | null>(null);
  // Bills with submissions read best busiest first.
  const sortBy = sortChoice || (filter === 'submissions' ? 'submissions' : 'deadline');
  const [page, setPage] = useState(1);

  const setParam = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === fallback) next.delete(key); else next.set(key, value);
    next.delete('open');
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.committees(), api.bills()]).then(([committeeResponse, billResponse]) => {
      if (cancelled) return;
      const payload: { committees?: typeof committeeResponse.committees; bills?: typeof billResponse.bills } = {};
      if (committeeResponse.committees?.length) payload.committees = committeeResponse.committees;
      if (billResponse.bills?.length) payload.bills = billResponse.bills;
      dispatch({ type: 'HYDRATE', payload });
    }).catch(() => { /* The cached/bootstrap data remains usable. */ });
    return () => { cancelled = true; };
  }, [dispatch]);

  const committeeName = (bill: typeof state.bills[number]) => state.committees.find(c => c.id === bill.committee_id)?.name || 'No committee assigned yet';
  // Submissions per bill: sent on this platform, plus those the committee report records.
  const [traced, setTraced] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api.participationOutcomes().then(result => {
      if (cancelled) return;
      setTraced(new Map(result.bills.map(row => [row.id, row.platform.submissions + (row.report?.submissions_recorded || 0)])));
    }).catch(() => { /* Platform counts below still work. */ });
    return () => { cancelled = true; };
  }, [state.receipts.length]);
  const submissionCount = useMemo(() => {
    const platform = new Map<string, number>();
    state.receipts.forEach(r => platform.set(r.legislative_item_id, (platform.get(r.legislative_item_id) || 0) + 1));
    const counts = new Map(traced);
    platform.forEach((n, billId) => counts.set(billId, Math.max(n, counts.get(billId) || 0)));
    return counts;
  }, [state.receipts, traced]);
  const calls = useMemo(() => {
    const byBill = new Map<string, typeof state.notices>();
    state.notices.forEach(n => byBill.set(n.bill_ref, [...(byBill.get(n.bill_ref) || []), n]));
    return new Map(Array.from(byBill, ([billId, notices]) => [billId, callForViews(notices)]));
  }, [state.notices]);
  const counts = useMemo(() => {
    const result: Record<BillFilter, number> = { open: 0, calls: 0, submissions: 0, parliament: 0, law: 0, ended: 0, all: state.bills.length };
    state.bills.forEach(bill => {
      result[billGroup(bill)] += 1;
      if (calls.get(bill.id)) result.calls += 1;
      if (submissionCount.get(bill.id)) result.submissions += 1;
    });
    return result;
  }, [state.bills, calls, submissionCount]);

  const needle = query.trim().toLowerCase();
  const bills = state.bills
    .filter(bill => filter === 'all'
      || (filter === 'calls' ? Boolean(calls.get(bill.id))
        : filter === 'submissions' ? Boolean(submissionCount.get(bill.id))
          : billGroup(bill) === filter))
    .filter(bill => legislature === 'all' || bill.institution === legislature)
    .filter(bill => committee === 'all' || (committee === '__unassigned__' ? !bill.committee_id : bill.committee_id === committee))
    .filter(bill => !needle || `${bill.title} ${bill.identifier} ${bill.institution} ${committeeName(bill)}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'submissions') return (submissionCount.get(b.id) || 0) - (submissionCount.get(a.id) || 0);
      if (sortBy === 'deadline') {
        const byDeadline = (participationFor(a).closes_on || '9999').localeCompare(participationFor(b).closes_on || '9999');
        if (byDeadline) return byDeadline;
      }
      return (b.source_updated_at || '').localeCompare(a.source_updated_at || '') || a.title.localeCompare(b.title);
    });
  const pageCount = Math.max(1, Math.ceil(bills.length / BILLS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visible = bills.slice((currentPage - 1) * BILLS_PER_PAGE, currentPage * BILLS_PER_PAGE);
  const committees = [...state.committees].sort((a, b) => a.name.localeCompare(b.name));
  const legislatures = Array.from(new Set(state.bills.map(bill => bill.institution))).sort((a, b) => (a === 'National Assembly' ? -1 : b === 'National Assembly' ? 1 : a.localeCompare(b)));

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-3">{isOfficer ? (state.committees[0]?.name || 'Your committee') : 'National Assembly and county assemblies'}</p>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-3">{isOfficer ? "Your committee's bills" : 'Find a bill'}</h1>
        <p className="text-lg text-surface-600 max-w-3xl leading-relaxed">Bills from the National Assembly, Nairobi City County Assembly and Trans Nzoia County Assembly. A bill is open for views only while its committee's call for memoranda is running. Open bills are listed first, soonest deadline at the top.</p>
      </header>

      <section className="bill-filters" aria-label="Filter bills">
        <div className="bill-filter-chips" role="tablist" aria-label="Bill status">
          {BILL_FILTERS.map(item => (
            <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`bill-chip ${filter === item.id ? 'is-active' : ''}`} onClick={() => setParam('show', item.id, 'all')} title={item.note}>
              {item.label} <span>{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="bill-filter-row">
          <div className="bill-search">
            <label htmlFor="bill-search" className="sr-only">Search bills</label>
            <Search className="h-5 w-5" aria-hidden="true" />
            <input id="bill-search" type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search by title, bill number or committee" className="input-field" />
          </div>
          {!isOfficer && <>
          <label className="sr-only" htmlFor="bill-legislature">Legislature</label>
          <select id="bill-legislature" className="input-field" value={legislature} onChange={e => setParam('legislature', e.target.value, 'all')}>
            <option value="all">All legislatures</option>
            {legislatures.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <label className="sr-only" htmlFor="bill-committee">Committee</label>
          <select id="bill-committee" className="input-field" value={committee} onChange={e => setParam('committee', e.target.value, 'all')}>
            <option value="all">All committees</option>
            {committees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__unassigned__">No committee assigned</option>
          </select>
          </>}
          <label className="sr-only" htmlFor="bill-sort">Sort</label>
          <select id="bill-sort" className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="deadline">Closing soonest</option>
            <option value="recent">Recently updated</option>
            <option value="title">Title A–Z</option>
            <option value="submissions">Most submissions</option>
          </select>
        </div>
      </section>

      <p className="text-sm font-semibold text-surface-600" role="status">
        {state.isLoading ? 'Loading bills…' : `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'}${needle ? ` matching “${query.trim()}”` : ''}`}
      </p>

      <div className="list-card">
        {visible.map(bill => {
          const participation = participationFor(bill);
          const count = submissionCount.get(bill.id) || 0;
          return (
            <Link key={bill.id} to={`/bills/${bill.id}`} className="list-row">
              <div className="main">
                <strong>{bill.title}</strong>
                <small>{committeeName(bill)} · <span className="font-mono">{bill.identifier}</span>{count ? ` · ${count} submission${count === 1 ? '' : 's'}` : ''}</small>
              </div>
              <div className="side">
                <StagePill stage={bill.stage} />
                <CallForViewsBadge call={calls.get(bill.id) || null} />
                {participation.accepting && <Deadline participation={participation} />}
                <ArrowRight className="h-4 w-4 text-surface-400" aria-hidden="true" />
              </div>
            </Link>
          );
        })}
        {!state.isLoading && !bills.length && (
          <div className="empty-note">
            <p className="font-bold text-surface-800 mb-1">No bills match these filters.</p>
            <p className="m-0">{filter === 'open' ? 'No committee is taking views right now. Try "In Parliament" or "All bills".' : 'Try another status, committee or search term.'}</p>
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div className="committee-notice-pagination !border !border-[#e2ded5] !rounded-2xl">
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
        </div>
      )}
    </div>
  );
}

// National Assembly procedure, in order. Public participation happens with the
// committee between First and Second Reading.
const BILL_STEPS = [
  { label: 'Published', match: /published|legislative proposal|awaiting first/i },
  { label: 'First Reading', match: /^first reading|introduced/i },
  { label: 'Public views', match: /public participation/i, isParticipation: true },
  { label: 'Second Reading', match: /second reading/i },
  { label: 'Committee of the Whole House', match: /committee stage|committee of the whole/i },
  { label: 'Third Reading', match: /third reading|passed by|referred to senate|mediation|senate amendments/i },
  { label: 'Assent', match: /assented/i },
];

function BillStageTracker({ stage, accepting }: { stage: string; accepting: boolean }) {
  let current = BILL_STEPS.findIndex(step => step.match.test(stage));
  if (accepting) current = 2; // the committee is taking views now
  const ended = stageTone(stage) === 'ended';
  return (
    <div className="bill-track-wrap">
      <ol className="bill-track" aria-label="Where this bill is in Parliament">
        {BILL_STEPS.map((step, index) => {
          const state = current < 0 ? '' : index < current || (index === current && step.label === 'Assent') ? 'is-done' : index === current ? 'is-current' : '';
          return (
            <li key={step.label} className={`${state} ${step.isParticipation ? 'is-participation' : ''}`} aria-current={index === current ? 'step' : undefined}>
              <span>{step.label}</span>
              {step.isParticipation && <small>{accepting ? 'Open now — give your view' : 'Where the public gives views'}</small>}
            </li>
          );
        })}
      </ol>
      {ended && <p className="m-0 mt-2 text-sm font-semibold text-surface-600">This bill did not complete its journey: {stage.toLowerCase()}.</p>}
    </div>
  );
}

const SUBMISSIONS_PER_PAGE = 10;

export function SubmissionDetailDialog({
  receipt, open, onClose, isMine, canOpenDocument, myEdit, showBill = false,
}: {
  receipt: ParticipationReceipt | null;
  open: boolean;
  onClose: () => void;
  isMine: boolean;
  canOpenDocument: boolean;
  myEdit?: { editable: boolean; edit_block?: EditBlock } | null;
  /** Name the bill too, for lists that mix bills (My Receipts). */
  showBill?: boolean;
}) {
  const { state, getSubmissionStatus, getSubmissionReviewDecision, getSubmissionLodgingStatus } = useApp();
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportMessage, setReportMessage] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [documentError, setDocumentError] = useState('');

  useEffect(() => {
    setReporting(false); setReportReason(''); setReportMessage(''); setDocumentError('');
  }, [receipt?.id]);

  if (!receipt) return null;
  const status = getSubmissionStatus(receipt.id);
  const reviewDecision = getSubmissionReviewDecision(receipt.id);
  const match = state.matches.find(m => m.receipt_ref === receipt.id && m.reviewer_decision === 'confirmed')
    || state.matches.find(m => m.receipt_ref === receipt.id && m.reviewer_decision === 'rejected');
  const entry = match ? state.reportEntries.find(e => e.id === match.report_entry_ref) : null;
  const reason = entry?.stated_reason || match?.reviewer_reason;

  const sendReport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reportReason.trim().length < 5) return;
    setReportSending(true);
    setReportMessage('');
    try {
      await api.reportContent('receipt', receipt.id, reportReason.trim());
      setReportMessage('Report sent to the moderation team.');
      setReporting(false);
      setReportReason('');
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : 'Could not submit this report.');
    } finally {
      setReportSending(false);
    }
  };

  const openDocument = async () => {
    setDocumentError('');
    try {
      const blob = await api.downloadReceiptDocument(receipt.public_id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Could not open the document.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-labelledby="submission-dialog-title">
      <DialogTitle id="submission-dialog-title" sx={{ pr: 7, pb: 1 }}>
        <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#a52d29]">Submission{isMine ? ' · yours' : ''}</span>
        <span className="block font-mono text-2xl font-black text-[#11521f] mt-1">{receipt.public_id}</span>
        <IconButton onClick={onClose} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><X size={20} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2.5 }}>
        <SubmissionProgress stage={status} />
        <dl className="submission-detail-meta">
          {showBill && (() => {
            const bill = state.bills.find(b => b.id === receipt.legislative_item_id);
            return <div style={{ gridColumn: "1 / -1" }}><dt>Bill</dt><dd>{bill ? <Link to={`/bills/${bill.id}`} className="underline">{bill.title}</Link> : 'Bill no longer listed'}</dd></div>;
          })()}
          <div><dt>Submitted</dt><dd>{formatDate(receipt.timestamp)}</dd></div>
          <div><dt>Clause</dt><dd>{receipt.clause_ref || 'Whole bill'}</dd></div>
          <div><dt>Lodging</dt><dd className="capitalize">{getSubmissionLodgingStatus(receipt.id)}</dd></div>
          {(receipt.revision || 1) > 1 && <div><dt>Version</dt><dd>Edited · version {receipt.revision}</dd></div>}
          {receipt.author_name_public && <div><dt>Submitted by</dt><dd>{receipt.author_name_public}</dd></div>}
        </dl>
        <div>
          <h3 className="text-sm font-black text-[#182020] mb-2">{receipt.has_document && !receipt.submission_text ? 'Submitted as a document' : 'Submission'}</h3>
          {receipt.submission_text
            ? <p className="submission-detail-text">{receipt.submission_text}</p>
            : <p className="notice-box is-closed">This submission was uploaded as a document with no readable text, for example a scanned memorandum.</p>}
        </div>
        {receipt.has_document && (
          <div className="file-chip">
            <span><FileText className="inline h-4 w-4 mr-2 -mt-0.5" aria-hidden="true" />{receipt.attachment_name || 'Memorandum'}{receipt.attachment_size_bytes ? ` · ${formatBytes(receipt.attachment_size_bytes)}` : ''}</span>
            {canOpenDocument
              ? <button type="button" onClick={openDocument}>Open document</button>
              : <small className="text-xs text-[#526060]">Original file visible to the author and parliamentary staff</small>}
          </div>
        )}
        {documentError && <p role="alert" className="notice-box is-error">{documentError}</p>}
        {match && (
          <p className="text-sm font-semibold text-[#3b4747]">
            Matched to the committee report by {match.match_method} ({Math.round(match.confidence_score * 100)}% confidence).
            {status === 'adopted' && ' It is recorded as adopted unless the report explicitly records an amendment, a rejection with reasons, or that it was not addressed.'}
          </p>
        )}
        {reason && <div className="notice-box is-closed"><strong>Committee reason:</strong> {reason}</div>}
        {state.currentUser?.role === 'citizen' && !isMine && (
          <div className="border-t border-[#eeeae2] pt-4">
            {!reporting ? (
              <button type="button" onClick={() => { setReporting(true); setReportMessage(''); }} className="action-button is-secondary">
                <Flag className="h-4 w-4" aria-hidden="true" /> Report this submission
              </button>
            ) : (
              <form onSubmit={sendReport} className="grid gap-3">
                <label className="field-label !mb-0" htmlFor={`report-${receipt.id}`}>Why are you reporting this submission?</label>
                <textarea id={`report-${receipt.id}`} required minLength={5} maxLength={2000} value={reportReason} onChange={e => setReportReason(e.target.value)} className="input-field !min-h-28" placeholder="Explain the concern for the moderation team." />
                <div className="flex flex-wrap gap-2">
                  <button disabled={reportSending || reportReason.trim().length < 5} type="submit" className="action-button is-primary">{reportSending ? 'Sending…' : 'Send report'}</button>
                  <button type="button" className="action-button is-secondary" onClick={() => setReporting(false)}>Cancel</button>
                </div>
              </form>
            )}
            {reportMessage && <p role="status" className="mt-3 text-sm font-semibold text-[#3b4747]">{reportMessage}</p>}
          </div>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        {isMine && myEdit && <EditSubmissionAction billId={receipt.legislative_item_id} editable={myEdit.editable} editBlock={myEdit.edit_block} className="mr-auto" />}
        <Link to={`/receipt-lookup?id=${receipt.public_id}`} className="action-button is-secondary">View full receipt</Link>
        <button type="button" onClick={onClose} className={`action-button ${isMine && myEdit?.editable ? 'is-secondary' : 'is-primary'}`}>Close</button>
      </DialogActions>
    </Dialog>
  );
}

function SubmissionsTable({ receipts, myReceiptId, myEdit }: { receipts: ParticipationReceipt[]; myReceiptId?: string; myEdit?: { editable: boolean; edit_block?: EditBlock } | null }) {
  const { state, getSubmissionStatus, getSubmissionReviewDecision } = useApp();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = [...receipts].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const pageCount = Math.max(1, Math.ceil(sorted.length / SUBMISSIONS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const rows = sorted.slice((currentPage - 1) * SUBMISSIONS_PER_PAGE, currentPage * SUBMISSIONS_PER_PAGE);
  const selected = sorted.find(r => r.id === selectedId) || null;
  const role = state.currentUser?.role;
  const isStaff = role === 'reviewer' || role === 'moderator' || role === 'administrator' || role === 'committee_officer';
  const first = (currentPage - 1) * SUBMISSIONS_PER_PAGE + 1;

  return (
    <>
      <div className="submissions-table-wrap">
        <table className="submissions-table">
          <thead>
            <tr><th>Receipt</th><th>Submitted</th><th>Clause</th><th>Submission</th><th>Outcome</th><th><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {rows.map(receipt => {
              const decision = getSubmissionReviewDecision(receipt.id);
              const open = () => setSelectedId(receipt.id);
              return (
                <tr key={receipt.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} aria-label={`Open submission ${receipt.public_id}`}>
                  <td><span className="receipt-id">{receipt.public_id}</span>{receipt.public_id === myReceiptId && <span className="yours">Yours</span>}</td>
                  <td className="whitespace-nowrap">{formatDate(receipt.timestamp)}</td>
                  <td className="whitespace-nowrap">{receipt.clause_ref || '—'}</td>
                  <td><div className="excerpt">{receipt.has_document && <FileText className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5 text-[#526060]" aria-label="Has document" />}{receipt.submission_text || 'Submitted as a document'}</div></td>
                  <td><div className="flex flex-wrap gap-1.5"><SubmissionStatusBadge status={getSubmissionStatus(receipt.id) as SubmissionStatus} /></div></td>
                  <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length > SUBMISSIONS_PER_PAGE && (
          <div className="committee-notice-pagination">
            <p>Showing {first}–{Math.min(first + SUBMISSIONS_PER_PAGE - 1, sorted.length)} of {sorted.length} submissions</p>
            <div className="committee-notice-page-controls">
              <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">‹</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter(n => n === 1 || n === pageCount || Math.abs(n - currentPage) <= 1)
                .map((n, i, list) => (
                  <React.Fragment key={n}>
                    {i > 0 && n - list[i - 1] > 1 && <span className="px-1 text-[#94a09d]">…</span>}
                    <button type="button" className={n === currentPage ? 'is-active' : ''} aria-current={n === currentPage ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>
                  </React.Fragment>
                ))}
              <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page">›</button>
            </div>
          </div>
        )}
      </div>
      <SubmissionDetailDialog
        receipt={selected}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        isMine={Boolean(selected && selected.public_id === myReceiptId)}
        canOpenDocument={Boolean(selected && (selected.public_id === myReceiptId || isStaff))}
        myEdit={myEdit}
      />
    </>
  );
}

export function BillPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch, getBillOutcomes } = useApp();
  const [myReceipt, setMyReceipt] = useState<{ public_id: string; editable: boolean; edit_block?: EditBlock } | null>(null);
  const bill = state.bills.find(b => b.id === id);
  const isCitizen = state.currentUser?.role === 'citizen';
  const participationData = useParticipationSummary(id);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const refreshFlow = async () => {
      try {
        const flow = await api.billFlow(id);
        if (cancelled) return;
        const reports = flow.reports || [];
        const reportIds = new Set(reports.map((report: { id: string }) => report.id));
        dispatch({
          type: 'HYDRATE',
          payload: {
            reports: [...state.reports.filter(report => report.bill_ref !== id), ...reports],
            reportEntries: [...state.reportEntries.filter(entry => !reportIds.has(entry.report_ref)), ...(flow.report_entries || [])],
          },
        });
        const extractionRunning = reports.some((report: { extraction_status: string }) => ['pending', 'extracting'].includes(report.extraction_status));
        if (extractionRunning && attempts < 24) {
          attempts += 1;
          timer = setTimeout(refreshFlow, 3000);
        }
      } catch {
        // Preserve bootstrap data if the detail refresh is temporarily unavailable.
      }
    };
    void refreshFlow();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [dispatch, id]);

  useEffect(() => {
    if (!id || !isCitizen) { setMyReceipt(null); return; }
    let cancelled = false;
    api.myReceiptForBill(id).then(result => { if (!cancelled) setMyReceipt(result.receipt); }).catch(() => { if (!cancelled) setMyReceipt(null); });
    return () => { cancelled = true; };
  }, [id, isCitizen, state.receipts.length]);

  if (!bill && state.isLoading) {
    return <div className="card text-center py-20 text-surface-600 font-semibold" role="status">Loading the bill…</div>;
  }
  if (!bill) {
    return (
      <div className="card text-center py-20">
        <FileSearch className="h-16 w-16 text-surface-300 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-surface-900 mb-2">{state.currentUser?.role === 'committee_officer' ? "Not one of your committee's bills" : 'Bill not found'}</h2>
        <p className="text-surface-500 mb-6">{state.currentUser?.role === 'committee_officer' ? 'Clerk’s Office accounts can only open bills assigned to their own committee.' : "The bill you're looking for doesn't exist or has been removed."}</p>
        <Link to="/bills" className="action-button is-primary">
          <ArrowLeft className="h-4 w-4" /> Back to Bills
        </Link>
      </div>
    );
  }

  const participation = participationFor(bill);
  const canSubmit = participation.accepting && (!state.currentUser || isCitizen);
  const submitLabel = myReceipt ? (myReceipt.editable ? 'Edit your submission' : 'View your submission') : 'Submit your view';
  const submitHref = myReceipt && !myReceipt.editable ? `/receipt-lookup?id=${myReceipt.public_id}` : `/submit?bill=${bill.id}`;

  const billReceipts = state.receipts.filter(r => r.legislative_item_id === bill.id);
  const billNotices = state.notices.filter(n => n.bill_ref === bill.id);
  const billReports = state.reports.filter(r => r.bill_ref === bill.id);
  const billStageSource = (bill.documents || []).find(doc => /official bills tracker/i.test(doc.name));
  const documentHref = (doc: { url?: string; storage_ref?: string }, index: number) => doc.url && doc.url !== '#'
    ? doc.url
    : doc.storage_ref ? `${getApiUrl()}/bills/${encodeURIComponent(bill.id)}/documents/${index}` : undefined;
  // The bill's text; for a county bill that is now law, the Act on Kenya Law.
  const billTextIndex = (() => {
    const docs = bill.documents || [];
    const isText = (pattern: RegExp) => docs.findIndex((doc, i) => pattern.test(doc.name) && Boolean(documentHref(doc, i)));
    const text = isText(/official bill document|bill text/i);
    return text >= 0 ? text : isText(/kenya law/i);
  })();
  const billText = billTextIndex >= 0 ? { ...(bill.documents || [])[billTextIndex], href: documentHref((bill.documents || [])[billTextIndex], billTextIndex)! } : null;
  // The latest committee report that can be opened, for the reading panel at the top.
  const latestReport = [...billReports].sort((a, b) => (b.date_tabled || '').localeCompare(a.date_tabled || '')).find(report => reportDocumentHref(report));
  const timelineHistory: Array<{ date: string; stage: string; note: string; isLatestStage?: boolean; sourceUrl?: string }> = (bill.status_history || []).map(item => ({ ...item }));
  const stageTimelineDate = bill.stage_as_at || bill.source_updated_at || '';
  const latestIndex = timelineHistory.length - 1;
  const stageAlreadyLast = latestIndex >= 0 && timelineHistory[latestIndex].stage.toLowerCase() === bill.stage.toLowerCase();
  if (stageAlreadyLast) {
    timelineHistory[latestIndex] = { ...timelineHistory[latestIndex], isLatestStage: true, sourceUrl: billStageSource?.url };
  } else if (bill.stage) {
    timelineHistory.push({
      date: stageTimelineDate || 'Latest record',
      stage: bill.stage,
      note: billStageSource ? `Current stage recorded in the official National Assembly Bills Tracker${stageTimelineDate ? ` as at ${formatDate(stageTimelineDate)}` : ''}.` : bill.institution === 'National Assembly' ? 'Last stage recorded in the Parliament legislative proposals tracker.' : `Latest stage recorded for this ${bill.institution} bill.`,
      isLatestStage: true,
      sourceUrl: billStageSource?.url,
    });
  }
  const outcomes = getBillOutcomes(bill.id);
  const billMatches = state.matches.filter(m => billReceipts.some(r => r.id === m.receipt_ref));
  const confirmedMatches = billMatches.filter(m => m.reviewer_decision === 'confirmed');
  const averageConfidence = billMatches.length ? billMatches.reduce((sum, m) => sum + m.confidence_score, 0) / billMatches.length : 0;
  const confidenceBands = [
    { name: 'High', value: billMatches.filter(m => m.confidence_score >= 0.75).length, color: '#22c55e' },
    { name: 'Moderate', value: billMatches.filter(m => m.confidence_score >= 0.5 && m.confidence_score < 0.75).length, color: '#f59e0b' },
    { name: 'Low', value: billMatches.filter(m => m.confidence_score < 0.5).length, color: '#ef4444' },
  ];
  // Submissions the committee report records (written memoranda, hearings), read by the AI.
  const reportItems = participationData.items;
  const REPORT_STAGE: Record<ReportDecision, SubmissionStage> = { adopted: 'adopted', amended: 'amended', rejected: 'rejected', 'not addressed': 'not_addressed' };
  const reportCount = (status: SubmissionStage) => reportItems.filter(item => REPORT_STAGE[item.decision] === status).length;
  const allOutcomes = outcomes.map(o => ({ ...o, platform: o.count, report: reportCount(o.status), count: o.count + reportCount(o.status) }));
  const totalSubmissions = billReceipts.length + reportItems.length;
  const outcomeChart = allOutcomes.map(o => ({ name: o.status.replace('_', ' '), submissions: o.count }));

  const sectionHeading = (Icon: React.ElementType, kicker: string, title: React.ReactNode, description?: string) => (
    <div className="mb-6">
      <div className="inline-flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-[#a52d29]" aria-hidden="true" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29]">{kicker}</span>
      </div>
      <h2 className="text-2xl md:text-3xl font-black text-[#182020] tracking-tight">{title}</h2>
      {description && <p className="mt-2 text-sm text-[#596767]">{description}</p>}
    </div>
  );

  return (
    <div className="w-full min-w-0 space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm mb-2" aria-label="Breadcrumb">
        <Link to="/bills" className="flex items-center gap-1.5 font-semibold text-[#11521f] hover:underline">
          <ArrowLeft className="h-4 w-4" /> Bills
        </Link>
        <span className="text-[#b9b4a8]">/</span>
        <span className="min-w-0 font-medium text-[#3b4747] break-words line-clamp-2 max-w-xl">{bill.title}</span>
      </nav>

      {/* Title, stage and participation status */}
      <header className="space-y-4">
        <h1 className="bill-title text-3xl md:text-4xl lg:text-5xl font-black tracking-tighter text-[#182020] leading-tight break-words">
          {bill.title}
          <StagePill stage={bill.stage} asAt={bill.source_updated_at ? formatDate(bill.source_updated_at) : undefined} />
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-mono font-bold text-[#3b4747] bg-[#f1eee7] px-3 py-1 rounded-lg border border-[#e2ded5]">{bill.identifier}</span>
          <span className="flex items-center gap-1.5 font-semibold text-[#3b4747]"><Building2 className="h-4 w-4 text-[#176b2b]" aria-hidden="true" /> {bill.institution}</span>
          <CallForViewsBadge call={callForViews(billNotices)} />
          {bill.committee_id && (
            <span className="flex items-center gap-1.5 font-semibold text-[#3b4747]">
              <Users className="h-4 w-4 text-[#a52d29]" aria-hidden="true" /> {state.committees.find(c => c.id === bill.committee_id)?.name || 'Committee'}
              {bill.committee_assignment_source === 'subject matter' && <span className="text-xs font-semibold text-surface-500">(by subject, not yet confirmed)</span>}
            </span>
          )}
          {billStageSource?.url && <a href={billStageSource.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#11521f] underline underline-offset-2">Stage from the National Assembly Bills Tracker{bill.source_updated_at ? ` · as at ${formatDate(bill.source_updated_at)}` : ''}</a>}
        </div>
        <div className="read-bill-panel">
          <div className="read-bill-icon"><BookOpenText className="h-6 w-6" aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <strong>{billText ? 'Read the bill' : 'Bill text not yet available'}</strong>
            <span>{billText
              ? (/kenya law/i.test(billText.name) ? 'The Act as passed, on Kenya Law.' : `The official text published by ${bill.institution === 'National Assembly' ? 'Parliament' : `the ${bill.institution}`} (PDF).`)
              : `${bill.institution === 'National Assembly' ? 'Parliament' : `The ${bill.institution}`} has not published this bill's text online yet. Its stage and committee documents are below.`}</span>
          </div>
          {billText && <a href={billText.href} target="_blank" rel="noreferrer" className={`action-button ${participationData.finalAct?.has_text ? 'is-secondary' : 'is-primary'}`}><FileText className="h-4 w-4" aria-hidden="true" /> Read the bill</a>}
          {latestReport && <a href={reportDocumentHref(latestReport)} target="_blank" rel="noreferrer" className={`action-button ${billText ? 'is-secondary' : 'is-primary'}`} title={latestReport.title || undefined}><FileCheck className="h-4 w-4" aria-hidden="true" /> Read the committee report{billReports.length > 1 ? ` (latest of ${billReports.length})` : ''}</a>}
          {participationData.finalAct?.has_text && <Link to={`/bills/${bill.id}/act`} className="action-button is-primary"><BookOpenText className="h-4 w-4" aria-hidden="true" /> Read the final Act</Link>}
        </div>
        <div className={`participation-banner ${participation.accepting ? 'is-open' : 'is-closed'}`} role="status">
          <p>
            <strong>{participation.accepting ? (participation.closes_on ? `Open for submissions until ${formatDate(participation.closes_on)}` : 'Open for submissions') : participation.status === 'not_yet_open' ? 'Not yet open for submissions' : 'Submissions are closed'}</strong>
            {participation.reason}
          </p>
          {canSubmit && <Link to={submitHref} className="action-button is-primary">{submitLabel}</Link>}
          {!canSubmit && myReceipt && <Link to={`/receipt-lookup?id=${myReceipt.public_id}`} className="action-button is-secondary">View your submission</Link>}
        </div>
      </header>

      <BillStageTracker stage={bill.stage} accepting={participation.accepting} />

      {/* Where the submissions are */}
      <Card className="!p-7 md:!p-8" hover={false}>
        {sectionHeading(FileCheck, 'Submissions', 'Where the submissions are', 'Every submission on this bill, whether sent on this platform or made to the committee directly, and how the committee treated it.')}
        <p className="text-sm font-semibold text-[#3b4747] mb-4">
          {totalSubmissions} submission{totalSubmissions === 1 ? '' : 's'} traced: {billReceipts.length} sent on this platform{reportItems.length ? `, ${reportItems.length} recorded in the committee report (written memoranda and hearings)` : ''}.
        </p>
        <div className="stage-counts">
          {allOutcomes.map(o => (
            <div key={o.status} className={`stage-count ${o.count ? '' : 'is-zero'}`}>
              <strong>{o.count}</strong>
              <SubmissionStatusBadge status={o.status as SubmissionStatus} />
              {o.report > 0 && <small className="block text-[11px] font-semibold text-[#687575] mt-1">{o.platform} on this platform · {o.report} in the report</small>}
            </div>
          ))}
        </div>
        <p className="mt-4 mb-0 text-xs font-semibold text-surface-500">Outcome labels record what the committee's report says. They are not legal findings or judgments about anyone.</p>
        <ReportAnalysisPanel data={participationData} hasReport={billReports.length > 0} />
        <HousePanel data={participationData} passed={/^(assented|passed by national assembly|passed by senate|mediation report adopted)$/i.test(bill.stage)} />
        <FinalActPanel data={participationData} assented={/^assented$/i.test(bill.stage)} />
        <details className="bill-stats">
          <summary>See statistics and charts</summary>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <div className="rounded-2xl bg-[#f1f8f2] border border-[#cfe5d4] p-4"><p className="text-xs font-black uppercase tracking-wider text-[#176b2b]">Submissions</p><p className="text-3xl font-black text-[#0f4f1f] mt-1">{totalSubmissions}</p></div>
          <div className="rounded-2xl bg-[#f2f6fb] border border-[#cfdcee] p-4"><p className="text-xs font-black uppercase tracking-wider text-[#1d3557]">Platform views matched</p><p className="text-3xl font-black text-[#1d3557] mt-1">{confirmedMatches.length}</p></div>
          <div className="rounded-2xl bg-[#fdf5e4] border border-[#f0d9a8] p-4"><p className="text-xs font-black uppercase tracking-wider text-[#7a4a05]">Reports</p><p className="text-3xl font-black text-[#6b4106] mt-1">{billReports.length}</p></div>
          <div className="rounded-2xl bg-[#f6f5f1] border border-[#e2ded5] p-4"><p className="text-xs font-black uppercase tracking-wider text-[#526060]">Avg confidence</p><p className="text-3xl font-black text-[#182020] mt-1">{billMatches.length ? `${Math.round(averageConfidence * 100)}%` : '—'}</p></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div><h3 className="font-black text-[#182020] mb-4">Submission outcomes</h3><div className="h-64">{totalSubmissions ? <ResponsiveContainer width="100%" height="100%"><BarChart data={outcomeChart} margin={{ top: 8, right: 12, left: -20, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={45} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="submissions" fill="#176b2b" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center rounded-2xl bg-[#faf9f6] text-sm text-[#687575]">No submission data yet.</div>}</div></div>
          <div><h3 className="font-black text-[#182020] mb-4">Match confidence bands</h3><div className="h-64">{billMatches.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={confidenceBands} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={3} label={({ name, value }) => `${name}: ${value}`}><Cell fill="#22c55e" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" /></Pie><Tooltip /></PieChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center rounded-2xl bg-[#faf9f6] text-sm text-[#687575] text-center px-6">{billReceipts.length ? 'The AI has not proposed matches for the views sent on this platform yet.' : 'Matching links views sent on this platform to the committee report. No views were sent on this platform for this bill, so there is nothing to match. The submissions above come from the committee report itself.'}</div>}</div>{billMatches.length > 0 && <div className="flex justify-center gap-4 text-xs font-bold text-[#3b4747]"><span><i className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1" />High ≥75%</span><span><i className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 mr-1" />Moderate</span><span><i className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-1" />Low</span></div>}</div>
        </div>
        </details>
      </Card>

      {/* Submissions */}
      <Card className="!p-7 md:!p-8" hover={false}>
        {sectionHeading(Users, 'Public Submissions', <>Submissions <span className="text-[#94a09d]">({totalSubmissions})</span></>, totalSubmissions ? 'Who said what, and how the committee treated it. Select a submission to read it in full.' : undefined)}
        {totalSubmissions === 0 ? (
          <div className="text-center py-12 rounded-2xl bg-[#faf9f6] border border-dashed border-[#e2ded5]">
            <Users className="h-12 w-12 text-[#cfcac0] mx-auto mb-3" aria-hidden="true" />
            <p className="text-lg font-semibold text-[#3b4747]">No submissions yet for this bill.</p>
            {canSubmit ? (
              <>
                <p className="text-sm text-[#687575] mb-5">Be the first to submit your view.</p>
                <Link to={submitHref} className="action-button is-primary">{submitLabel}</Link>
              </>
            ) : <p className="text-sm text-[#687575]">{participation.reason}</p>}
          </div>
        ) : (
          <div className="grid gap-8">
            {billReceipts.length > 0 && (
              <div>
                <h3 className="text-lg font-black text-[#182020] mb-3">Sent on this platform <span className="text-[#94a09d]">({billReceipts.length})</span></h3>
                <SubmissionsTable receipts={billReceipts} myReceiptId={myReceipt?.public_id} myEdit={myReceipt} />
              </div>
            )}
            {reportItems.length > 0 && (
              <div>
                <h3 className="text-lg font-black text-[#182020] mb-1">Recorded in the committee report <span className="text-[#94a09d]">({reportItems.length})</span></h3>
                <p className="text-sm text-[#596767] mb-3">Memoranda and oral submissions the committee lists in its report, with what it decided on each. Read from the report by AI: open the report to check any item.</p>
                <ReportSubmissionsTable items={reportItems} finalAct={participationData.finalAct} house={participationData.house} submitters={participationData.summary?.report_analysis?.submitters} platformLinks={participationData.summary?.platform_links} />
              </div>
            )}
          </div>
        )}
      </Card>


      {/* Documents */}
      <div id="documents">
        <Card className="!p-7 md:!p-8" hover={false}>
          {sectionHeading(FileText, 'Documentation', 'Documents', bill.institution === 'National Assembly' ? 'Official bill documents and the Parliament trackers that record its stage.' : `Official documents published by the ${bill.institution}, and the Act on Kenya Law once it becomes law.`)}
          <div className="space-y-3">
            {(bill.documents || []).map((doc, i) => {
              const documentUrl = doc.url && doc.url !== '#'
                ? doc.url
                : doc.storage_ref
                  ? `${getApiUrl()}/bills/${encodeURIComponent(bill.id)}/documents/${i}`
                  : undefined;
              const isBillText = /bill\s*(text|document)|official bill/i.test(doc.name);
              const content = (
                <>
                  <div className="w-11 h-11 rounded-xl bg-[#edf7ef] border border-[#cfe5d4] flex items-center justify-center text-[#176b2b] flex-shrink-0">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#182020] break-words">{doc.name}</p>
                    <p className="text-xs text-[#687575] font-medium">{/kenya law/i.test(doc.name) ? 'The county Act in force, on Kenya Law' : isBillText ? (bill.institution === 'National Assembly' ? 'Official bill document from Parliament' : `Official bill document from the ${bill.institution}`) : /official bills tracker/i.test(doc.name) ? 'Official Parliament source for the current bill stage' : /tracker/i.test(doc.name) ? 'Parliament legislative proposals tracker' : documentUrl ? 'Open source document' : 'Download readable bill record'}</p>
                  </div>
                  {documentUrl ? <ArrowRight className="h-4 w-4 text-[#94a09d] flex-shrink-0" aria-hidden="true" /> : <Download className="h-4 w-4 text-[#94a09d] flex-shrink-0" aria-hidden="true" />}
                </>
              );
              const rowClass = 'w-full text-left flex items-center gap-4 p-4 rounded-2xl bg-[#faf9f6] border border-[#e7e3da] hover:bg-white hover:border-[#cfe5d4] transition-colors';
              return documentUrl ? (
                <a key={i} href={documentUrl} target="_blank" rel="noreferrer" download={doc.name} className={rowClass}>{content}</a>
              ) : (
                <button key={i} type="button" onClick={() => downloadReadableBillDocument(bill, doc.name)} className={rowClass}>{content}</button>
              );
            })}
            {!(bill.documents || []).length && <p className="text-sm text-[#687575]">No documents are recorded for this bill yet.</p>}
          </div>
        </Card>
      </div>

      {/* Committee reports */}
      <Card className="!p-7 md:!p-8" hover={false}>
        {sectionHeading(FileCheck, 'Committee Outputs', 'Committee Reports', billReports.length ? undefined : 'The committee report on this bill will appear here once it is tabled.')}
        {billReports.length > 0 && (
          <div className="space-y-4">
            {billReports.map(report => {
              const entriesCount = state.reportEntries.filter(entry => entry.report_ref === report.id).length;
              const extractionMessages: Record<string, string> = {
                pending: 'PDF text extraction has not started yet.',
                extracting: 'Reading the PDF to create reviewable report entries…',
                needs_review: 'PDF extraction needs staff review before matching.',
                extracted: entriesCount ? `${entriesCount} reviewable report entr${entriesCount === 1 ? 'y is' : 'ies are'} available.` : 'PDF text was extracted, but no reviewable entries were recognized.',
                ocr_used: entriesCount ? `${entriesCount} reviewable entr${entriesCount === 1 ? 'y was' : 'ies were'} extracted using OCR.` : 'OCR completed, but no reviewable entries were recognized.',
                verified: 'Report contents have been reviewed and verified.',
              };
              return (
                <a key={report.id} href={reportDocumentHref(report)} target="_blank" rel="noreferrer" aria-label={`Open committee report ${report.title || report.source_document_ref}`} className="block rounded-2xl p-5 border border-[#e7e3da] bg-[#faf9f6] hover:bg-white hover:border-[#cfe5d4] transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <span className="font-bold text-[#182020] break-words">{report.title || report.source_document_ref}</span>
                    <Badge variant={report.source_verification_status === 'verified' ? 'green' : 'gray'}>{report.source_verification_status === 'verified' ? 'Official Parliament source · Verified' : 'Source not verified'}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#687575]">
                    <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Tabled: {formatDate(report.date_tabled)}</span>
                    <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden="true" /> {report.institution}</span>
                    <span>{extractionMessages[report.extraction_status] || 'Report text extraction status: ' + report.extraction_status}</span>
                    {report.ocr_used && <Badge variant="warm" className="!text-[10px]">OCR USED</Badge>}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </Card>

      {/* Stage History */}
      <Card className="!p-7 md:!p-8" hover={false}>
        {sectionHeading(Clock, 'Legislative Timeline', 'Stage History')}
        <ol className="relative pl-2 md:pl-4 space-y-5">
          <span className="absolute left-0 top-2 bottom-2 w-px bg-[#e2ded5]" aria-hidden="true" />
          {timelineHistory.map((sh, i) => (
            <li key={i} className="relative flex items-start gap-4 md:gap-5">
              <div className={`flex-shrink-0 relative z-10 w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white ${sh.isLatestStage ? 'bg-[#176b2b]' : 'bg-[#526060]'}`}>
                <span className="text-[11px] md:text-xs font-black">{i + 1}</span>
              </div>
              <div className="flex-1 bg-[#faf9f6] rounded-2xl p-4 md:p-5 border border-[#e7e3da]">
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-[#526060] bg-white px-2.5 py-1 rounded-md border border-[#e2ded5]">{/^\d{4}-\d{2}-\d{2}/.test(sh.date) ? formatDate(sh.date) : sh.date}</span>
                  <span className="font-black text-[#182020] text-[15px]">{sh.stage}</span>
                  {sh.isLatestStage && <span className="rounded-full bg-[#e9f5ec] border border-[#bcdcc4] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#0f4f1f]">Latest stage</span>}
                </div>
                <p className="text-sm text-[#3b4747] leading-relaxed font-medium m-0">{sh.note}</p>
                {sh.isLatestStage && sh.sourceUrl && <a href={sh.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#11521f] underline underline-offset-2">Open official National Assembly tracker</a>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* Notices */}
      {billNotices.length > 0 && (
        <Card className="!p-7 md:!p-8" hover={false}>
          {sectionHeading(Calendar, 'Public Engagement', 'Calls for Memoranda')}
          <div className="committee-notice-table-wrap">
            <table className="committee-notice-table">
              <thead>
                <tr><th>Notice date</th><th>Window</th><th>Length</th><th>Mode</th><th>Bill text</th></tr>
              </thead>
              <tbody>
                {billNotices.map(notice => (
                  <tr key={notice.id}>
                    <td className="committee-notice-date">{formatDate(notice.notice_date)}</td>
                    <td className="committee-notice-window">{formatDate(notice.window_start)}<span className="committee-notice-arrow">→</span>{formatDate(notice.window_end)}</td>
                    <td><Badge variant={getWindowLength(notice) >= 14 ? 'accent' : 'warm'}>{getWindowLength(notice)} days</Badge></td>
                    <td className="committee-notice-mode">{notice.mode}</td>
                    <td>{notice.bill_text_accessible ? <Badge variant="green" showIcon>Accessible</Badge> : <Badge variant="red" showIcon>Not provided</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Final CTA, only while the committee is taking views */}
      {canSubmit && (
        <section className="rounded-3xl p-8 md:p-12 text-center text-white" style={{ background: 'linear-gradient(135deg, #101616 0%, #1f2a24 55%, #176b2b 100%)' }}>
          <h2 className="text-2xl md:text-4xl font-black tracking-tighter mb-3">{myReceipt ? 'Want to change your submission?' : 'Have a view on this bill?'}</h2>
          <p className="text-white/85 text-base md:text-lg max-w-2xl mx-auto mb-7 font-medium leading-relaxed">
            {myReceipt
              ? `You can edit submission ${myReceipt.public_id} until the committee's call for views closes. Your receipt ID stays the same.`
              : 'Write your view or upload your memorandum. You get a tamper-evident receipt you can trace to the committee report.'}
          </p>
          <Link to={submitHref} className="action-button is-secondary !px-8 !py-3.5 !text-base">{submitLabel}</Link>
        </section>
      )}
    </div>
  );
}
