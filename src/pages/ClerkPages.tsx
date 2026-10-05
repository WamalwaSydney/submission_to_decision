import React, { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Upload, FileText, CheckCircle2, AlertTriangle, ChevronDown, Plus, Database, FileCheck2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, InfoBox, Badge, Label, InputField, SelectField } from '../components/UI';

const MAX_UPLOAD_MB = 50;

export function ClerkIngestionPage() {
  const { state, dispatch } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedBill, setSelectedBill] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);

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
    const bill = state.bills.find(b => b.id === selectedBill);
    const institution = bill?.institution || 'National Assembly';
    const dateTabled = new Date().toISOString().split('T')[0];

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      const result = await api.uploadReport(selectedFile, selectedBill, institution, dateTabled);
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
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-md shadow-primary-500/30">
              <Upload className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Step One</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Upload Report</h2>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Associated Bill</Label>
              <SelectField
                value={selectedBill}
                onChange={(e) => setSelectedBill(e.target.value)}
              >
                <option value="">Select a bill...</option>
                {state.bills.map(b => (
                  <option key={b.id} value={b.id}>{b.title} ({b.institution})</option>
                ))}
              </SelectField>
              {state.bills.length === 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  No bills are loaded yet. Run the legislation sync or refresh the page, then try again.
                </p>
              )}
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
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-lg shadow-primary-500/25 mb-4 group-hover:scale-105 transition-transform duration-300">
                  <Upload className="h-8 w-8" />
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
                className="btn-primary inline-flex items-center gap-2"
              >
                {uploading ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Upload &amp; Extract
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
                    <p className="text-sm font-semibold text-surface-800">Report uploaded. Extraction pending.</p>
                  </div>
                </div>
              </InfoBox>
            )}
          </div>
        </div>
      </Card>

      <Card className="!p-7 md:!p-8 relative overflow-hidden mb-8">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-warm-100/40 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-accent-500 to-primary-600 flex items-center justify-center text-white shadow-md shadow-accent-500/30">
              <Database className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-accent-600 mb-1">Pipeline</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Ingested Reports ({state.reports.length})</h2>
            </div>
          </div>

          <div className="space-y-4">
            {state.reports.map((report, i) => {
              const bill = state.bills.find(b => b.id === report.bill_ref);
              const entries = state.reportEntries.filter(e => e.report_ref === report.id);
              const isExpanded = expandedReport === report.id;

              const statusBadge =
                report.extraction_status === 'verified' ? 'green' :
                report.extraction_status === 'needs_review' ? 'yellow' :
                report.extraction_status === 'ocr_used' ? 'blue' :
                'gray';

              return (
                <motion.div
                  key={report.id}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.04 }}
                >
                  <Card className="!p-0 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-primary-400 to-accent-600" />
                    <div className="p-5 md:p-6">
                      <div
                        className="flex flex-wrap items-start justify-between gap-3 mb-3 cursor-pointer"
                        onClick={() => setExpandedReport(isExpanded ? null : report.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <FileCheck2 className="h-4 w-4 text-primary-600 flex-shrink-0" />
                            <p className="font-bold text-surface-900 truncate">{report.source_document_ref}</p>
                          </div>
                          <p className="text-sm text-surface-600 pl-6">{bill?.title || report.bill_ref}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant={statusBadge as any} showIcon>
                            {report.extraction_status}
                          </Badge>
                          <div className={`p-1.5 rounded-lg transition-transform ${isExpanded ? 'rotate-180 bg-surface-100' : 'bg-surface-50'}`}>
                            <ChevronDown className="h-4 w-4 text-surface-500" />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pl-6 text-xs font-medium text-surface-600 mb-4">
                        <span className="px-2.5 py-1 rounded-lg bg-surface-50 border border-surface-100">{report.institution}</span>
                        <span className="px-2.5 py-1 rounded-lg bg-surface-50 border border-surface-100">Tabled: {report.date_tabled}</span>
                        {report.ocr_used && <Badge variant="blue" className="!text-[10px]">OCR used</Badge>}
                        {report.is_simulated && <Badge variant="gray" className="!text-[10px]">SIMULATED</Badge>}
                        <span className="px-2.5 py-1 rounded-lg bg-primary-50 text-primary-700 border border-primary-100">{entries.length} entries</span>
                      </div>

                      {isExpanded && entries.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="space-y-3 mb-4 pl-6"
                        >
                          {entries.map(entry => {
                            const treatmentBadge =
                              entry.treatment === 'adopted' ? 'green' :
                              entry.treatment === 'amended' ? 'blue' :
                              entry.treatment === 'rejected with reasons' ? 'red' :
                              'gray';

                            return (
                              <div key={entry.id} className="bg-gradient-to-br from-surface-50 to-white rounded-xl p-4 border border-surface-100">
                                <div className="flex items-start justify-between gap-3 mb-2">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs font-black uppercase tracking-[0.15em] text-primary-700 bg-primary-50 px-2 py-0.5 rounded">
                                      {entry.clause_ref}
                                    </span>
                                    <p className="text-sm text-surface-800 mt-2 leading-relaxed">{entry.extracted_summary}</p>
                                  </div>
                                  <Badge variant={treatmentBadge as any} showIcon className="flex-shrink-0">
                                    {entry.treatment}
                                  </Badge>
                                </div>
                                {entry.stated_reason && (
                                  <p className="text-xs text-surface-600 mt-2 pt-2 border-t border-surface-100">
                                    <span className="font-bold uppercase tracking-wide text-surface-500">Reason:</span> {entry.stated_reason}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </motion.div>
                      )}

                      {report.extraction_status !== 'verified' && (
                        <div className="flex flex-wrap gap-3 pl-6 pt-3 border-t border-surface-100">
                          <button
                            type="button"
                            onClick={() => dispatch({ type: 'UPDATE_REPORT_STATUS', payload: { reportId: report.id, status: 'verified' } })}
                            className="btn-primary inline-flex items-center gap-2 text-sm"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Mark Verified
                          </button>
                          <button
                            type="button"
                            onClick={() => dispatch({ type: 'UPDATE_REPORT_STATUS', payload: { reportId: report.id, status: 'needs_review' } })}
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                          >
                            <AlertTriangle className="h-4 w-4" /> Needs Review
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Card>

      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 mt-0.5 flex-shrink-0 text-accent-600" />
          <div>
            <h3 className="font-bold text-surface-900 mb-1.5">Ingestion Pipeline</h3>
            <p className="text-sm text-surface-700 leading-relaxed">
              1. Upload PDF → 2. Try native text extraction (pdfplumber/PyMuPDF) → 3. If text layer is missing/insufficient, rasterize + Tesseract OCR → 
              4. Parse into structured entries (clause ref, summary, treatment, reason) → 5. Clerk verifies completeness and formatting.
            </p>
          </div>
        </div>
      </InfoBox>
    </div>
  );
}

export function ClerkNoticesPage() {
  const { state, dispatch } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    bill_ref: '', institution: '' as string, notice_date: '', window_start: '', window_end: '', mode: '', bill_text_accessible: false
  });

  const handleAdd = async () => {
    if (!formData.bill_ref || !formData.notice_date) return;
    try {
      const result = await api.createNotice({
        ...formData,
        window_start: formData.window_start || formData.notice_date,
        window_end: formData.window_end || formData.notice_date,
      });
      dispatch({ type: 'ADD_NOTICE', payload: result.notice });
      setShowForm(false);
      setFormData({ bill_ref: '', institution: '', notice_date: '', window_start: '', window_end: '', mode: '', bill_text_accessible: false });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to create the notice.');
    }
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
                  <h2 className="text-xl font-black text-surface-900 tracking-tight">Add Notice Record</h2>
                </div>
              </div>

              <div>
                <Label className="!text-xs !font-black !uppercase !tracking-[0.15em] !text-surface-600 !mb-2">Bill</Label>
                <SelectField
                  value={formData.bill_ref}
                  onChange={e => setFormData({...formData, bill_ref: e.target.value})}
                >
                  <option value="">Select...</option>
                  {state.bills.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </SelectField>
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
                  <SelectField
                    value={formData.institution}
                    onChange={e => setFormData({...formData, institution: e.target.value})}
                  >
                    <option value="">Select...</option>
                    <option>National Assembly</option>
                    <option>Nairobi County Assembly</option>
                    <option>Trans Nzoia County Assembly</option>
                  </SelectField>
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
                <CheckCircle2 className="h-4 w-4" /> Save Notice Record
              </button>
            </div>
          </Card>
        </motion.div>
      )}

      <Card className="!p-0 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/40 blur-3xl pointer-events-none" />
        <div className="relative p-7 md:p-8 pb-0">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-md shadow-primary-500/30">
              <FileText className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Registry</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Notice Records Table</h2>
            </div>
          </div>
        </div>
        <div className="table-container relative">
          <table className="data-table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Institution</th>
                <th>Notice Date</th>
                <th>Window</th>
                <th>Mode</th>
                <th>Bill Text</th>
              </tr>
            </thead>
            <tbody>
              {state.notices.map(n => {
                const bill = state.bills.find(b => b.id === n.bill_ref);
                return (
                  <tr key={n.id}>
                    <td className="text-xs font-semibold text-surface-700">{bill?.title || n.bill_ref}</td>
                    <td className="text-xs">
                      <Badge variant="accent" className="!text-[10px]">{n.institution}</Badge>
                    </td>
                    <td className="text-sm font-medium tabular-nums">{n.notice_date}</td>
                    <td className="text-xs font-medium tabular-nums text-surface-600">
                      {n.window_start} → {n.window_end}
                    </td>
                    <td className="text-xs text-surface-700 font-medium">{n.mode}</td>
                    <td>
                      {n.bill_text_accessible ? (
                        <Badge variant="green" showIcon className="!text-[10px]">Yes</Badge>
                      ) : (
                        <Badge variant="gray" className="!text-[10px]">No</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}