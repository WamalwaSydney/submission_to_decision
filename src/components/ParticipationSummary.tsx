import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { ChevronRight, Gavel, Landmark, Sparkles, Upload, X } from 'lucide-react';
import { ActStatus, api, FinalAct, FinalActItem, HouseDecision, HouseItem, HouseTrace, ParticipationSummary, ReceiptTrace, ReportDecision, ReportSubmissionItem } from '../api/endpoints';
import { Link } from 'react-router-dom';
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

const ACT_LABEL: Record<ActStatus, string> = { in_act: 'In the final Act', not_in_act: 'Not in the final Act', unclear: 'Could not confirm' };
const ACT_VARIANT: Record<ActStatus, BadgeVariant> = { in_act: 'green', not_in_act: 'red', unclear: 'gray' };

export function ActBadge({ status }: { status: ActStatus }) {
  return <Badge variant={ACT_VARIANT[status]} showIcon>{ACT_LABEL[status]}</Badge>;
}

const HOUSE_LABEL: Record<HouseDecision, string> = {
  agreed: 'Agreed by the House', unchanged: 'Passed unchanged', negatived: 'Rejected by the House',
  withdrawn: 'Withdrawn', not_found: 'No amendment found', unclear: 'Could not confirm',
};
const HOUSE_VARIANT: Record<HouseDecision, BadgeVariant> = { agreed: 'green', unchanged: 'gray', negatived: 'red', withdrawn: 'gray', not_found: 'gray', unclear: 'gray' };

export function HouseBadge({ item }: { item: HouseItem }) {
  // A clause passed unchanged is a win only when the stakeholder supported the bill's wording.
  if (item.decision === 'unchanged' && item.supported) return <Badge variant="green" showIcon>Passed as supported</Badge>;
  return <Badge variant={HOUSE_VARIANT[item.decision]} showIcon>{HOUSE_LABEL[item.decision]}</Badge>;
}

export const HOUSE_NOTE = 'Read from the Hansard of the Committee of the Whole House by Google Gemini. A decision is shown only when the platform finds it in the Hansard lines, on the right clause, and an independent check agrees the amendment carries out the recommendation.';

export const ACT_NOTE = 'Checked against the Act text by Google Gemini. "In the final Act" is shown only when the platform itself finds the quoted wording in the Act (allowing for scanning errors) and it was not already in the bill as published, or, for a deletion, finds the removed wording in the bill but not in the Act.';

const UNNAMED = 'Not named';
/** The report lists this proposal without saying who made it. */
const stakeholderLabel = (name: string) => (name === UNNAMED ? 'Not named in the report' : name);

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

