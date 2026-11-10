import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Upload, FileUp, FileText, CheckCircle2, AlertTriangle, ChevronDown, Plus, Database, FileCheck2, X, Pencil, Search, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, InfoBox, Badge, Label, InputField, SelectField, Pager, usePaged } from '../components/UI';
import { formatDate } from '../components/Participation';
import type { CommitteeReport } from '../types';

const MAX_UPLOAD_MB = 50;

/** Clerk's Office accounts manage only their own committee's bills; administrators manage all. */
function mayManage(user: { role: string; committee_id?: string } | null, bill: { committee_id?: string }) {
  if (!user) return false;
  if (user.role !== 'committee_officer') return true;
  return Boolean(user.committee_id && bill.committee_id === user.committee_id);
}

const REPORTS_PER_PAGE = 10;
const ENTRIES_PER_PAGE = 10;
type ReportFilter = 'all' | 'to_check' | 'verified' | 'pending';
const REPORT_FILTERS: { id: ReportFilter; label: string; note: string }[] = [
  { id: 'all', label: 'All', note: 'Every report for your committee' },
  { id: 'to_check', label: 'To check', note: 'Extracted but not yet verified by the Clerk’s Office' },
  { id: 'verified', label: 'Verified', note: 'Checked and marked verified' },
  { id: 'pending', label: 'Not yet read', note: 'Waiting for text extraction' },
];
const EXTRACTION_LABELS: Record<string, string> = {
  pending: 'Not yet read',
  extracting: 'Reading',
  needs_review: 'Needs review',
  extracted: 'Extracted',
  ocr_used: 'Extracted (OCR)',
  verified: 'Verified',
};
const reportGroup = (status: string): Exclude<ReportFilter, 'all'> =>
  status === 'verified' ? 'verified' : status === 'pending' || status === 'extracting' ? 'pending' : 'to_check';
const reportName = (report: CommitteeReport) => report.title || report.source_document_ref || 'Committee report';
const treatmentVariant = (treatment: string) =>
  treatment === 'adopted' ? 'green' : treatment === 'amended' ? 'blue' : treatment === 'rejected with reasons' ? 'red' : 'gray';

