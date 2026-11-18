import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card, Pager, StatusBadge, usePaged } from '../components/UI';
import { StagePill, formatBytes, formatDate } from '../components/Participation';
import { ReportSubmissionsTable, useParticipationSummary } from '../components/ParticipationSummary';
import type { ReportDecision, ReportSubmissionItem } from '../api/endpoints';
import { OUTCOME_STAGES, STAGE_META, STAGE_ORDER, normalizeStage, type SubmissionStage } from '../utils/submissionStage';
import { confidenceClasses, confidenceLabel } from '../utils/confidence';
import { reportDocumentHref } from '../utils/reportLinks';
import { ArrowLeft, ArrowUpRight, Building2, CheckCircle2, Eye, FileCheck2, FileText, FileUp, Gavel, Loader2, Search, UploadCloud, Users, X } from 'lucide-react';

export function CommitteeDashboardPage() {
  const { state } = useApp();
  const [bills, setBills] = useState<any[]>([]);
  const [billQuery, setBillQuery] = useState('');
  const [form, setForm] = useState({ title: '', identifier: '', stage: 'Introduced', source_url: '' });
  const [billFile, setBillFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const isCommittee = state.currentUser?.role === 'committee_officer';

  const load = () => { if (isCommittee) api.committeeBills().then(r => setBills(r.bills)).catch(e => setMessage(e instanceof Error ? e.message : 'Unable to load committee bills.')); };
  useEffect(load, [isCommittee]);

  const ingest = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setSaving(true);
    try { await api.ingestBill({ ...form, file: billFile }); setForm({ title: '', identifier: '', stage: 'Introduced', source_url: '' }); setBillFile(null); setMessage('Bill ingested and published to the public bill flow.'); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to ingest bill.'); }
    finally { setSaving(false); }
  };

  const chooseBillFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setMessage('Please choose a PDF bill document.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setMessage('The bill document must be 50 MB or smaller.');
      return;
    }
    setMessage('');
    setBillFile(file);
  };

  const billNeedle = billQuery.trim().toLowerCase();
  const filteredBills = bills.filter(bill => !billNeedle || `${bill.title} ${bill.identifier}`.toLowerCase().includes(billNeedle));
  const billPages = usePaged(filteredBills, 10, billQuery);

  if (!isCommittee) return <Card><h1 className="text-2xl font-black">Clerk’s Office area</h1><p className="mt-2">Sign in with a Clerk’s Office / Committee Secretariat account to ingest and manage bills.</p></Card>;
  return <div className="committee-dashboard space-y-7">
    <header className="committee-dashboard-hero">
      <div>
        <span className="committee-dashboard-kicker">Clerk’s Office workspace</span>
        <h1>Bill ingestion</h1>
        <p>Publish bills and official documents so citizens can follow legislation and its participation trail.</p>
      </div>
      <div className="committee-dashboard-hero-mark" aria-hidden="true"><Gavel size={30} strokeWidth={1.8} /></div>
    </header>

    <section className="committee-dashboard-stats" aria-label="Workspace overview">
      <div className="committee-dashboard-stat"><span className="committee-dashboard-stat-icon red"><FileText size={20} /></span><span><strong>{bills.length}</strong><small>Published bills</small></span></div>
      <div className="committee-dashboard-stat"><span className="committee-dashboard-stat-icon green"><FileCheck2 size={20} /></span><span><strong>{bills.filter(bill => Boolean(bill.pdf_url || bill.document_url)).length}</strong><small>With documents</small></span></div>
      <Link className="committee-dashboard-shortcut" to="/committee/ingestion"><span>Manage report ingestion</span><ArrowUpRight size={17} /></Link>
    </section>

    <section className="committee-dashboard-content">
    <Card className="committee-dashboard-form-card"><div className="committee-dashboard-section-heading"><div className="committee-dashboard-icon-tile"><FileUp size={22} strokeWidth={2.3} aria-hidden="true" /></div><div><p className="committee-dashboard-section-kicker">New publication</p><h2>Ingest a bill</h2><p>Required: title and unique identifier. Add the official PDF when available.</p></div></div><form onSubmit={ingest} className="grid gap-4 md:grid-cols-2">
      <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-surface-600">Bill title</span><input className="input-field mt-1" required placeholder="e.g. Nairobi County Finance Bill, 2026" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label><span className="text-xs font-black uppercase tracking-wide text-surface-600">Unique bill identifier</span><input className="input-field mt-1" required placeholder="e.g. NCA/2026/Bill-003" value={form.identifier} onChange={e => setForm({ ...form, identifier: e.target.value })} /></label>
      <label><span className="text-xs font-black uppercase tracking-wide text-surface-600">Current stage</span><select className="input-field mt-1" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}><option>Introduced</option><option>Public Participation</option><option>Committee Stage</option><option>Second Reading</option></select></label>
      <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-surface-600">Official source URL (optional)</span><input className="input-field mt-1" type="url" placeholder="https://www.parliament.go.ke/..." value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} /></label>
      <div className="md:col-span-2">
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { chooseBillFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInputRef.current?.click()} className="committee-dashboard-file-picker">
          <span className="committee-dashboard-file-icon"><UploadCloud size={25} strokeWidth={2.2} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">{billFile ? <><span className="block font-bold text-surface-900 truncate">{billFile.name}</span><span className="text-xs text-surface-500">{(billFile.size / (1024 * 1024)).toFixed(1)} MB · PDF selected</span></> : <><span className="block font-bold text-surface-900">Select official bill PDF</span><span className="text-xs text-surface-500">Browse your device · PDF up to 50 MB</span></>}</span>
          {billFile ? <span onClick={e => { e.stopPropagation(); setBillFile(null); }} className="p-2 rounded-lg hover:bg-white text-surface-500" aria-label="Remove bill PDF"><X size={17} /></span> : <FileText size={20} className="text-surface-400 shrink-0" />}
        </button>
      </div>
      <button className="btn-primary md:col-span-2 inline-flex items-center justify-center gap-2" type="submit" disabled={saving || !form.title.trim() || !form.identifier.trim()}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading bill...</> : <><FileUp size={17} /> Upload and publish bill</>}</button>
    </form>{message && <p role="status" className={`mt-4 text-sm font-semibold flex items-center gap-2 ${message.includes('ingested') ? 'text-green-700' : 'text-red-700'}`}>{message.includes('ingested') && <CheckCircle2 className="h-4 w-4" />}{message}</p>}</Card>

    <Card className="committee-dashboard-bills-card"><div className="committee-dashboard-bills-heading"><div><p className="committee-dashboard-section-kicker">Legislation</p><h2>Your bills</h2></div><span>{bills.length} total</span></div>{bills.length > 0 && <div className="bill-search mb-3"><label htmlFor="your-bills-search" className="sr-only">Search your bills</label><Search className="h-5 w-5" aria-hidden="true" /><input id="your-bills-search" type="search" className="input-field" placeholder="Search title or number" value={billQuery} onChange={e => setBillQuery(e.target.value)} /></div>}<div className="committee-dashboard-bills">{billPages.rows.map(bill => <article key={bill.id} className="committee-dashboard-bill-row"><span className="committee-dashboard-bill-mark"><Gavel size={18} /></span><div className="committee-dashboard-bill-info"><p>{bill.title}</p><span>{bill.identifier} <i>·</i> {bill.stage}</span></div><Link className="committee-dashboard-flow-link" to={`/bill-flow/${bill.id}`}>View public flow <ArrowUpRight size={15} /></Link></article>)}{!bills.length && <div className="committee-dashboard-empty"><FileText size={24} /><strong>No bills published yet</strong><span>Use the form to add the first bill to your public flow.</span></div>}{bills.length > 0 && !filteredBills.length && <p className="text-sm text-surface-500 text-center py-6 m-0">No bills match “{billQuery.trim()}”.</p>}</div><Pager page={billPages.page} pageCount={billPages.pageCount} onChange={billPages.setPage} label="Your bill pages" summary={billPages.summary} className="mt-3 !border !border-[#e2ded5] !rounded-2xl !px-4 !py-3" /></Card>
    </section>
  </div>;
}

