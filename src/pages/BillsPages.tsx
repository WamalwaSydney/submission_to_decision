import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getDaysOfNotice, getWindowLength } from '../data/seed';
import { SubmissionStatus } from '../types';
import {
  FileText, Clock, Building2, ArrowRight, ArrowLeft,
  FileCheck, Calendar, FileSearch, Gavel, Users, Download
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Card, Badge, InfoBox, DisclaimerBox, SectionHeader,
  Label, InputField, StatCard, StatusBadge
} from '../components/UI';

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
  const { state } = useApp();

  return (
    <div className="space-y-10">
      <div>
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Legislative Tracking</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
          Tracked <span className="gradient-text">Bills</span>
        </h1>
        <p className="text-lg text-surface-600 max-w-3xl leading-relaxed">
          Browse legislation being tracked by the platform. Follow submissions, committee reports, and published outcomes.
          All demo bills are clearly marked as simulated.
        </p>
      </div>

      <InfoBox className="!p-5 !max-w-5xl">
        <div className="pl-3 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-700 flex-shrink-0">
            <Gavel className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold leading-relaxed">
            <strong className="font-black">Note:</strong> Legislative tracking is national and unbounded.
            However, citizen activity (submissions, receipts) is confined to the pilot counties: Nairobi and Trans Nzoia.
          </p>
        </div>
      </InfoBox>

      {/* Search/filter bar */}
      <Card className="!p-5 md:!p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Label>Search bills</Label>
            <InputField placeholder="Search by title, ID, or institution..." />
          </div>
          <div className="w-full md:w-56">
            <Label>Institution</Label>
            <select className="input-field">
              <option>All institutions</option>
              <option>National Assembly</option>
              <option>Nairobi County Assembly</option>
              <option>Trans Nzoia County Assembly</option>
            </select>
          </div>
          <div className="w-full md:w-56">
            <Label>Stage</Label>
            <select className="input-field">
              <option>All stages</option>
              <option>First Reading</option>
              <option>Second Reading</option>
              <option>Committee Stage</option>
              <option>Report Stage</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {state.bills.map((bill, idx) => {
          const billReceipts = state.receipts.filter(r => r.legislative_item_id === bill.id);
          const billNotices = state.notices.filter(n => n.bill_ref === bill.id);
          const outcomes = (() => {
            const counts: Record<string, number> = {};
            billReceipts.forEach(r => {
              const s = state.receipts.find(rr => rr.id === r.id);
              if (s) {
                const status = state.matches.find(m => m.receipt_ref === r.id && m.reviewer_decision === 'confirmed')
                  ? state.reportEntries.find(e => e.id === state.matches.find(m => m.receipt_ref === r.id && m.reviewer_decision === 'confirmed')!.report_entry_ref)?.treatment
                  : 'awaiting committee report';
                counts[status || 'awaiting committee report'] = (counts[status || 'awaiting committee report'] || 0) + 1;
              }
            });
            return counts;
          })();
          const topOutcome = Object.entries(outcomes).sort((a, b) => b[1] - a[1])[0];

          return (
            <motion.div
              key={bill.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, delay: idx * 0.04 }}
            >
              <Link to={`/bills/${bill.id}`} className="card block !p-6 md:!p-7 group relative overflow-hidden">
                {/* Hover gradient */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                     style={{ background: 'radial-gradient(ellipse at top right, rgb(58 92 255 / 0.06), transparent 55%)' }} />

                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h2 className="text-xl md:text-[22px] font-black text-surface-900 tracking-tight leading-snug">
                        {bill.title}
                      </h2>
                      {bill.is_simulated && <Badge variant="gray" className="!text-[10px]">SIMULATED</Badge>}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm mb-5">
                      <span className="flex items-center gap-1.5 font-semibold text-surface-600">
                        <Building2 className="h-4 w-4 text-primary-500" />
                        {bill.institution}
                      </span>
                      <span className="flex items-center gap-1.5 font-semibold text-surface-600">
                        <Clock className="h-4 w-4 text-warm-500" />
                        {bill.stage}
                      </span>
                      <span className="font-mono text-xs font-bold text-surface-500 bg-surface-100 px-2 py-0.5 rounded-md border border-surface-200">
                        {bill.identifier}
                      </span>
                    </div>

                    {/* Stats mini row */}
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-50/80 border border-primary-100 text-primary-700 text-xs font-bold">
                        <Users className="h-3.5 w-3.5" />
                        {billReceipts.length} submission{billReceipts.length !== 1 ? 's' : ''}
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-50/80 border border-accent-100 text-accent-700 text-xs font-bold">
                        <Calendar className="h-3.5 w-3.5" />
                        {billNotices.length} notice{billNotices.length !== 1 ? 's' : ''}
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warm-50/80 border border-warm-200 text-warm-700 text-xs font-bold">
                        <FileText className="h-3.5 w-3.5" />
                        {(bill.documents || []).length} document{(bill.documents || []).length !== 1 ? 's' : ''}
                      </div>
                      {topOutcome && (
                        <div className="ml-auto">
                          <SubmissionStatusBadge status={topOutcome[0] as SubmissionStatus} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 self-center">
                    <div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl border border-surface-200 flex items-center justify-center text-surface-400 group-hover:bg-gradient-to-br group-hover:from-primary-600 group-hover:to-accent-500 group-hover:border-transparent group-hover:text-white group-hover:shadow-lg group-hover:shadow-primary-500/30 transition-all duration-300 group-hover:-rotate-12">
                      <ArrowRight className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function BillPage() {
  const { id } = useParams<{ id: string }>();
  const { state, getSubmissionStatus, getBillOutcomes } = useApp();
  const bill = state.bills.find(b => b.id === id);

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
  const outcomes = getBillOutcomes(bill.id);

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
          {bill.is_simulated && <Badge variant="gray" className="self-start !text-[10px] mt-1">SIMULATED</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-mono font-bold text-surface-600 bg-surface-100 px-3 py-1 rounded-lg border border-surface-200">{bill.identifier}</span>
          <span className="flex items-center gap-1.5 font-semibold text-surface-700">
            <Building2 className="h-4 w-4 text-primary-500" /> {bill.institution}
          </span>
          <Badge variant="yellow"><Clock className="h-3 w-3" /> {bill.stage}</Badge>
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
              const match = state.matches.find(m => m.receipt_ref === receipt.id && m.reviewer_decision === 'confirmed');
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
                    <SubmissionStatusBadge status={status as SubmissionStatus} />
                  </div>
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
                  {entry?.stated_reason && (
                    <div className="mt-4 text-xs bg-warm-50 p-4 rounded-xl border border-warm-200 text-warm-800 leading-relaxed">
                      <strong className="font-black">Committee reason:</strong> {entry.stated_reason}
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
            {bill.status_history.map((sh, i) => (
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
                  </div>
                  <span className="text-sm text-surface-600 leading-relaxed font-medium">— {sh.note}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </Card>

      {/* Documents */}
      <Card className="!p-7 md:!p-8">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-primary-600" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Documentation</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Documents</h2>
        </div>
        <div className="space-y-3">
          {(bill.documents || []).map((doc, i) => {
            const documentUrl = doc.url && doc.url !== '#' ? doc.url : undefined;
            const content = (
              <>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-100 to-accent-100 border border-primary-200/60 flex items-center justify-center text-primary-700 flex-shrink-0 group-hover:scale-110 transition-transform">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-surface-900 truncate">{doc.name}</p>
                  <p className="text-xs text-surface-500 font-medium">{documentUrl ? 'Open source document' : 'Download readable bill record'}</p>
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
              <div key={report.id} className="relative rounded-2xl p-5 border border-surface-200/80 bg-gradient-to-br from-white to-surface-50 shadow-soft hover:shadow-elevated transition-all">
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <span className="font-bold text-surface-900">{report.source_document_ref}</span>
                  <Badge variant="blue">{report.extraction_status}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-surface-500">
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Tabled: {report.date_tabled}</span>
                  <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {report.institution}</span>
                  {report.ocr_used && <Badge variant="warm" className="!text-[10px]">OCR USED</Badge>}
                  {report.is_simulated && <Badge variant="gray" className="!text-[10px]">SIMULATED</Badge>}
                </div>
              </div>
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