function ItemDialog({ item, act, finalAct, house, houseTrace, submitters, receipts = [], onClose }: { item: ReportSubmissionItem | null; act?: FinalActItem; finalAct?: FinalAct | null; house?: HouseItem; houseTrace?: HouseTrace | null; submitters?: string[]; receipts?: string[]; onClose: () => void }) {
  const { state } = useApp();
  if (!item) return null;
  const report = state.reports.find(r => r.id === item.report_id);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="report-item-title">
      <DialogTitle id="report-item-title" sx={{ pr: 7 }}>
        <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#a52d29]">Submission in the committee report</span>
        <span className="block text-xl font-black text-[#182020] mt-1">{stakeholderLabel(item.stakeholder)}</span>
        <IconButton onClick={onClose} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><X size={20} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        <dl className="submission-detail-meta">
          <div><dt>Clause</dt><dd>{item.clause_ref || 'Whole bill'}</dd></div>
          <div><dt>Committee decision</dt><dd><DecisionBadge decision={item.decision} /></dd></div>
          {house && <div><dt>The House</dt><dd><HouseBadge item={house} /></dd></div>}
          {act && <div><dt>In the law</dt><dd><ActBadge status={act.status} /></dd></div>}
        </dl>
        {item.stakeholder === UNNAMED && (
          <p className="notice-box is-info !m-0">
            The committee's report lists this proposal without saying who made it{submitters?.length ? '. It says these stakeholders sent views: ' : '.'}
            {submitters?.length ? <strong>{submitters.join('; ')}</strong> : null}
          </p>
        )}
        {receipts.length > 0 && (
          <p className="notice-box is-info !m-0">
            A moderator confirmed that {receipts.length === 1 ? 'a view' : `${receipts.length} views`} sent on this platform {receipts.length === 1 ? 'matches' : 'match'} this submission, so {receipts.length === 1 ? 'it follows' : 'they follow'} the same path:{' '}
            {receipts.map((id, i) => <React.Fragment key={id}>{i ? ', ' : ''}<Link to={`/receipt-lookup?id=${id}`} className="font-mono font-bold underline">{id}</Link></React.Fragment>)}
          </p>
        )}
        <div><h3 className="text-sm font-black text-[#182020] mb-1">What they asked for</h3><p className="submission-detail-text">{item.issue || '—'}</p></div>
        <div><h3 className="text-sm font-black text-[#182020] mb-1">Committee's reason</h3><p className="submission-detail-text">{item.reason || 'The report gives no reason for this item.'}</p></div>
        {house && (
          <div className="act-evidence">
            <h3 className="text-sm font-black text-[#182020] mb-1">What the House decided{house.clause ? ` · ${house.clause}` : ''}</h3>
            {house.excerpt && <blockquote className="whitespace-pre-line">{house.excerpt.length > 900 ? `${house.excerpt.slice(0, 900)}…` : house.excerpt}<small>{house.sitting ? `Hansard, ${house.sitting.title}` : 'Hansard'}</small></blockquote>}
            <p className="submission-detail-text">{house.explanation}</p>
          </div>
        )}
        {act && (
          <div className="act-evidence">
            <h3 className="text-sm font-black text-[#182020] mb-1">What the final Act says{act.section ? ` · ${act.section}` : ''}</h3>
            {act.quote && <blockquote>“{act.act_span || act.quote}”{act.quote_verified && <small>{act.evidence === 'kept' ? `Unchanged from the bill, as the stakeholder supported · ${finalAct?.citation || 'the Act'}` : `Wording found in ${finalAct?.citation || 'the Act'}`}</small>}</blockquote>}
            {act.evidence === 'removed' && act.removed_wording && <blockquote>Removed: “{act.removed_wording}”<small>In the bill as published, not in {finalAct?.citation || 'the Act'}</small></blockquote>}
            <p className="submission-detail-text">{act.explanation}</p>
          </div>
        )}
        <p className="notice-box is-info !m-0"><Sparkles className="inline h-4 w-4 mr-1 -mt-0.5" aria-hidden="true" />{AI_NOTE}{house ? ` ${HOUSE_NOTE} ${houseTrace?.source || ''}` : ''}{act ? ` ${ACT_NOTE}` : ''}</p>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        {report && <a href={reportDocumentHref(report)} target="_blank" rel="noreferrer" className="action-button is-secondary">Open the report</a>}
        {house?.sitting && <a href={house.sitting.url} target="_blank" rel="noreferrer" className="action-button is-secondary">Read the Hansard</a>}
        {act && finalAct?.has_text && act.status === 'in_act' && report && <Link to={`/bills/${report.bill_ref}/act?q=${encodeURIComponent(act.key)}`} className="action-button is-secondary">See it in the Act</Link>}
        {act && !finalAct?.has_text && finalAct?.url && <a href={finalAct.url} target="_blank" rel="noreferrer" className="action-button is-secondary">Open the Act</a>}
        <button type="button" onClick={onClose} className="action-button is-primary">Close</button>
      </DialogActions>
    </Dialog>
  );
}

