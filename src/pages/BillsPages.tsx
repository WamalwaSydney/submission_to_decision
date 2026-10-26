import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getDaysOfNotice, getWindowLength } from '../utils/noticeDates';
import { SubmissionStatus } from '../types';
import {
  FileText, Clock, Building2, ArrowRight, ArrowLeft,
  FileCheck, Calendar, FileSearch, Gavel, Users, Download, SlidersHorizontal, RotateCcw
} from 'lucide-react';
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

export function BillsListPage() {
  const { state, dispatch } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const committee = searchParams.get('committee') || 'all';
  const setCommittee = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete('committee');
    else next.set('committee', value);
    setSearchParams(next, { replace: true });
  };
  const [institution, setInstitution] = useState('all');
  const [stage, setStage] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [participation, setParticipation] = useState('all');
  const [sortBy, setSortBy] = useState('recent');

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.committees(), api.bills()]).then(([committeeResponse, billResponse]) => {
      if (cancelled) return;
      const payload: { committees?: typeof committeeResponse.committees; bills?: typeof billResponse.bills } = {};
      if (committeeResponse.committees?.length) payload.committees = committeeResponse.committees;
      if (billResponse.bills?.length) payload.bills = billResponse.bills;
      dispatch({
        type: 'HYDRATE',
        payload,
      });
    }).catch(() => { /* The cached/bootstrap data remains usable. */ });
    return () => { cancelled = true; };
  }, [dispatch]);

  const getOutcome = (billId: string) => {
    const billMatch = (decision: string) => state.matches.find(m => m.reviewer_decision === decision && state.receipts.some(r => r.id === m.receipt_ref && r.legislative_item_id === billId));
    const confirmed = billMatch('confirmed');
    if (confirmed) {
      const treatment = state.reportEntries.find(e => e.id === confirmed.report_entry_ref)?.treatment;
      return treatment && !['unclassified', 'awaiting committee report'].includes(treatment) ? treatment : 'adopted';
    }
    return billMatch('rejected') ? 'rejected with reasons' : 'awaiting committee report';
  };
  const committeeName = (bill: typeof state.bills[number]) => state.committees.find(c => c.id === bill.committee_id)?.name || `Unassigned — ${bill.institution}`;
  const reset = () => { setQuery(''); setCommittee('all'); setInstitution('all'); setStage('all'); setOutcome('all'); setParticipation('all'); setSortBy('recent'); };
  const bills = state.bills.filter(bill => {
    const receipts = state.receipts.filter(r => r.legislative_item_id === bill.id);
    const searchable = `${bill.title} ${bill.identifier} ${bill.institution} ${committeeName(bill)}`.toLowerCase();
    const matchesCommittee = committee === 'all' || (committee === '__unassigned__' ? !bill.committee_id : bill.committee_id === committee);
    return (!query || searchable.includes(query.toLowerCase())) && matchesCommittee && (institution === 'all' || bill.institution === institution) && (stage === 'all' || bill.stage === stage) && (outcome === 'all' || getOutcome(bill.id) === outcome) && (participation === 'all' || (participation === 'with' ? receipts.length > 0 : receipts.length === 0));
  }).sort((a, b) => sortBy === 'title' ? a.title.localeCompare(b.title) : sortBy === 'submissions' ? state.receipts.filter(r => r.legislative_item_id === b.id).length - state.receipts.filter(r => r.legislative_item_id === a.id).length : (b.status_history?.[b.status_history.length - 1]?.date || '').localeCompare(a.status_history?.[a.status_history.length - 1]?.date || ''));
  const committeeDirectory = [
    ...state.committees.map(item => ({ id: item.id, name: item.name, institution: item.institution, count: state.bills.filter(bill => bill.committee_id === item.id).length })),
    ...(state.bills.some(bill => !bill.committee_id) ? [{ id: '__unassigned__', name: 'Unassigned bills', institution: 'Needs committee assignment', count: state.bills.filter(bill => !bill.committee_id).length }] : []),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const activeCommittee = committeeDirectory.find(item => item.id === committee);
  const hasActiveFilters = Boolean(query.trim()) || committee !== 'all' || institution !== 'all' || stage !== 'all' || outcome !== 'all' || participation !== 'all';

  return <div className="space-y-10">
    <div><div className="inline-flex items-center gap-2 mb-4"><span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" /><span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Legislative Tracking</span></div><h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">Tracked <span className="gradient-text">Bills</span></h1><p className="text-lg text-surface-600 max-w-3xl leading-relaxed">Browse legislation organized by committee. Follow submissions, committee reports, matching evidence, and published outcomes.</p></div>
    <InfoBox className="!p-5 !max-w-5xl"><div className="pl-3 flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-700 flex-shrink-0"><Gavel className="h-5 w-5" /></div><p className="text-sm font-semibold leading-relaxed"><strong className="font-black">Note:</strong> Legislative tracking is national and unbounded. Citizen activity is currently available in Nairobi and Trans Nzoia counties.</p></div></InfoBox>
    <Card className="!p-5 md:!p-6"><div className="flex items-center justify-between gap-3 mb-5"><div className="flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-primary-600" /><h2 className="text-lg font-black">Advanced filters</h2></div><button type="button" onClick={reset} className="btn-secondary !py-2 !px-3 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Reset</button></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"><div className="lg:col-span-2"><Label>Search</Label><InputField value={query} onChange={e => setQuery(e.target.value)} placeholder="Title, bill ID, institution, or committee" /></div><div><Label>Committee</Label><select className="input-field" value={committee} onChange={e => setCommittee(e.target.value)}><option value="all">All committees</option>{state.committees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{state.bills.some(b => !b.committee_id) && <option value="__unassigned__">Unassigned bills</option>}</select></div><div><Label>Institution</Label><select className="input-field" value={institution} onChange={e => setInstitution(e.target.value)}><option value="all">All institutions</option>{Array.from(new Set(state.bills.map(b => b.institution))).map(i => <option key={i} value={i}>{i}</option>)}</select></div><div><Label>Stage</Label><select className="input-field" value={stage} onChange={e => setStage(e.target.value)}><option value="all">All stages</option>{Array.from(new Set(state.bills.map(b => b.stage))).map(s => <option key={s} value={s}>{s}</option>)}</select></div><div><Label>Outcome</Label><select className="input-field" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="all">All outcomes</option>{['awaiting committee report', 'adopted', 'amended', 'rejected with reasons', 'not addressed'].map(o => <option key={o} value={o}>{o}</option>)}</select></div><div><Label>Participation</Label><select className="input-field" value={participation} onChange={e => setParticipation(e.target.value)}><option value="all">All bills</option><option value="with">With submissions</option><option value="without">Without submissions</option></select></div><div><Label>Sort by</Label><select className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="recent">Most recently updated</option><option value="title">Title A–Z</option><option value="submissions">Most submissions</option></select></div></div></Card>
    {committee === 'all' && !hasActiveFilters ? (
      <section className="committee-directory" aria-label="Choose a committee">
        <div className="committee-directory-heading">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Browse by committee</p><h2>Choose a committee</h2><p>Select a committee to view its tracked bills and continue to each bill’s participation flow.</p></div>
          <span>{committeeDirectory.length} committees</span>
        </div>
        {committeeDirectory.length ? (
          <div className="committee-directory-grid">
            {committeeDirectory.map(item => (
              <button type="button" key={item.id} className="committee-directory-card" onClick={() => setCommittee(item.id)}>
                <span className="committee-directory-icon"><Building2 size={21} /></span>
                <span className="committee-directory-copy"><strong>{item.name}</strong><small>{item.institution}</small></span>
                <span className="committee-directory-count">{item.count} {item.count === 1 ? 'bill' : 'bills'}</span>
                <ArrowRight className="committee-directory-arrow" size={18} />
              </button>
            ))}
          </div>
        ) : (
          <Card className="!p-10 text-center"><Building2 className="h-10 w-10 text-surface-300 mx-auto mb-3" /><h2 className="text-xl font-black">No committees available yet</h2><p className="text-surface-500 mt-1">Committee records will appear here when they are loaded.</p></Card>
        )}
      </section>
    ) : (
      <section className="committee-bills-view">
        <div className="committee-bills-view-heading">
          <button type="button" className="committee-back-button" onClick={() => setCommittee('all')}><ArrowLeft size={17} /> All committees</button>
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Selected committee</p><h2>{committee === 'all' ? 'Matching bills' : activeCommittee?.name || 'Unassigned bills'}</h2><p>{committee === 'all' ? 'Across all committees and institutions' : activeCommittee?.institution || 'Bills awaiting committee assignment'} · {bills.length} matching {bills.length === 1 ? 'bill' : 'bills'}</p></div>
        </div>
        <div className="space-y-4">
          {bills.map((bill, idx) => {
            const receipts = state.receipts.filter(r => r.legislative_item_id === bill.id);
            const notices = state.notices.filter(n => n.bill_ref === bill.id);
            const status = getOutcome(bill.id);
            const stageSource = (bill.documents || []).find(doc => /official bills tracker/i.test(doc.name));
            return <motion.div key={bill.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.35, delay: idx * 0.025 }}>
              <Link to={`/bills/${bill.id}`} className="card block !p-6 md:!p-7 group relative overflow-hidden">
                <div className="relative flex items-start justify-between gap-4"><div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-3"><h2 className="text-xl md:text-[22px] font-black text-surface-900 tracking-tight leading-snug">{bill.title}</h2></div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm mb-5"><span className="flex items-center gap-1.5 font-semibold text-surface-600"><Building2 className="h-4 w-4 text-primary-500" />{bill.institution}</span><span className="flex items-center gap-1.5 font-semibold text-surface-700"><Clock className="h-4 w-4 text-warm-500" /><span><span className="font-black">{stageSource ? 'Current stage' : 'Last recorded stage'}:</span> {bill.stage}</span></span>{stageSource && bill.source_updated_at && <span className="text-xs font-semibold text-surface-500">National Assembly tracker as at {bill.source_updated_at}</span>}<span className="font-mono text-xs font-bold text-surface-500 bg-surface-100 px-2 py-0.5 rounded-md border border-surface-200">{bill.identifier}</span></div>
                  <div className="flex flex-wrap gap-3"><span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-50/80 border border-primary-100 text-primary-700 text-xs font-bold"><Users className="h-3.5 w-3.5" />{receipts.length} submission{receipts.length !== 1 ? 's' : ''}</span><span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-50/80 border border-accent-100 text-accent-700 text-xs font-bold"><Calendar className="h-3.5 w-3.5" />{notices.length} notice{notices.length !== 1 ? 's' : ''}</span><span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warm-50/80 border border-warm-200 text-warm-700 text-xs font-bold"><FileText className="h-3.5 w-3.5" />{(bill.documents || []).length} document{(bill.documents || []).length !== 1 ? 's' : ''}</span></div>
                </div><div className="flex-shrink-0 self-center"><div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl border border-surface-200 flex items-center justify-center text-surface-400 group-hover:bg-gradient-to-br group-hover:from-primary-600 group-hover:to-accent-500 group-hover:border-transparent group-hover:text-white transition-all"><ArrowRight className="h-5 w-5" /></div></div></div>
              </Link>
            </motion.div>;
          })}
          {!bills.length && <Card className="!p-10 text-center"><FileSearch className="h-12 w-12 text-surface-300 mx-auto mb-3" /><h2 className="text-xl font-black">No bills match this committee and filter selection</h2><p className="text-surface-500 mt-1">Try adjusting the filters or return to all committees.</p></Card>}
        </div>
      </section>
    )}
  </div>;
}
export function BillPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch, getSubmissionStatus, getSubmissionReviewDecision, getBillOutcomes } = useApp();
  const bill = state.bills.find(b => b.id === id);

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

  if (!bill) {
    return (
      <div className="card text-center py-20">
        <FileSearch className="h-16 w-16 text-surface-300 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-surface-900 mb-2">Bill not found</h2>
        <p className="text-surface-500 mb-6">The bill you're looking for doesn't exist or has been removed.</p>
        <Link to="/bills" className="btn-primary inline-flex">
          <ArrowLeft className="h-4 w-4" /> Back to Bills
        </Link>
      </div>
    );
  }

  const billReceipts = state.receipts.filter(r => r.legislative_item_id === bill.id);
  const billNotices = state.notices.filter(n => n.bill_ref === bill.id);
  const billReports = state.reports.filter(r => r.bill_ref === bill.id);
  const billStageSource = (bill.documents || []).find(doc => /official bills tracker/i.test(doc.name));
  const timelineHistory: Array<{ date: string; stage: string; note: string; isLatestStage?: boolean; sourceUrl?: string }> = (bill.status_history || []).map(item => ({ ...item }));
  const stageTimelineDate = bill.stage_as_at || bill.source_updated_at || '';
  const stageTimelineIndex = timelineHistory.findIndex(item => item.stage === bill.stage && item.date === (stageTimelineDate || 'Latest record'));
  if (bill.stage && stageTimelineIndex >= 0) {
    timelineHistory[stageTimelineIndex] = {
      ...timelineHistory[stageTimelineIndex],
      note: billStageSource ? 'Current stage recorded in the official National Assembly Bills Tracker.' : timelineHistory[stageTimelineIndex].note,
      isLatestStage: true,
      sourceUrl: billStageSource?.url,
    };
  } else if (bill.stage) {
    timelineHistory.push({
      date: stageTimelineDate || 'Latest record',
      stage: bill.stage,
      note: billStageSource ? 'Current stage recorded in the official National Assembly Bills Tracker.' : 'Last stage recorded in the Parliament legislative proposals tracker.',
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
  const outcomeChart = outcomes.map(o => ({ name: o.status.replace(' with reasons', ''), submissions: o.count }));

  return (
    <div className="w-full min-w-0 space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-surface-500 mb-2">
        <Link to="/bills" className="flex items-center gap-1.5 font-semibold text-primary-600 hover:text-primary-700 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Bills
        </Link>
        <span className="text-surface-300">/</span>
        <span className="min-w-0 font-medium text-surface-700 break-words line-clamp-2 max-w-xl">{bill.title}</span>
      </nav>

      {/* Title header */}
      <div>
        <div className="flex items-start gap-3 mb-3 flex-wrap">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tighter text-surface-900 leading-tight break-words">
            {bill.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-mono font-bold text-surface-600 bg-surface-100 px-3 py-1 rounded-lg border border-surface-200">{bill.identifier}</span>
          <span className="flex items-center gap-1.5 font-semibold text-surface-700">
            <Building2 className="h-4 w-4 text-primary-500" /> {bill.institution}
          </span>
          <Badge variant="yellow"><Clock className="h-3 w-3" /> {billStageSource ? 'Current stage' : 'Last recorded stage'}: {bill.stage}</Badge>
          {billStageSource?.url && <a href={billStageSource.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary-700 hover:text-primary-900 underline underline-offset-2">National Assembly Bills Tracker · as at {bill.source_updated_at || 'latest update'}</a>}
        </div>
      </div>

      {/* Outcome Trail */}
      <Card className="!p-7 md:!p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 mb-2">
                <FileCheck className="h-4 w-4 text-primary-600" />
                <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Outcome Trail</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Submission Outcomes</h2>
            </div>
          </div>

          <DisclaimerBox className="mb-7">
            <div className="pl-3 text-sm">
              These are platform activity labels only. They are not legal findings, electoral judgments, or allegations of corruption.
            </div>
          </DisclaimerBox>

          {/* Outcome grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4 mb-6">
            {outcomes.map((o, i) => (
              <motion.div
                key={o.status}
                initial={{ opacity: 0, scale: 0.96 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="relative min-w-0 min-h-[132px] rounded-2xl p-4 md:p-5 bg-gradient-to-br from-white to-surface-50 border border-surface-200/80 shadow-soft hover:shadow-elevated transition-all hover:-translate-y-0.5 group flex flex-col items-start justify-between gap-3"
              >
                <p className="text-3xl md:text-4xl font-black text-surface-900 tracking-tight mb-2 group-hover:gradient-text transition-all">{o.count}</p>
                <div className="max-w-full"><SubmissionStatusBadge status={o.status as SubmissionStatus} /></div>
              </motion.div>
            ))}
          </div>

          <p className="text-sm font-semibold text-surface-600">
            Total submissions: <span className="font-black text-surface-900">{billReceipts.length}</span>. Each figure links to its underlying basis (bill/clause ref, timestamp, status).
          </p>
        </div>
      </Card>

      {/* Bill statistics */}
      <Card className="!p-7 md:!p-8">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-2"><FileCheck className="h-4 w-4 text-primary-600" /><span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Bill analytics</span></div>
          <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Graphical Statistics</h2>
          <p className="text-sm text-surface-500 mt-2">A visual summary of participation, recorded outcomes, and matching confidence for this bill.</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <div className="rounded-2xl bg-primary-50 border border-primary-100 p-4"><p className="text-xs font-black uppercase tracking-wider text-primary-700">Submissions</p><p className="text-3xl font-black text-primary-900 mt-1">{billReceipts.length}</p></div>
          <div className="rounded-2xl bg-accent-50 border border-accent-100 p-4"><p className="text-xs font-black uppercase tracking-wider text-accent-700">Matched</p><p className="text-3xl font-black text-accent-900 mt-1">{confirmedMatches.length}</p></div>
          <div className="rounded-2xl bg-warm-50 border border-warm-100 p-4"><p className="text-xs font-black uppercase tracking-wider text-warm-700">Reports</p><p className="text-3xl font-black text-warm-900 mt-1">{billReports.length}</p></div>
          <div className="rounded-2xl bg-surface-100 border border-surface-200 p-4"><p className="text-xs font-black uppercase tracking-wider text-surface-600">Avg confidence</p><p className="text-3xl font-black text-surface-900 mt-1">{billMatches.length ? `${Math.round(averageConfidence * 100)}%` : '—'}</p></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div><h3 className="font-black text-surface-900 mb-4">Submission outcomes</h3><div className="h-64">{billReceipts.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={outcomeChart} margin={{ top: 8, right: 12, left: -20, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={45} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="submissions" fill="#3a5cff" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center rounded-2xl bg-surface-50 text-sm text-surface-500">No submission data yet.</div>}</div></div>
          <div><h3 className="font-black text-surface-900 mb-4">Match confidence bands</h3><div className="h-64">{billMatches.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={confidenceBands} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={3} label={({ name, value }) => `${name}: ${value}`}><Cell fill="#22c55e" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" /></Pie><Tooltip /></PieChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center rounded-2xl bg-surface-50 text-sm text-surface-500">Matching has not been run yet.</div>}</div><div className="flex justify-center gap-4 text-xs font-bold text-surface-600"><span><i className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1" />High ≥75%</span><span><i className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 mr-1" />Moderate</span><span><i className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-1" />Low</span></div></div>
        </div>
      </Card>

      {/* Submissions list */}
      <Card className="!p-7 md:!p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-primary-600" />
              <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Public Submissions</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">
              Submissions <span className="text-surface-400">({billReceipts.length})</span>
            </h2>
          </div>
        </div>

        {billReceipts.length === 0 ? (
          <div className="text-center py-12 rounded-2xl bg-surface-50 border border-dashed border-surface-200">
            <Users className="h-12 w-12 text-surface-300 mx-auto mb-3" />
            <p className="text-lg font-semibold text-surface-600">No submissions yet for this bill.</p>
            <p className="text-sm text-surface-500 mb-5">Be the first to submit your view.</p>
            <Link to={`/submit?bill=${bill.id}`} className="btn-primary inline-flex">
              Submit Your View
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {billReceipts.map((receipt, i) => {
              const status = getSubmissionStatus(receipt.id);
              const reviewDecision = getSubmissionReviewDecision(receipt.id);
              const match = state.matches.find(m => m.receipt_ref === receipt.id && m.reviewer_decision === 'confirmed')
                || state.matches.find(m => m.receipt_ref === receipt.id && m.reviewer_decision === 'rejected');
              const entry = match ? state.reportEntries.find(e => e.id === match.report_entry_ref) : null;

              return (
                <motion.div
                  key={receipt.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.03 }}
                  className="relative rounded-2xl p-5 md:p-6 border border-surface-200/80 bg-white/80 backdrop-blur-sm shadow-soft hover:shadow-elevated transition-all hover:-translate-y-0.5 overflow-hidden group"
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-300/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                    <Link
                      to={`/receipt-lookup?id=${receipt.public_id}`}
                      className="font-mono text-sm font-bold text-primary-700 hover:text-primary-800 transition-colors bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg border border-primary-100"
                    >
                      {receipt.public_id}
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      <SubmissionStatusBadge status={status as SubmissionStatus} />
                      {reviewDecision && <Badge variant={reviewDecision === 'confirmed' ? 'green' : reviewDecision === 'pending' ? 'yellow' : 'red'}>Match {reviewDecision === 'confirmed' ? 'confirmed' : reviewDecision === 'pending' ? 'pending review' : 'rejected'}</Badge>}
                    </div>
                  </div>
                  {status === 'adopted' && match && <p className="text-xs font-semibold text-surface-500 mt-3">This submission was matched to the committee record and is recorded as adopted unless the report explicitly records an amendment, rejection with reasons, or that it was not addressed.</p>}
                  <p className="text-[15px] text-surface-800 leading-relaxed mb-4 bg-surface-50/60 p-4 rounded-xl border border-surface-100 font-medium">
                    {receipt.submission_text}
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-surface-500">
                    {receipt.clause_ref && (
                      <span className="px-2.5 py-1 rounded-md bg-surface-100 border border-surface-200">
                        Clause: {receipt.clause_ref}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(receipt.timestamp).toLocaleDateString()}
                    </span>
                    <span>Lodging: <span className="font-black text-surface-700">{receipt.lodging_status}</span></span>
                    {match && (
                      <span className="text-accent-700 flex items-center gap-1 bg-accent-50 px-2 py-0.5 rounded-md border border-accent-100">
                        <FileCheck className="h-3 w-3" />
                        Matched ({match.match_method}, {(match.confidence_score * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                  {(entry?.stated_reason || match?.reviewer_reason) && (
                    <div className="mt-4 text-xs bg-warm-50 p-4 rounded-xl border border-warm-200 text-warm-800 leading-relaxed">
                      <strong className="font-black">Reason:</strong> {entry?.stated_reason || match?.reviewer_reason}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Stage History */}
      <Card className="!p-7 md:!p-8">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-primary-600" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Legislative Timeline</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Stage History</h2>
        </div>

        <div className="relative pl-2 md:pl-4">
          <div className="absolute left-0 top-2 bottom-2 w-px bg-gradient-to-b from-primary-300 via-accent-300 to-warm-300" />
          <div className="space-y-5">
            {timelineHistory.map((sh, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="relative flex items-start gap-4 md:gap-5"
              >
                <div className="flex-shrink-0 relative z-10 w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-md shadow-primary-500/30">
                  <span className="text-[11px] md:text-xs font-black">{i + 1}</span>
                </div>
                <div className="flex-1 bg-gradient-to-br from-white to-surface-50 rounded-2xl p-4 md:p-5 border border-surface-200/80 shadow-soft">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-mono text-xs font-bold text-surface-500 bg-surface-100 px-2.5 py-1 rounded-md border border-surface-200 w-28 text-center">{sh.date}</span>
                    <span className="font-black text-surface-900 text-[15px]">{sh.stage}</span>
                    {sh.isLatestStage && <span className="rounded-full bg-primary-50 border border-primary-200 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-primary-700">Latest stage</span>}
                  </div>
                  <span className="text-sm text-surface-600 leading-relaxed font-medium">— {sh.note}</span>
                  {sh.isLatestStage && sh.sourceUrl && <a href={sh.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-primary-700 hover:text-primary-900 underline underline-offset-2">Open official National Assembly tracker</a>}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Card>

      {/* Documents */}
      <div id="documents">
      <Card className="!p-7 md:!p-8">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-primary-600" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Documentation</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Documents</h2>
          <p className="mt-2 text-sm text-surface-500">Official bill documents and the Parliament legislation tracker are listed separately when available.</p>
        </div>
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
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-100 to-accent-100 border border-primary-200/60 flex items-center justify-center text-primary-700 flex-shrink-0 group-hover:scale-110 transition-transform">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-surface-900 truncate">{doc.name}</p>
                  <p className="text-xs text-surface-500 font-medium">{isBillText ? 'Official bill document from Parliament' : /official bills tracker/i.test(doc.name) ? 'Official Parliament source for the current bill stage' : /tracker/i.test(doc.name) ? 'Parliament legislative proposals tracker' : documentUrl ? 'Open source document' : 'Download readable bill record'}</p>
                </div>
                {documentUrl ? <ArrowRight className="h-4 w-4 text-surface-400 group-hover:text-primary-600 group-hover:-rotate-45 transition-all flex-shrink-0" /> : <Download className="h-4 w-4 text-surface-400 group-hover:text-primary-600 transition-all flex-shrink-0" />}
              </>
            );
            return documentUrl ? (
              <a key={i} href={documentUrl} target="_blank" rel="noreferrer" download={doc.name} className="flex items-center gap-4 p-4 rounded-2xl bg-surface-50/70 border border-surface-200/60 hover:bg-white hover:border-primary-100 hover:shadow-soft transition-all group">
                {content}
              </a>
            ) : (
              <button key={i} type="button" onClick={() => downloadReadableBillDocument(bill, doc.name)} className="w-full text-left flex items-center gap-4 p-4 rounded-2xl bg-surface-50/70 border border-surface-200/60 hover:bg-white hover:border-primary-100 hover:shadow-soft transition-all group">
                {content}
              </button>
            );
          })}
        </div>
      </Card>
      </div>

      {/* Notices */}
      {billNotices.length > 0 && (
        <Card className="!p-7 md:!p-8">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-primary-600" />
              <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Public Engagement</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Public Participation Notices</h2>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Notice Date</th>
                  <th>Window</th>
                  <th>Length</th>
                  <th>Mode</th>
                  <th>Bill Text</th>
                </tr>
              </thead>
              <tbody>
                {billNotices.map(notice => (
                  <tr key={notice.id}>
                    <td className="font-bold text-surface-800">{notice.notice_date}</td>
                    <td className="font-mono text-xs">{notice.window_start} → {notice.window_end}</td>
                    <td>
                      <Badge variant={getWindowLength(notice) >= 14 ? 'accent' : 'warm'}>
                        {getWindowLength(notice)} days
                      </Badge>
                    </td>
                    <td className="font-semibold text-surface-700">{notice.mode}</td>
                    <td>
                      {notice.bill_text_accessible ? (
                        <Badge variant="green" showIcon>Accessible</Badge>
                      ) : (
                        <Badge variant="red" showIcon>Not provided</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Reports */}
      {billReports.length > 0 && (
        <Card className="!p-7 md:!p-8">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 mb-2">
              <FileCheck className="h-4 w-4 text-primary-600" />
              <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Committee Outputs</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Committee Reports</h2>
          </div>
          <div className="space-y-4">
            {billReports.map(report => (
              <a key={report.id} href={reportDocumentHref(report)} target="_blank" rel="noreferrer" aria-label={`Open committee report ${report.title || report.source_document_ref}`} className="block relative rounded-2xl p-5 border border-surface-200/80 bg-gradient-to-br from-white to-surface-50 shadow-soft hover:shadow-elevated hover:border-primary-200 transition-all">
                {(() => {
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
                    <>
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <span className="font-bold text-surface-900">{report.title || report.source_document_ref}</span>
                  <span className="inline-flex items-center gap-2"><Badge variant={report.source_verification_status === 'verified' ? 'green' : 'gray'}>{report.source_verification_status === 'verified' ? 'Official Parliament source · Verified' : 'Source not verified'}</Badge><FileText className="h-4 w-4 text-primary-600" /></span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-surface-500">
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Tabled: {report.date_tabled}</span>
                  <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {report.institution}</span>
                  <span>{extractionMessages[report.extraction_status] || 'Report text extraction status: ' + report.extraction_status}</span>
                  {report.ocr_used && <Badge variant="warm" className="!text-[10px]">OCR USED</Badge>}
                </div>
                    </>
                  );
                })()}
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* Final CTA */}
      <Card className="!p-0 overflow-hidden border-0 !rounded-3xl text-center">
        <div className="relative p-8 md:p-14 bg-gradient-to-br from-primary-600 via-primary-700 to-accent-600">
          <div className="absolute inset-0 opacity-15" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '28px 28px'
          }} />
          <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 rounded-full bg-accent-300/20 blur-3xl" />
          <div className="relative">
            <h2 className="text-2xl md:text-4xl font-black text-white tracking-tighter mb-4">
              Have a view on this bill?
            </h2>
            <p className="text-white/85 text-lg md:text-xl max-w-2xl mx-auto mb-8 font-medium leading-relaxed">
              Submit your perspective in under two minutes. Receive a tamper-evident receipt you can trace.
            </p>
            <Link to={`/submit?bill=${bill.id}`} className="btn-primary !bg-white !text-primary-700 hover:!text-primary-800 !shadow-2xl !px-8 !py-3.5 !text-base inline-flex">
              <ArrowRight className="h-4.5 w-4.5" /> Submit Your View on This Bill
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
