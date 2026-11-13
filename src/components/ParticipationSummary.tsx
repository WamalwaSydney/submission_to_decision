import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { api, ParticipationSummary, ReportDecision, ReportSubmissionItem } from '../api/endpoints';
import { useApp } from '../context/AppContext';
import { Badge, BadgeVariant, Pager, usePaged } from './UI';
import { formatDate } from './Participation';
import { reportDocumentHref } from '../utils/reportLinks';

export const DECISION_LABEL: Record<ReportDecision, string> = {
  adopted: 'Adopted',
  amended: 'Adopted with changes',
  rejected: 'Rejected',
  'not addressed': 'No response recorded',
};
const DECISION_VARIANT: Record<ReportDecision, BadgeVariant> = { adopted: 'green', amended: 'blue', rejected: 'red', 'not addressed': 'gray' };
const DECISIONS: ReportDecision[] = ['adopted', 'amended', 'rejected', 'not addressed'];
const PER_PAGE = 10;

export function DecisionBadge({ decision }: { decision: ReportDecision }) {
  return <Badge variant={DECISION_VARIANT[decision]} showIcon>{DECISION_LABEL[decision]}</Badge>;
}

export const AI_NOTE = 'Read from the committee report by Google Gemini. It is a guide to the report, not an official record: open the report to check any item.';

/** Counts of what the committee decided, as tiles. */
export function DecisionTiles({ total, decisions, platform }: { total: number; decisions: Record<ReportDecision, number>; platform?: number }) {
  return (
    <div className="stat-tiles">
      {platform !== undefined && <div className="stat-tile is-black"><strong>{platform}</strong><span>Views sent on this platform</span></div>}
      <div className="stat-tile is-gold"><strong>{total}</strong><span>Submissions in the committee report</span></div>
      <div className="stat-tile is-green"><strong>{decisions.adopted + decisions.amended}</strong><span>Adopted</span><small>{decisions.amended} of them with changes</small></div>
      <div className="stat-tile is-red"><strong>{decisions.rejected}</strong><span>Rejected</span></div>
      <div className="stat-tile is-black"><strong>{decisions['not addressed']}</strong><span>No response recorded</span></div>
    </div>
  );
}

function ItemDialog({ item, onClose }: { item: ReportSubmissionItem | null; onClose: () => void }) {
  const { state } = useApp();
  if (!item) return null;
  const report = state.reports.find(r => r.id === item.report_id);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="report-item-title">
      <DialogTitle id="report-item-title" sx={{ pr: 7 }}>
        <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#a52d29]">Submission in the committee report</span>
        <span className="block text-xl font-black text-[#182020] mt-1">{item.stakeholder}</span>
        <IconButton onClick={onClose} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><X size={20} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        <dl className="submission-detail-meta">
          <div><dt>Clause</dt><dd>{item.clause_ref || 'Whole bill'}</dd></div>
          <div><dt>Committee decision</dt><dd><DecisionBadge decision={item.decision} /></dd></div>
        </dl>
        <div><h3 className="text-sm font-black text-[#182020] mb-1">What they asked for</h3><p className="submission-detail-text">{item.issue || '—'}</p></div>
        <div><h3 className="text-sm font-black text-[#182020] mb-1">Committee's reason</h3><p className="submission-detail-text">{item.reason || 'The report gives no reason for this item.'}</p></div>
        <p className="notice-box is-info !m-0"><Sparkles className="inline h-4 w-4 mr-1 -mt-0.5" aria-hidden="true" />{AI_NOTE}</p>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        {report && <a href={reportDocumentHref(report)} target="_blank" rel="noreferrer" className="action-button is-secondary">Open the report</a>}
        <button type="button" onClick={onClose} className="action-button is-primary">Close</button>
      </DialogActions>
    </Dialog>
  );
}