/** A parsed report entry's treatment as a decision; passages the reader could not classify are not submissions. */
const ENTRY_DECISION: Record<string, ReportDecision> = { adopted: 'adopted', amended: 'amended', 'rejected with reasons': 'rejected', 'not addressed': 'not addressed' };
const DECISION_STAGE: Record<ReportDecision, SubmissionStage> = { adopted: 'adopted', amended: 'amended', rejected: 'rejected', 'not addressed': 'not_addressed' };

function reportName(report: any): string {
  return report.title || report.provenance?.original_filename || String(report.source_document_ref || 'Committee report').replace(/^[0-9a-f]{16}_/, '').replace(/_/g, ' ');
}

function FlowSection({ icon: Icon, kicker, title, description, aside, children }: { icon: React.ElementType; kicker: string; title: React.ReactNode; description?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="!p-5 md:!p-8" hover={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 mb-2">
            <Icon className="h-4 w-4 text-[#a52d29]" aria-hidden="true" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29]">{kicker}</span>
          </div>
          <h2 className="text-xl md:text-2xl font-black text-[#182020] tracking-tight m-0">{title}</h2>
          {description && <p className="mt-2 mb-0 text-sm text-[#596767] max-w-3xl">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function BillFlowPage() {
  const { state } = useApp();
  const { id: billId } = useParams();
  const [flow, setFlow] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const summary = useParticipationSummary(billId);
  useEffect(() => {
    if (!billId) return;
    setFlow(null); setFailed(false);
    api.billFlow(billId).then(setFlow).catch(() => setFailed(true));
  }, [billId]);
  const isStaff = Boolean(state.currentUser && state.currentUser.role !== 'citizen');

  if (failed) return <Card className="!p-8" hover={false}><h1 className="text-2xl font-black m-0">Bill not found</h1><p className="text-[#596767] mt-2">This bill may have been removed. <Link to={isStaff ? '/committee' : '/bills'} className="font-bold text-[#11521f] underline">Go back</Link></p></Card>;
  if (!flow) return <Card className="!p-8" hover={false}><p className="m-0 flex items-center gap-2 text-[#596767]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the bill flow…</p></Card>;

  const bill = flow.bill;
  const committee = state.committees.find(c => c.id === bill.committee_id);
  const submissions: any[] = flow.submissions || [];
  const reports: any[] = flow.reports || [];
  const reportTitles = new Map(reports.map(r => [r.id, reportName(r)]));
  // Submissions the committee report records: the AI reading of the report when there is one, otherwise the entries
  // the text reader classified. Passages it could not classify are left out.
  const analysed: ReportSubmissionItem[] = summary.items;
  const parsed: ReportSubmissionItem[] = (flow.report_entries || [])
    .filter((e: any) => ENTRY_DECISION[e.treatment])
    .map((e: any) => ({ entry_id: e.id, clause_ref: e.clause_ref, stakeholder: 'Not stated', issue: e.extracted_summary || '', decision: ENTRY_DECISION[e.treatment], reason: e.stated_reason || '', report_id: e.report_ref, report_title: reportTitles.get(e.report_ref) || 'Committee report' }));
  const reportItems = analysed.length ? analysed : parsed;
  const unclassified = (flow.report_entries || []).length - parsed.length;

  // Every submission counts at each stage it has reached; report-recorded ones reached them all.
  const stages = submissions.map(s => normalizeStage(s.status));
  const stageCards = STAGE_ORDER.map(stage => {
    const isOutcome = OUTCOME_STAGES.includes(stage);
    const platform = isOutcome ? stages.filter(s => s === stage).length : stages.filter(s => STAGE_META[s].step >= STAGE_META[stage].step).length;
    const report = isOutcome ? reportItems.filter(i => DECISION_STAGE[i.decision] === stage).length : reportItems.length;
    return { stage, platform, report, count: platform + report, isOutcome };
  });
  const decided = stageCards.filter(c => c.isOutcome).reduce((sum, c) => sum + c.count, 0);
  const total = submissions.length + reportItems.length;
  const history: any[] = flow.flow || [];

  return (
    <div className="w-full min-w-0 space-y-6">
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Breadcrumb">
        <Link to={isStaff ? '/committee' : '/bills'} className="flex items-center gap-1.5 font-semibold text-[#11521f] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {isStaff ? 'Committee workspace' : 'Bills'}
        </Link>
        <span className="text-[#b9b4a8]">/</span>
        <span className="min-w-0 font-medium text-[#3b4747] line-clamp-1 max-w-xl">{bill.title}</span>
      </nav>

      <Card className="!p-5 md:!p-8" hover={false}>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29] m-0">Public bill flow</p>
        <h1 className="bill-title text-3xl md:text-4xl font-black tracking-tight text-[#182020] leading-tight mt-2 mb-0 break-words">
          {bill.title}
          <StagePill stage={bill.stage} />
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mt-4">
          <span className="font-mono font-bold text-[#3b4747] bg-[#f1eee7] px-3 py-1 rounded-lg border border-[#e2ded5]">{bill.identifier}</span>
          <span className="flex items-center gap-1.5 font-semibold text-[#3b4747]"><Building2 className="h-4 w-4 text-[#176b2b]" aria-hidden="true" /> {bill.institution}</span>
          {committee && <span className="flex items-center gap-1.5 font-semibold text-[#3b4747]"><Users className="h-4 w-4 text-[#a52d29]" aria-hidden="true" /> {committee.name}</span>}
        </div>
        {isStaff && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#e2ded5] bg-[#faf9f6] px-4 py-3">
            <Eye className="h-5 w-5 text-[#176b2b] shrink-0" aria-hidden="true" />
            <p className="m-0 flex-1 min-w-[220px] text-sm text-[#3b4747]">This is what the public sees for this bill: its stages, the committee's reports and what happened to every submission.</p>
            <Link to={`/bills/${bill.id}`} className="action-button is-secondary !min-h-[38px] !py-2 !px-4">Open the bill page <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
            <Link to="/committee/ingestion" className="action-button is-primary !min-h-[38px] !py-2 !px-4"><FileUp className="h-4 w-4" aria-hidden="true" /> Upload a report</Link>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {[
            { label: 'Submissions traced', value: total },
            { label: 'Sent on this platform', value: submissions.length },
            { label: 'Recorded in the report', value: reportItems.length },
            { label: 'With a decision', value: decided },
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-[#e7e3da] bg-white px-4 py-3">
              <strong className="block text-2xl font-black text-[#182020] leading-none">{item.value}</strong>
              <span className="text-xs font-semibold text-[#687575]">{item.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <FlowSection icon={FileCheck2} kicker="Submissions" title="From submission to decision"
        description="The first four count every submission that has reached that stage, whether it was sent on this platform or recorded in the committee's report. The outcomes show where each one ended.">
        {total ? (
          <div className="stage-counts" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {stageCards.map(c => (
              <div key={c.stage} className={`stage-count ${c.count ? '' : 'is-zero'}`}>
                <strong>{c.count}</strong>
                <StatusBadge status={c.stage} />
                {c.report > 0 && <small className="block text-[11px] font-semibold text-[#687575]">{c.platform} on this platform · {c.report} in the report</small>}
              </div>
            ))}
          </div>
        ) : <p className="m-0 text-sm text-[#596767]">No submissions have been traced on this bill yet. They appear here when citizens submit views on the platform or when the committee's report is read.</p>}
      </FlowSection>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <FlowSection icon={Gavel} kicker="Timeline" title="Legislative stages">
          {history.length ? (
            <ol className="relative m-0 list-none p-0">
              {history.map((item, i) => {
                const latest = i === history.length - 1;
                return (
                  <li key={i} className="relative pl-8 pb-5 last:pb-0">
                    {!latest && <span className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-[#e2ded5]" aria-hidden="true" />}
                    <span className={`absolute left-0 top-1 h-4 w-4 rounded-full border-[3px] ${latest ? 'border-[#a52d29] bg-white' : 'border-[#176b2b] bg-[#176b2b]'}`} aria-hidden="true" />
                    <p className="m-0 flex flex-wrap items-baseline gap-x-2 font-black text-[#182020]">{item.stage}{latest && <span className="text-[11px] font-bold uppercase tracking-wide text-[#a52d29]">Latest</span>}</p>
                    <p className="m-0 text-xs font-semibold text-[#687575]">{formatDate(item.date)}</p>
                    {item.note && <p className="mt-1 mb-0 text-sm text-[#3b4747] leading-relaxed">{item.note}</p>}
                  </li>
                );
              })}
            </ol>
          ) : <p className="m-0 text-sm text-[#596767]">No stages recorded yet.</p>}
        </FlowSection>

        <FlowSection icon={FileText} kicker="Documents" title="Committee reports" aside={<span className="text-sm font-bold text-[#687575]">{reports.length} report{reports.length === 1 ? '' : 's'}</span>}>
          {reports.length ? (
            <div className="space-y-3">
              {reports.map(r => {
                const href = reportDocumentHref(r);
                const read = r.extraction_status === 'extracted';
                return (
                  <article key={r.id} className="rounded-2xl border border-[#e7e3da] bg-[#faf9f6] p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white border border-[#e2ded5] text-[#a52d29]"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 font-bold text-[#182020] leading-snug break-words">{reportName(r)}</p>
                        <p className="m-0 mt-1 text-xs font-semibold text-[#687575]">{[r.committee_name, r.date_tabled && `Tabled ${formatDate(r.date_tabled)}`, formatBytes(r.source_size_bytes)].filter(Boolean).join(' · ')}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className={`stage-pill ${read ? 'is-open' : r.extraction_status === 'failed' ? 'is-ended' : 'is-progress'} !py-1 !text-xs`}>{read ? (r.ocr_used ? 'Text read (scanned, OCR)' : 'Text read') : r.extraction_status === 'failed' ? 'Could not be read' : 'Being read'}</span>
                          {r.source_verification_label && <span className={`stage-pill ${r.source_verification_status === 'verified' ? 'is-law' : 'is-ended'} !py-1 !text-xs !whitespace-normal`}>{r.source_verification_label}</span>}
                        </div>
                        {href && <a href={href} target="_blank" rel="noreferrer" className="action-button is-secondary !min-h-[36px] !py-1.5 !px-3 mt-3 sm:!hidden">Open the report <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>}
                      </div>
                      {href && <a href={href} target="_blank" rel="noreferrer" className="action-button is-secondary !min-h-[36px] !py-1.5 !px-3 shrink-0 !hidden sm:!inline-flex" aria-label={`Open ${reportName(r)}`}>Open <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p className="m-0 text-sm text-[#596767]">No committee report has been published for this bill yet.</p>}
        </FlowSection>
      </div>

      <FlowSection icon={Search} kicker="On this platform" title={<>Submissions sent on this platform <span className="text-[#94a09d]">({submissions.length})</span></>}
        description="Each receipt is public. Open one to see its hash and the committee's response.">
        {submissions.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {submissions.map(s => (
              <article key={s.public_id} className="rounded-2xl border border-[#e7e3da] bg-white p-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link to={`/receipt-lookup?id=${s.public_id}`} className="font-mono font-black text-[#11521f] hover:underline">{s.public_id}</Link>
                    <p className="m-0 text-xs font-semibold text-[#687575]">{s.clause_ref || 'General submission'}{s.timestamp ? ` · ${formatDate(s.timestamp)}` : ''}</p>
                  </div>
                  <StatusBadge status={normalizeStage(s.status)} />
                </div>
                {s.match_percentage !== null && <span className={`self-start rounded-full border px-2.5 py-1 text-xs font-black ${confidenceClasses(s.match_percentage / 100)}`}>{s.match_decision === 'confirmed' ? 'Matched' : 'Possible match'} · {confidenceLabel(s.match_percentage / 100)} confidence · {s.match_percentage}%</span>}
                {s.reason && <p className="m-0 text-sm text-[#3b4747] leading-relaxed"><span className="font-bold text-[#182020]">{s.match_decision === 'rejected' ? 'Moderator note: ' : "Committee's reason: "}</span>{s.reason}</p>}
              </article>
            ))}
          </div>
        ) : <p className="m-0 text-sm text-[#596767]">No one has submitted a view on this bill through the platform yet.</p>}
      </FlowSection>

      <FlowSection icon={FileCheck2} kicker="In the committee report" title={<>Submissions recorded in the committee report <span className="text-[#94a09d]">({reportItems.length})</span></>}
        description="Written memoranda and hearing submissions the committee lists in its report, with its decision and reason for each.">
        {reportItems.length
          ? <ReportSubmissionsTable items={reportItems} finalAct={summary.finalAct} house={summary.house} submitters={summary.summary?.report_analysis?.submitters} platformLinks={summary.summary?.platform_links} />
          : <p className="m-0 text-sm text-[#596767]">{reports.length
            ? `The report has been read${unclassified ? `, but none of the ${unclassified} passage${unclassified === 1 ? '' : 's'} found records a committee decision on a submission` : ''}. Submissions appear here once the report's matrix of submissions is analysed.`
            : 'Submissions recorded by the committee appear here once its report is published and read.'}</p>}
      </FlowSection>
    </div>
  );
}