/** Paginated table of the submissions a committee report records; select one to read it. */
export function ReportSubmissionsTable({ items, finalAct, house, submitters, platformLinks }: { items: ReportSubmissionItem[]; finalAct?: FinalAct | null; house?: HouseTrace | null; submitters?: Record<string, string[]>; platformLinks?: Record<string, string[]> }) {
  const linksFor = (item: ReportSubmissionItem) => platformLinks?.[`${item.report_id}:${item.entry_id}`] || [];
  const houseByKey = useMemo(() => new Map((house?.items || []).map(h => [h.key, h])), [house]);
  const houseFor = (item: ReportSubmissionItem) => houseByKey.get(`${item.report_id}:${item.entry_id}`);
  const showHouse = houseByKey.size > 0;
  const [decision, setDecision] = useState<ReportDecision | 'all'>('all');
  const actByKey = useMemo(() => new Map((finalAct?.items || []).map(a => [a.key, a])), [finalAct]);
  const actFor = (item: ReportSubmissionItem) => actByKey.get(`${item.report_id}:${item.entry_id}`);
  const showAct = actByKey.size > 0;
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
          <thead><tr><th>Stakeholder</th><th>Clause</th><th>What they asked for</th><th>Committee</th>{showHouse && <th>The House</th>}{showAct && <th>In the final Act</th>}<th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {paged.rows.map(item => {
              const open = () => setSelected(item);
              return (
                <tr key={`${item.report_id}-${item.entry_id}`} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} aria-label={`Open submission by ${item.stakeholder}`}>
                  <td className={item.stakeholder === UNNAMED ? 'font-semibold text-[#687575] italic' : 'font-bold'}>
                    {stakeholderLabel(item.stakeholder)}
                    {linksFor(item).length > 0 && <span className="block mt-1"><Badge variant="blue">Also sent on this platform</Badge></span>}
                  </td>
                  <td className="whitespace-nowrap">{item.clause_ref || '—'}</td>
                  <td><div className="excerpt">{item.issue}</div></td>
                  <td><DecisionBadge decision={item.decision} /></td>
                  {showHouse && <td>{houseFor(item) ? <HouseBadge item={houseFor(item)!} /> : <span className="text-xs text-[#687575]">—</span>}</td>}
                  {showAct && <td>{actFor(item) ? <ActBadge status={actFor(item)!.status} /> : <span className="text-xs text-[#687575]">—</span>}</td>}
                  <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                </tr>
              );
            })}
            {!paged.rows.length && <tr><td colSpan={5 + (showAct ? 1 : 0) + (showHouse ? 1 : 0)} className="text-center text-sm text-[#687575] !py-8">No submissions match these filters.</td></tr>}
          </tbody>
        </table>
        <Pager page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} label="Committee report submissions pages" summary={paged.summary} />
      </div>
      <ItemDialog item={selected} act={selected ? actFor(selected) : undefined} finalAct={finalAct}
        house={selected ? houseFor(selected) : undefined} houseTrace={house} submitters={selected ? submitters?.[selected.report_id] : undefined}
        receipts={selected ? linksFor(selected) : []} onClose={() => setSelected(null)} />
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

  const uploadAct = async (file: File, actUrl?: string) => {
    if (!billId) return;
    setRunning(true); setError('');
    try { setSummary(await api.uploadFinalAct(billId, file, actUrl)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not upload the Act.'); }
    finally { setRunning(false); }
  };
  const checkAct = async () => {
    if (!billId) return;
    setRunning(true); setError('');
    try { setSummary(await api.checkFinalAct(billId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The check failed.'); }
    finally { setRunning(false); }
  };

  return { summary, loading, running, error, generate, uploadAct, checkAct, items: summary?.report_analysis?.items || [], finalAct: summary?.final_act || null, house: summary?.house || null };
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

/** Did the committee's adopted recommendations make it into the final Act? */
export function FinalActPanel({ data, assented }: { data: ParticipationSummaryState; assented: boolean }) {
  const { state } = useApp();
  const role = state.currentUser?.role;
  const isStaff = role === 'administrator' || role === 'reviewer' || role === 'committee_officer';
  const [file, setFile] = useState<File | null>(null);
  const act = data.finalAct;
  const recommended = data.items.filter(i => i.decision === 'adopted' || i.decision === 'amended').length;
  if (!assented) return null;
  const counts = act?.counts;
  return (
    <div className="grid gap-4 mt-6">
      <div className="inline-flex items-center gap-2">
        <Landmark className="h-4 w-4 text-[#a52d29]" aria-hidden="true" />
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29] m-0">Did it become law? · The final Act</h3>
      </div>
      {act?.title && (
        <p className="text-sm font-semibold text-[#3b4747] m-0">
          This bill became the <strong>{act.title}</strong>{act.citation ? ` (${act.citation})` : ''}.
          {act.url && <> <a href={act.url} target="_blank" rel="noreferrer" className="font-bold text-[#11521f] underline underline-offset-2">Kenya Law</a></>}
        </p>
      )}
      {act?.has_text && data.summary?.bill_id && (
        <div><Link to={`/bills/${data.summary.bill_id}/act`} className="action-button is-primary"><Landmark className="h-4 w-4" aria-hidden="true" /> Read the Act, with public submissions highlighted</Link></div>
      )}
      {counts && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile is-gold"><strong>{act!.checked}</strong><span>Recommendations the committee adopted</span></div>
            <div className="stat-tile is-green"><strong>{counts.in_act}</strong><span>In the final Act</span></div>
            <div className="stat-tile is-red"><strong>{counts.not_in_act}</strong><span>Not in the final Act</span></div>
            <div className="stat-tile is-black"><strong>{counts.unclear}</strong><span>Could not confirm</span></div>
          </div>
          <p className="text-xs font-semibold text-[#526060] m-0">{ACT_NOTE}{act!.checked_at ? ` Checked ${formatDate(act!.checked_at)} with ${act!.model}.` : ''} Select a submission below to see the section and the wording.</p>
        </>
      )}
      {!counts && (
        <p className="text-sm text-[#687575] m-0">
          {!act?.has_text
            ? (recommended ? `The committee adopted ${recommended} recommendation${recommended === 1 ? '' : 's'}. Once the Act's text is added, each one is checked against the law.` : 'Once the committee report has been read, its adopted recommendations are checked against the Act.')
            : 'The Act has been added but not checked yet.'}
        </p>
      )}
      {isStaff && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="action-button is-secondary cursor-pointer">
            <Upload className="h-4 w-4" aria-hidden="true" /> {file ? file.name : 'Choose the Act PDF'}
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>
          <button type="button" className="action-button is-primary" disabled={!file || data.running} onClick={() => file && data.uploadAct(file)}>
            {data.running ? 'Checking against the Act… this can take a minute' : 'Upload and check'}
          </button>
          {act?.has_text && <button type="button" className="action-button is-secondary" disabled={data.running} onClick={data.checkAct}>Check again</button>}
          <small className="text-xs text-[#687575] basis-full">Download the Act PDF from Kenya Law in your browser, then upload it here. Kenya Law does not allow automated downloads.</small>
        </div>
      )}
    </div>
  );
}

/** What the House decided, in the Committee of the Whole House, on the committee's adopted recommendations. */
export function HousePanel({ data, passed }: { data: ParticipationSummaryState; passed: boolean }) {
  const house = data.house;
  if (!passed || !house) return null;
  const c = house.counts;
  const supported = house.items.filter(i => i.decision === 'unchanged' && i.supported).length;
  return (
    <div className="grid gap-4 mt-6">
      <div className="inline-flex items-center gap-2">
        <Gavel className="h-4 w-4 text-[#a52d29]" aria-hidden="true" />
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29] m-0">What the House decided · Committee of the Whole House</h3>
      </div>
      {!house.found && <p className="text-sm text-[#687575] m-0">The Committee of the Whole House debate on this bill was not found in the Hansard yet.</p>}
      {house.found && c && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile is-green"><strong>{c.agreed + supported}</strong><span>Agreed by the House</span><small>{supported ? `${supported} passed unchanged, as supported` : 'amendments moved and agreed to'}</small></div>
            <div className="stat-tile is-red"><strong>{c.negatived}</strong><span>Rejected by the House</span></div>
            <div className="stat-tile is-black"><strong>{c.unchanged - supported + c.not_found + c.withdrawn}</strong><span>Change not made</span><small>clause passed unchanged, or no amendment moved</small></div>
            <div className="stat-tile is-black"><strong>{c.unclear}</strong><span>Could not confirm</span></div>
          </div>
          <p className="text-xs font-semibold text-[#526060] m-0">
            {HOUSE_NOTE} {house.source}{' '}
            {house.sittings.map((s, i) => <React.Fragment key={s.id}>{i ? ', ' : 'Sittings: '}<a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title}</a></React.Fragment>)}
          </p>
        </>
      )}
    </div>
  );
}