/** Paginated table of the submissions a committee report records; select one to read it. */
export function ReportSubmissionsTable({ items }: { items: ReportSubmissionItem[] }) {
  const [decision, setDecision] = useState<ReportDecision | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReportSubmissionItem | null>(null);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => items
    .filter(i => decision === 'all' || i.decision === decision)
    .filter(i => !needle || `${i.stakeholder} ${i.issue} ${i.clause_ref || ''}`.toLowerCase().includes(needle)), [items, decision, needle]);
  const paged = usePaged(filtered, PER_PAGE, `${decision}|${needle}`);
  return (
    <>
      <div className="bill-filter-row !mb-3">
        <div className="bill-search">
          <label htmlFor="report-item-search" className="sr-only">Search submissions</label>
          <input id="report-item-search" type="search" className="input-field" placeholder="Search by stakeholder, issue or clause" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <label htmlFor="report-item-decision" className="sr-only">Decision</label>
        <select id="report-item-decision" className="input-field" value={decision} onChange={e => setDecision(e.target.value as ReportDecision | 'all')}>
          <option value="all">All decisions ({items.length})</option>
          {DECISIONS.map(d => <option key={d} value={d}>{DECISION_LABEL[d]} ({items.filter(i => i.decision === d).length})</option>)}
        </select>
      </div>
      <div className="submissions-table-wrap">
        <table className="submissions-table">
          <thead><tr><th>Stakeholder</th><th>Clause</th><th>What they asked for</th><th>Decision</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {paged.rows.map(item => {
              const open = () => setSelected(item);
              return (
                <tr key={`${item.report_id}-${item.entry_id}`} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} aria-label={`Open submission by ${item.stakeholder}`}>
                  <td className="font-bold">{item.stakeholder}</td>
                  <td className="whitespace-nowrap">{item.clause_ref || '—'}</td>
                  <td><div className="excerpt">{item.issue}</div></td>
                  <td><DecisionBadge decision={item.decision} /></td>
                  <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                </tr>
              );
            })}
            {!paged.rows.length && <tr><td colSpan={5} className="text-center text-sm text-[#687575] !py-8">No submissions match these filters.</td></tr>}
          </tbody>
        </table>
        <Pager page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} label="Committee report submissions pages" summary={paged.summary} />
      </div>
      <ItemDialog item={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** The bill's participation summary (platform counts and the AI reading of its committee report). */
export function useParticipationSummary(billId?: string) {
  const { state } = useApp();
  const [summary, setSummary] = useState<ParticipationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!billId) return;
    let cancelled = false;
    setLoading(true);
    api.participationSummary(billId).then(result => { if (!cancelled) setSummary(result); }).catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [billId, state.receipts.length]);

  const generate = async () => {
    if (!billId) return;
    setRunning(true); setError('');
    try { setSummary(await api.generateParticipationSummary(billId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The AI analysis failed.'); }
    finally { setRunning(false); }
  };

  return { summary, loading, running, error, generate, items: summary?.report_analysis?.items || [] };
}

export type ParticipationSummaryState = ReturnType<typeof useParticipationSummary>;

/** The AI's reading of the committee report: summary, decision tiles, and the staff re-run button. */
export function ReportAnalysisPanel({ data, hasReport }: { data: ParticipationSummaryState; hasReport: boolean }) {
  const { state } = useApp();
  const role = state.currentUser?.role;
  const isStaff = role === 'administrator' || role === 'reviewer' || role === 'moderator' || role === 'committee_officer';
  const { summary, loading, running, error, generate } = data;
  const analysis = summary?.report_analysis;
  return (
    <div className="grid gap-4 mt-6">
      <div className="inline-flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#a52d29]" aria-hidden="true" />
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29] m-0">What the committee report records · AI summary</h3>
      </div>
      {loading && <p className="text-sm text-[#687575] m-0" role="status">Loading…</p>}
      {!loading && analysis && (
        <>
          <DecisionTiles total={analysis.submissions_recorded} decisions={analysis.decisions} />
          {analysis.summary && <p className="text-base leading-relaxed text-[#182020] m-0">{analysis.summary}</p>}
          <p className="text-xs font-semibold text-[#526060] m-0">{AI_NOTE}{analysis.generated_at ? ` Analysed ${formatDate(analysis.generated_at)} with ${analysis.model}.` : ''}</p>
        </>
      )}
      {!loading && !analysis && (
        <p className="text-sm text-[#687575] m-0">{hasReport ? 'The committee report has not been analysed yet.' : 'The committee has not published its report on this bill yet. Once it does, this section shows who made submissions and what the committee adopted or rejected.'}</p>
      )}
      {isStaff && hasReport && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="action-button is-secondary" onClick={generate} disabled={running || summary?.ai_available === false}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> {running ? 'Reading the report… this can take a minute' : analysis ? 'Re-run the AI analysis' : 'Analyse the report with AI'}
          </button>
          {summary?.ai_available === false && <small className="text-xs text-[#687575]">AI is not configured on this server.</small>}
        </div>
      )}
      {error && <p role="alert" className="notice-box is-error m-0">{error}</p>}
    </div>
  );
}