/** Reports read for this committee: a filterable, paginated table; a row opens the report and its entries. */
function IngestedReports() {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'bill'>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [actionError, setActionError] = useState('');

  const billsById = useMemo(() => new Map(state.bills.map(b => [b.id, b])), [state.bills]);
  const entryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    state.reportEntries.forEach(e => counts.set(e.report_ref, (counts.get(e.report_ref) || 0) + 1));
    return counts;
  }, [state.reportEntries]);

  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.reports.filter(r => !needle || `${reportName(r)} ${billsById.get(r.bill_ref)?.title || ''} ${billsById.get(r.bill_ref)?.identifier || ''} ${r.institution}`.toLowerCase().includes(needle));
  }, [state.reports, billsById, query]);

  const counts: Record<ReportFilter, number> = {
    all: base.length,
    to_check: base.filter(r => reportGroup(r.extraction_status) === 'to_check').length,
    verified: base.filter(r => reportGroup(r.extraction_status) === 'verified').length,
    pending: base.filter(r => reportGroup(r.extraction_status) === 'pending').length,
  };

  const reports = useMemo(() => {
    const title = (r: CommitteeReport) => billsById.get(r.bill_ref)?.title || '';
    const sorters = {
      newest: (a: CommitteeReport, b: CommitteeReport) => (b.date_tabled || '').localeCompare(a.date_tabled || ''),
      oldest: (a: CommitteeReport, b: CommitteeReport) => (a.date_tabled || '').localeCompare(b.date_tabled || ''),
      bill: (a: CommitteeReport, b: CommitteeReport) => title(a).localeCompare(title(b)),
    };
    return base.filter(r => filter === 'all' || reportGroup(r.extraction_status) === filter).sort(sorters[sortBy]);
  }, [base, filter, sortBy, billsById]);

  const paged = usePaged(reports, REPORTS_PER_PAGE, `${filter}|${query}|${sortBy}`);
  const selected = state.reports.find(r => r.id === selectedId) || null;
  const selectedBill = selected ? billsById.get(selected.bill_ref) : undefined;
  const selectedEntries = useMemo(() => (selected ? state.reportEntries.filter(e => e.report_ref === selected.id) : []), [selected, state.reportEntries]);
  const entryPages = usePaged(selectedEntries, ENTRIES_PER_PAGE, selectedId);

  const markVerified = async (report: CommitteeReport) => {
    setVerifying(true);
    setActionError('');
    try {
      await api.verifyReport(report.id);
      dispatch({ type: 'UPDATE_REPORT_STATUS', payload: { reportId: report.id, status: 'verified' } });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not mark this report as verified.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card className="!p-7 md:!p-8 mb-8">
      <div className="inline-flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md" style={{ background: 'linear-gradient(135deg, #176B2B 0%, #A52D29 100%)', boxShadow: '0 6px 14px rgba(23,107,43,.22)' }}>
          <Database size={22} strokeWidth={2.25} aria-hidden="true" />
        </div>
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-accent-600 mb-1">Pipeline</div>
          <h2 className="text-2xl font-black text-surface-900 tracking-tight">Ingested Reports ({state.reports.length})</h2>
        </div>
      </div>

      {state.reports.length === 0 ? (
        <div className="committee-dashboard-empty">
          <FileText size={24} aria-hidden="true" />
          <strong>No reports yet</strong>
          <span>Reports you upload above, or that the Parliament sync links to your bills, appear here.</span>
        </div>
      ) : (
        <>
          <section className="bill-filters mb-4" aria-label="Filter reports">
            <div className="bill-filter-chips" role="tablist" aria-label="Report status">
              {REPORT_FILTERS.map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`bill-chip ${filter === item.id ? 'is-active' : ''}`} onClick={() => setFilter(item.id)} title={item.note}>
                  {item.label} <span>{counts[item.id]}</span>
                </button>
              ))}
            </div>
            <div className="bill-filter-row case-filter-row">
              <div className="bill-search">
                <label htmlFor="report-search" className="sr-only">Search reports</label>
                <Search className="h-5 w-5" aria-hidden="true" />
                <input id="report-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search report or bill" className="input-field" />
              </div>
              <label className="sr-only" htmlFor="report-sort">Sort</label>
              <select id="report-sort" className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                <option value="newest">Newest tabled first</option>
                <option value="oldest">Oldest tabled first</option>
                <option value="bill">Bill title A–Z</option>
              </select>
            </div>
          </section>

          <p className="text-sm font-semibold text-surface-600 mb-3" role="status">
            {reports.length ? `${paged.summary} ${reports.length === 1 ? 'report' : 'reports'}` : 'No reports'}
            {reports.length !== state.reports.length ? ` (filtered from ${state.reports.length})` : ''}
          </p>

          {reports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-surface-300 p-8 text-center text-sm text-surface-600">No reports match these filters.</div>
          ) : (
            <div className="submissions-table-wrap">
              <table className="submissions-table">
                <thead>
                  <tr><th>Report</th><th>Bill</th><th>Tabled</th><th>Status</th><th>Entries</th><th><span className="sr-only">Open</span></th></tr>
                </thead>
                <tbody>
                  {paged.rows.map(report => {
                    const bill = billsById.get(report.bill_ref);
                    const open = () => { setSelectedId(report.id); setActionError(''); };
                    return (
                      <tr key={report.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} aria-label={`Open report ${reportName(report)}`}>
                        <td>
                          <div className="excerpt !max-w-[220px] font-semibold">{reportName(report)}</div>
                          <div className="text-xs text-surface-500">{report.source_verification_status === 'verified' ? 'Official Parliament source' : 'Uploaded file'}{report.ocr_used ? ' · OCR' : ''}</div>
                        </td>
                        <td>
                          <div className="excerpt !max-w-[220px]">{bill?.title || 'Bill not listed'}</div>
                          <div className="text-xs text-surface-500 font-mono">{bill?.identifier}</div>
                        </td>
                        <td className="whitespace-nowrap">{formatDate(report.date_tabled)}</td>
                        <td><Badge variant={(report.extraction_status === 'verified' ? 'green' : reportGroup(report.extraction_status) === 'pending' ? 'gray' : 'yellow') as any}>{EXTRACTION_LABELS[report.extraction_status] || report.extraction_status}</Badge></td>
                        <td className="font-bold">{entryCounts.get(report.id) || 0}</td>
                        <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} label="Report pages" className="mt-4 !border !border-[#e2ded5] !rounded-2xl" />
        </>
      )}

      <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} fullWidth maxWidth="md" scroll="paper" aria-labelledby="report-dialog-title">
        {selected && (
          <>
            <DialogTitle id="report-dialog-title" sx={{ pr: 7, pb: 1 }}>
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#176b2b]">Committee report · {EXTRACTION_LABELS[selected.extraction_status] || selected.extraction_status}</span>
              <span className="block text-xl font-black text-[#182020] mt-1">{reportName(selected)}</span>
              <IconButton onClick={() => setSelectedId(null)} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><X size={20} /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'grid', gap: 2.5 }}>
              <dl className="submission-detail-meta">
                <div style={{ gridColumn: '1 / -1' }}><dt>Bill</dt><dd>{selectedBill ? <Link to={`/bills/${selectedBill.id}`} className="underline">{selectedBill.title}</Link> : 'Bill not listed'}</dd></div>
                <div><dt>Tabled</dt><dd>{formatDate(selected.date_tabled)}</dd></div>
                <div><dt>Legislature</dt><dd>{selected.institution}</dd></div>
                <div><dt>Source</dt><dd>{selected.source_verification_status === 'verified' ? 'Official Parliament source' : 'Uploaded file'}</dd></div>
                <div><dt>Text</dt><dd>{selected.ocr_used ? 'Read with OCR' : 'Native PDF text'}</dd></div>
              </dl>
              {selected.source_url && (
                <a href={selected.source_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-accent-700 underline">Open the official PDF</a>
              )}
              <div>
                <h3 className="text-sm font-black text-[#182020] mb-2">Entries the committee recorded ({selectedEntries.length})</h3>
                {selectedEntries.length === 0 ? (
                  <p className="notice-box is-closed !m-0">No entries yet. The report has not been read, or no clause-by-clause responses were found in it.</p>
                ) : (
                  <div className="grid gap-2.5">
                    {entryPages.rows.map(entry => (
                      <div key={entry.id} className="rounded-xl p-4 border border-surface-200 bg-surface-50">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs font-black uppercase tracking-[0.12em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded">{entry.clause_ref}</span>
                          <Badge variant={treatmentVariant(entry.treatment) as any} className="flex-shrink-0">{entry.treatment}</Badge>
                        </div>
                        <p className="text-sm text-surface-800 mt-2 mb-0 leading-relaxed">{entry.extracted_summary}</p>
                        {entry.stated_reason && <p className="text-xs text-surface-600 mt-2 pt-2 mb-0 border-t border-surface-200"><strong>Reason:</strong> {entry.stated_reason}</p>}
                      </div>
                    ))}
                    <Pager page={entryPages.page} pageCount={entryPages.pageCount} onChange={entryPages.setPage} label="Entry pages" summary={`${entryPages.summary} entries`} className="!border !border-[#e2ded5] !rounded-2xl" />
                  </div>
                )}
              </div>
              {actionError && <p role="alert" className="notice-box is-error !m-0">{actionError}</p>}
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
              {selected.extraction_status !== 'verified' && selectedEntries.length > 0 && (
                <button type="button" onClick={() => void markVerified(selected)} disabled={verifying} className="action-button is-primary mr-auto">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {verifying ? 'Saving…' : 'Mark entries verified'}
                </button>
              )}
              <button type="button" onClick={() => setSelectedId(null)} className="action-button is-secondary">Close</button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Card>
  );
}

export function CommitteeOfficerIngestionPage() {
  const { state, dispatch } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedBill, setSelectedBill] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [availableBills, setAvailableBills] = useState<typeof state.bills>([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [billsError, setBillsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBillsLoading(true);
    setBillsError(null);
    api.bills()
      .then(({ bills }) => {
        if (!cancelled) {
          const validBills = bills.filter(bill => Boolean(bill?.id && bill?.title));
          const ownBills = validBills.filter(bill => mayManage(state.currentUser, bill));
          setAvailableBills(ownBills);
          dispatch({ type: 'HYDRATE', payload: { bills: validBills } });
        }
      })
      .catch(error => {
        if (!cancelled) {
          setAvailableBills([]);
          setBillsError(error instanceof Error ? error.message : 'Unable to load bills from the live API.');
        }
      })
      .finally(() => {
        if (!cancelled) setBillsLoading(false);
      });
    return () => { cancelled = true; };
  }, [dispatch]);

  const openFilePicker = () => {
    if (!uploading) fileInputRef.current?.click();
  };

  const acceptFile = (file: File | null | undefined) => {
    setUploadError(null);
    setUploadSuccess(false);
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setUploadError('Please choose a PDF file.');
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`That file is too large. The limit is ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setSelectedFile(file);
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0]);
    // Reset so choosing the same file again still fires onChange.
    event.target.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (uploading) return;
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const handleUpload = async () => {
    if (!selectedBill || !selectedFile) return;
    const bill = availableBills.find(b => b.id === selectedBill);
    const institution = bill?.institution || 'National Assembly';
    const dateTabled = new Date().toISOString().split('T')[0];

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      const result = await api.uploadReport(selectedFile, selectedBill, institution, dateTabled, sourceUrl || undefined);
      dispatch({
        type: 'ADD_REPORT',
        payload: {
          id: String(result.report_id),
          bill_ref: selectedBill,
          institution,
          date_tabled: dateTabled,
          source_document_ref: selectedFile.name,
          extraction_status: result.extraction_status,
          ocr_used: result.ocr_used,
          is_simulated: false,
        },
      });
      for (const match of result.match_proposals || []) {
        dispatch({ type: 'ADD_MATCH', payload: match });
      }
      setSelectedFile(null);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 4000);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unable to upload the report.');
    } finally {
      setUploading(false);
    }
  };

  const disabledReason = !selectedBill
    ? 'Select a bill to continue.'
    : !selectedFile
      ? 'Choose a PDF to continue.'
      : null;

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Committee Records</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Report <span className="gradient-text">Ingestion</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Upload committee reports for extraction. The system will attempt native text extraction first, with OCR fallback for scanned documents.
      </p>

      <Card className="!p-7 md:!p-8 relative overflow-hidden mb-8">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/60 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md" style={{ background: 'linear-gradient(135deg, #A52D29 0%, #176B2B 100%)', boxShadow: '0 6px 14px rgba(165,45,41,.22)' }}>
              <Upload className="h-5.5 w-5.5" size={22} strokeWidth={2.25} aria-hidden="true" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Step One</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Upload Report</h2>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Associated Bill</Label>
              <select
                aria-label="Associated bill"
                value={selectedBill}
                onChange={(e) => setSelectedBill(e.target.value)}
                className="input-field"
                disabled={billsLoading || Boolean(billsError)}
                required
              >
                <option value="">{billsLoading ? 'Loading live bills...' : billsError ? 'Live bills unavailable' : 'Select a bill...'}</option>
                {availableBills.map(b => (
                  <option key={b.id} value={b.id}>{b.title} ({b.institution})</option>
                ))}
              </select>
              <p className="text-xs text-surface-500 mt-2">
                {billsLoading ? 'Loading bills from the live database…' : billsError ? billsError : `${availableBills.length} bill${availableBills.length === 1 ? '' : 's'} available from the live database.`}
              </p>
              {billsError && (
                <div role="alert" className="flex items-start gap-2 mt-2 text-xs text-red-700">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>Check the deployed API URL and Neon connection, then refresh this page.</span>
                </div>
              )}
            </div>

            <div>
              <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Official source URL (optional)</Label>
              <input
                aria-label="Official source URL"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://www.parliament.go.ke/..."
                className="input-field mb-5"
              />
              <p className="text-xs text-surface-500 mt-1 mb-4">Stored as provenance; the uploaded file is also retained with a SHA-256 checksum.</p>
            </div>

            <div>
              <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">PDF Document</Label>

              {/* Hidden native input, triggered by clicking/pressing the dropzone */}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileInputChange}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />

              <div
                role="button"
                tabIndex={0}
                aria-label="Choose a PDF report to upload"
                onClick={openFilePicker}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openFilePicker();
                  }
                }}
                onDragEnter={(e) => { e.preventDefault(); if (!uploading) setIsDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); if (!uploading) setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDrop={handleDrop}
                className={`border-2 border-dashed transition-all duration-300 rounded-2xl p-8 text-center cursor-pointer group bg-gradient-to-b from-surface-50/50 to-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  isDragging ? 'border-primary-500 bg-primary-50/60' : 'border-surface-200 hover:border-primary-300'
                } ${uploading ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg mb-4 group-hover:scale-105 transition-transform duration-300" style={{ background: 'linear-gradient(135deg, #A52D29 0%, #176B2B 100%)', boxShadow: '0 12px 24px rgba(165,45,41,.2)' }}>
                  <Upload className="h-8 w-8" size={32} strokeWidth={2.25} aria-hidden="true" />
                </div>

                {selectedFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="h-5 w-5 text-primary-600 flex-shrink-0" />
                    <p className="text-base font-semibold text-surface-800 truncate max-w-xs">{selectedFile.name}</p>
                    <span className="text-xs text-surface-500">({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                        setUploadError(null);
                      }}
                      disabled={uploading}
                      className="p-1 rounded-lg hover:bg-surface-100 text-surface-500"
                      aria-label="Remove selected file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-base font-semibold text-surface-800 mb-1">
                      {isDragging ? 'Drop the PDF here' : 'Click to choose a PDF, or drag it here'}
                    </p>
                    <p className="text-xs text-surface-500 mt-1">
                      Supports native text PDFs and scanned/image PDFs (OCR fallback). Max {MAX_UPLOAD_MB} MB.
                    </p>
                  </>
                )}
              </div>
            </div>

            {uploadError && (
              <div role="alert" className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <p className="text-sm font-medium">{uploadError}</p>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!selectedBill || !selectedFile || uploading}
                className="btn-primary inline-flex items-center justify-center gap-2 min-w-48"
              >
                {uploading ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <FileUp className="h-4 w-4 shrink-0" strokeWidth={2.5} /> Upload &amp; Extract
                  </>
                )}
              </button>
              {disabledReason && !uploading && (
                <p className="text-xs text-surface-500 mt-2">{disabledReason}</p>
              )}
            </div>

            {uploadSuccess && (
              <InfoBox className="!p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0 text-green-600" />
                  <div>
                        <p className="text-sm font-semibold text-surface-800">Report uploaded, extracted, and match proposals generated for reviewer review.</p>
                  </div>
                </div>
              </InfoBox>
            )}
          </div>
        </div>
      </Card>

      <IngestedReports />

      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 mt-0.5 flex-shrink-0 text-accent-600" />
          <div>
            <h3 className="font-bold text-surface-900 mb-1.5">Ingestion Pipeline</h3>
            <p className="text-sm text-surface-700 leading-relaxed">
              1. Upload PDF → 2. Try native text extraction (pdfplumber/PyMuPDF) → 3. If text layer is missing/insufficient, rasterize + Tesseract OCR → 
              4. Parse into structured entries (clause ref, summary, treatment, reason) → 5. The Clerk’s Office verifies completeness and formatting.
            </p>
          </div>
        </div>
      </InfoBox>
    </div>
  );
}

export function CommitteeOfficerNoticesPage() {
  const { state, dispatch } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editingNotice, setEditingNotice] = useState<typeof state.notices[number] | null>(null);
  const [availableBills, setAvailableBills] = useState<typeof state.bills>(() => state.bills.filter(bill => Boolean(bill?.id && bill?.title) && mayManage(state.currentUser, bill)));
  const [billSearch, setBillSearch] = useState('');
  const [billsLoading, setBillsLoading] = useState(true);
  const [billsError, setBillsError] = useState<string | null>(null);
  const [noticePage, setNoticePage] = useState(1);
  const [formData, setFormData] = useState({
    bill_ref: '', institution: '' as string, notice_date: '', window_start: '', window_end: '', mode: '', bill_text_accessible: false
  });
  const noticesPerPage = 10;
  const noticePageCount = Math.max(1, Math.ceil(state.notices.length / noticesPerPage));
  const visibleNotices = state.notices.slice((noticePage - 1) * noticesPerPage, noticePage * noticesPerPage);
  const noticeRangeStart = state.notices.length === 0 ? 0 : (noticePage - 1) * noticesPerPage + 1;
  const noticeRangeEnd = Math.min(noticePage * noticesPerPage, state.notices.length);

  useEffect(() => {
    let cancelled = false;
    setBillsLoading(true);
    setBillsError(null);
    Promise.allSettled([api.bills(), api.committees()])
      .then(([billsResult, committeesResult]) => {
        if (cancelled) return;
        if (billsResult.status === 'fulfilled') {
          const validBills = billsResult.value.bills.filter(bill => Boolean(bill?.id && bill?.title));
          setAvailableBills(validBills.filter(bill => mayManage(state.currentUser, bill)));
          dispatch({ type: 'HYDRATE', payload: { bills: validBills } });
          setBillsError(null);
        } else if (!availableBills.length) {
          setBillsError(billsResult.reason instanceof Error ? billsResult.reason.message : 'Unable to load bills.');
        }
        if (committeesResult.status === 'fulfilled') {
          dispatch({ type: 'HYDRATE', payload: { committees: committeesResult.value.committees } });
        }
      })
      .finally(() => { if (!cancelled) setBillsLoading(false); });
    return () => { cancelled = true; };
  }, [dispatch]);

  const selectedBill = availableBills.find(bill => bill.id === formData.bill_ref);

  const noticeInstitutions = Array.from(new Set([
    ...state.committees.map(committee => committee.institution),
    ...state.bills.map(bill => bill.institution),
    ...availableBills.map(bill => bill.institution),
    selectedBill?.institution,
    formData.institution,
  ].filter(Boolean))).sort();

  const billOptionLabel = (bill: typeof state.bills[number]) =>
    `${bill.title}${bill.identifier ? ` — ${bill.identifier}` : ''}`;

  const handleAdd = async () => {
    if (!formData.bill_ref || !formData.institution || !formData.notice_date) return;
    try {
      const payload = {
        ...formData,
        window_start: formData.window_start || formData.notice_date,
        window_end: formData.window_end || formData.notice_date,
      };
      const result = editingNotice
        ? await api.updateNotice(editingNotice.id, payload)
        : await api.createNotice(payload);
      dispatch({ type: editingNotice ? 'UPDATE_NOTICE' : 'ADD_NOTICE', payload: result.notice });
      if (!editingNotice) setNoticePage(Math.max(1, Math.ceil((state.notices.length + 1) / noticesPerPage)));
      setShowForm(false);
      setEditingNotice(null);
      setBillSearch('');
      setFormData({ bill_ref: '', institution: '', notice_date: '', window_start: '', window_end: '', mode: '', bill_text_accessible: false });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to create the notice.');
    }
  };

  const startEditing = (notice: typeof state.notices[number]) => {
    const bill = availableBills.find(item => item.id === notice.bill_ref);
    setEditingNotice(notice);
    setBillSearch(bill ? billOptionLabel(bill) : '');
    setFormData({
      bill_ref: notice.bill_ref,
      institution: notice.institution || bill?.institution || '',
      notice_date: notice.notice_date || '',
      window_start: notice.window_start || '',
      window_end: notice.window_end || '',
      mode: notice.mode || '',
      bill_text_accessible: Boolean(notice.bill_text_accessible),
    });
    setShowForm(true);
  };

  const cancelEditing = () => {
    setEditingNotice(null);
    setBillSearch('');
    setFormData({ bill_ref: '', institution: '', notice_date: '', window_start: '', window_end: '', mode: '', bill_text_accessible: false });
    setShowForm(false);
  };

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Public Notices</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Notice <span className="gradient-text">Records</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Manage public participation notice records for tracked bills.
      </p>

      <button
        type="button"
        onClick={() => setShowForm(!showForm)}
        className="btn-primary inline-flex items-center gap-2 mb-6"
      >
        <Plus className="h-4 w-4" /> Add Notice Record
      </button>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="!p-7 md:!p-8 relative overflow-hidden mb-8">
            <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-warm-100/60 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
            <div className="relative space-y-5">
              <div className="inline-flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-warm-500 to-primary-600 flex items-center justify-center text-white shadow-md shadow-warm-500/30">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-warm-600">New Entry</div>
                  <h2 className="text-xl font-black text-surface-900 tracking-tight">{editingNotice ? 'Edit Notice Record' : 'Add Notice Record'}</h2>
                </div>
              </div>

              <div>
                <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Bill</Label>
                <input
                  type="search"
                  list="notice-bill-options"
                  value={billSearch}
                  onChange={e => {
                    const value = e.target.value;
                    const bill = availableBills.find(item => billOptionLabel(item) === value);
                    setBillSearch(value);
                    setFormData({
                      ...formData,
                      bill_ref: bill?.id || '',
                      institution: bill?.institution || formData.institution,
                    });
                  }}
                  placeholder={billsLoading ? 'Loading bills...' : 'Type to search bills...'}
                  disabled={billsLoading || Boolean(billsError)}
                  className="input-field"
                  aria-label="Search and select a bill"
                  required
                />
                <datalist id="notice-bill-options">
                  {availableBills.map(b => <option key={b.id} value={billOptionLabel(b)}>{b.institution}</option>)}
                </datalist>
                {selectedBill && <p className="text-xs text-surface-500 mt-2">Selected: {selectedBill.title} ({selectedBill.institution})</p>}
                {billSearch && !selectedBill && <p className="text-xs text-warm-700 mt-2">Choose a bill from the suggestions to continue.</p>}
                {!billsLoading && !availableBills.length && <p className="text-xs font-semibold text-red-600 mt-2">{billsError || 'No live bills are available. Sync or ingest a bill before creating a notice.'}</p>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Notice Date</Label>
                  <InputField
                    type="date"
                    value={formData.notice_date}
                    onChange={e => setFormData({...formData, notice_date: e.target.value})}
                  />
                </div>
                <div>
                  <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Institution</Label>
                  <select
                    className="w-full rounded-xl border border-surface-300 bg-white px-4 py-3 text-sm font-semibold text-surface-800 shadow-sm outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:bg-surface-50"
                    value={formData.institution}
                    onChange={e => setFormData({...formData, institution: e.target.value})}
                    required
                    aria-label="Institution"
                  >
                    <option value="">Select...</option>
                    {noticeInstitutions.map(institution => <option key={institution} value={institution}>{institution}</option>)}
                  </select>
                  {!noticeInstitutions.length && (
                    <p className="mt-2 text-xs font-semibold text-red-600">
                      No platform institutions loaded. Select a live bill and refresh the page.
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Window Start</Label>
                  <InputField
                    type="date"
                    value={formData.window_start}
                    onChange={e => setFormData({...formData, window_start: e.target.value})}
                  />
                </div>
                <div>
                  <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Window End</Label>
                  <InputField
                    type="date"
                    value={formData.window_end}
                    onChange={e => setFormData({...formData, window_end: e.target.value})}
                  />
                </div>
              </div>
              <div>
                <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Mode</Label>
                <InputField
                  type="text"
                  value={formData.mode}
                  onChange={e => setFormData({...formData, mode: e.target.value})}
                  placeholder="e.g. Gazette notice, radio, baraza"
                />
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-surface-50 border border-surface-100">
                <input
                  type="checkbox"
                  id="bill-access"
                  checked={formData.bill_text_accessible}
                  onChange={e => setFormData({...formData, bill_text_accessible: e.target.checked})}
                  className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="bill-access" className="text-sm font-semibold text-surface-700 cursor-pointer">
                  Bill text was accessible alongside the notice
                </label>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                className="btn-primary inline-flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" /> {editingNotice ? 'Update Notice Record' : 'Save Notice Record'}
              </button>
              {editingNotice && <button type="button" onClick={cancelEditing} className="btn-secondary inline-flex items-center gap-2 ml-2">Cancel</button>}
            </div>
          </Card>
        </motion.div>
      )}

      <Card className="!p-0 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/40 blur-3xl pointer-events-none" />
        <div className="relative p-7 md:p-8 pb-0">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md" style={{ background: 'linear-gradient(135deg, #A52D29 0%, #176B2B 100%)', boxShadow: '0 6px 14px rgba(165,45,41,.22)' }}>
              <FileText className="h-5.5 w-5.5" size={22} strokeWidth={2.25} aria-hidden="true" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Registry</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Notice Records</h2>
              <p className="text-sm text-surface-500 mt-1">A clear record of participation notices and access windows.</p>
            </div>
            <span className="ml-auto inline-flex items-center rounded-full border border-[#e2ded5] bg-white px-3 py-1.5 text-xs font-bold text-[#526060]">
              {state.notices.length} {state.notices.length === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>
        <div className="committee-notice-table-wrap relative">
          <table className="committee-notice-table">
            <caption className="sr-only">Committee public notice records</caption>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Institution</th>
                <th>Notice Date</th>
                <th>Window</th>
                <th>Mode</th>
                <th>Bill Text</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.notices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="committee-notice-empty">
                    <FileText size={25} strokeWidth={1.8} aria-hidden="true" />
                    <strong>No notice records yet</strong>
                    <span>Add a notice record to see it listed here.</span>
                  </td>
                </tr>
              ) : visibleNotices.map(n => {
                const bill = state.bills.find(b => b.id === n.bill_ref);
                return (
                  <tr key={n.id}>
                    <td className="committee-notice-bill">{bill?.title || n.bill_ref}</td>
                    <td className="text-xs">
                      <Badge variant="accent" className="!text-[10px]">{n.institution}</Badge>
                    </td>
                    <td className="committee-notice-date">{n.notice_date || '—'}</td>
                    <td className="committee-notice-window">
                      <span>{n.window_start || n.notice_date || '—'}</span>
                      <span className="committee-notice-arrow" aria-hidden="true">→</span>
                      <span>{n.window_end || n.notice_date || '—'}</span>
                    </td>
                    <td className="committee-notice-mode">{n.mode || '—'}</td>
                    <td>
                      {n.bill_text_accessible ? (
                        <a href={`/bills/${n.bill_ref}#documents`} className="inline-flex items-center gap-1.5" title="Open the bill documents">
                          <Badge variant="green" showIcon className="!text-[10px]">Open bill text</Badge>
                        </a>
                      ) : (
                        <Badge variant="gray" className="!text-[10px]">No</Badge>
                      )}
                    </td>
                    <td>
                      {bill && mayManage(state.currentUser, bill) ? <button type="button" onClick={() => startEditing(n)} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-700 hover:text-primary-900" aria-label={`Edit notice for ${bill?.title || n.bill_ref}`}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button> : <span className="text-xs text-surface-500">Another committee</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {state.notices.length > noticesPerPage && (
          <div className="committee-notice-pagination">
            <p>Showing {noticeRangeStart}–{noticeRangeEnd} of {state.notices.length} records</p>
            <div className="committee-notice-page-controls" aria-label="Notice record pages">
              <button
                type="button"
                onClick={() => setNoticePage(page => Math.max(1, page - 1))}
                disabled={noticePage === 1}
                aria-label="Previous page"
              >
                Previous
              </button>
              {Array.from({ length: noticePageCount }, (_, index) => index + 1).map(page => (
                <button
                  type="button"
                  key={page}
                  onClick={() => setNoticePage(page)}
                  className={page === noticePage ? 'is-active' : ''}
                  aria-current={page === noticePage ? 'page' : undefined}
                  aria-label={`Page ${page}`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNoticePage(page => Math.min(noticePageCount, page + 1))}
                disabled={noticePage === noticePageCount}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