/** A receipt's journey: received, the committee's decision, the House's, and the final Act. */
export function ReceiptTraceTimeline({ trace, received }: { trace: ReceiptTrace; received: string }) {
  const steps: { title: string; badge?: React.ReactNode; body?: React.ReactNode; link?: React.ReactNode; done: boolean }[] = [
    { title: 'Received on this platform', body: `Recorded ${formatDate(received)} with a tamper-evident receipt.`, done: true },
    {
      title: 'The committee',
      badge: trace.committee ? <DecisionBadge decision={trace.committee.decision} /> : undefined,
      body: trace.committee ? <>{trace.committee.stakeholder !== UNNAMED && <>The report records it alongside <strong>{trace.committee.stakeholder}</strong>. </>}{trace.committee.reason}</> : 'A moderator confirmed the committee report responds to this view.',
      done: true,
    },
    {
      title: 'The House (Committee of the Whole House)',
      badge: trace.house ? <HouseBadge item={trace.house} /> : undefined,
      body: trace.house ? trace.house.explanation : 'The House has not considered this yet, or its debate is not on the platform.',
      link: trace.house?.sitting ? <a href={trace.house.sitting.url} target="_blank" rel="noreferrer" className="underline font-bold">Read the Hansard</a> : undefined,
      done: Boolean(trace.house),
    },
    {
      title: 'The law',
      badge: trace.act ? <ActBadge status={trace.act.status} /> : undefined,
      body: trace.act ? <>{trace.act.act_span && <span className="block italic mb-1">“{trace.act.act_span.length > 300 ? `${trace.act.act_span.slice(0, 300)}…` : trace.act.act_span}”</span>}{trace.act.explanation}</>
        : trace.final_act ? `The bill became the ${trace.final_act.title}${trace.final_act.citation ? ` (${trace.final_act.citation})` : ''}; this view has not been checked against it yet.` : 'Not law yet.',
      link: trace.act?.status === 'in_act' && trace.final_act?.has_text ? <Link to={`/bills/${trace.bill_id}/act?q=${encodeURIComponent(trace.key)}`} className="underline font-bold">See it in the Act</Link>
        : trace.final_act?.url ? <a href={trace.final_act.url} target="_blank" rel="noreferrer" className="underline font-bold">The Act on Kenya Law</a> : undefined,
      done: Boolean(trace.act),
    },
  ];
  return (
    <section className="rounded-2xl p-5 border border-[#cfe5d4] bg-[#f6fbf7]" aria-label="From your view to the law">
      <h3 className="text-sm font-black text-surface-900 mb-4">From this view to the law</h3>
      <ol className="trace-steps">
        {steps.map((step, i) => (
          <li key={step.title} className={step.done ? 'is-done' : ''}>
            <span className="trace-dot">{i + 1}</span>
            <div>
              <p className="trace-title">{step.title} {step.badge}</p>
              {step.body && <p className="trace-body">{step.body}</p>}
              {step.link && <p className="trace-body">{step.link}</p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs font-semibold text-[#526060] mt-3 mb-0">{AI_NOTE}{trace.house ? ` ${HOUSE_NOTE}` : ''}{trace.act ? ` ${ACT_NOTE}` : ''}</p>
    </section>
  );
}
