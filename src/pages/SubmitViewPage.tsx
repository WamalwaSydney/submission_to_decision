import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { saveDraft, getUnsyncedDrafts } from '../utils/offline';
import { OfflineDraft } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { api } from '../api/endpoints';
import { ApiError } from '../api/client';
import {
  FileText, Gavel, Sparkles, Shield, Eye, EyeOff, Copy, ThumbsUp, Upload, WifiOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Card, DisclaimerBox, InfoBox } from '../components/UI';
import { StagePill, participationFor, formatDate, formatBytes } from '../components/Participation';
import { copyText } from '../utils/clipboard';

const ACCEPTED_DOCUMENTS = '.pdf,.docx,.txt';
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

type ExistingSubmission = {
  id: string;
  public_id: string;
  clause_ref?: string | null;
  submission_text: string;
  show_name_publicly?: boolean;
  editable: boolean;
  edit_block?: 'reviewed' | 'closed' | null;
  has_document?: boolean;
  attachment_name?: string | null;
  attachment_size_bytes?: number | null;
};

type Autosave = { clauseRef: string; submissionText: string };

function autosaveKey(userId: string | undefined, billId: string) {
  return `submission-autosave:${userId || 'anon'}:${billId}`;
}

function readAutosave(userId: string | undefined, billId: string): Autosave | null {
  try {
    const raw = localStorage.getItem(autosaveKey(userId, billId));
    return raw ? JSON.parse(raw) as Autosave : null;
  } catch {
    return null;
  }
}

function writeAutosave(userId: string | undefined, billId: string, value: Autosave | null) {
  try {
    if (!value || !(value.submissionText.trim() || value.clauseRef.trim())) localStorage.removeItem(autosaveKey(userId, billId));
    else localStorage.setItem(autosaveKey(userId, billId), JSON.stringify(value));
  } catch {
    // Private browsing or storage disabled: autosave is a convenience only.
  }
}

export function SubmitViewPage() {
  const [searchParams] = useSearchParams();
  const { state, dispatch } = useApp();

  const [selectedBill, setSelectedBill] = useState(searchParams.get('bill') || '');
  const [clauseRef, setClauseRef] = useState('');
  const [submissionText, setSubmissionText] = useState('');
  const [showName, setShowName] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [removeExistingDocument, setRemoveExistingDocument] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ receiptId: string; publicId: string; matchingStatus: string; edited: boolean } | null>(null);
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineDraft[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [copiedReceipt, setCopiedReceipt] = useState(false);
  const [existing, setExisting] = useState<ExistingSubmission | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  // Three guided steps: 1 choose the bill, 2 write or upload, 3 review and submit.
  const [step, setStep] = useState<1 | 2 | 3>(searchParams.get('bill') ? 2 : 1);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getUnsyncedDrafts().then(setOfflineDrafts);
  }, []);

  const bill = state.bills.find(b => b.id === selectedBill);
  const participation = participationFor(bill);
  const openBills = useMemo(
    () => state.bills.filter(b => participationFor(b).accepting).sort((a, b) => a.title.localeCompare(b.title)),
    [state.bills],
  );
  // Keep a preselected closed bill in the list so its "closed" reason can be shown.
  const billOptions = bill && !openBills.some(b => b.id === bill.id) ? [bill, ...openBills] : openBills;

  // A citizen has one submission per bill: load it so they edit instead of duplicating.
  const currentBillRef = useRef(selectedBill);
  // True once the citizen edits a field; a late response must never overwrite their typing.
  const edited = useRef(false);
  currentBillRef.current = selectedBill;

  const loadExisting = async (billId: string) => {
    if (!billId) { setExisting(null); return; }
    setLoadingExisting(true);
    try {
      const { receipt } = await api.myReceiptForBill(billId);
      if (currentBillRef.current !== billId) return; // the citizen picked another bill meanwhile
      setExisting(receipt);
      if (!edited.current) {
        // No submission yet: bring back what they were writing last time, if anything.
        const draft = receipt ? null : readAutosave(state.currentUser?.id, billId);
        setClauseRef(receipt?.clause_ref || draft?.clauseRef || '');
        setSubmissionText(receipt?.submission_text || draft?.submissionText || '');
        setShowName(Boolean(receipt?.show_name_publicly));
        setRestoredDraft(Boolean(draft?.submissionText));
      }
    } catch {
      if (currentBillRef.current === billId) setExisting(null);
    } finally {
      if (currentBillRef.current === billId) setLoadingExisting(false);
    }
  };

  useEffect(() => {
    setFormError('');
    setDocumentFile(null);
    setRemoveExistingDocument(false);
    if (!selectedBill) { setExisting(null); setClauseRef(''); setSubmissionText(''); return; }
    void loadExisting(selectedBill);
  }, [selectedBill]);

  const fireConfetti = () => {
    const end = Date.now() + 2500;
    const colors = ['#101616', '#A52D29', '#FFFFFF', '#176B2B'];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0 }, colors, scalar: 0.8 });
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1 }, colors, scalar: 0.8 });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  };

  const pickDocument = (file: File | undefined | null) => {
    setFormError('');
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_DOCUMENTS.split(',').includes(extension)) {
      setFormError('Upload your memorandum as a PDF, Word (.docx) or plain-text (.txt) file.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFormError('The document is larger than 10 MB.');
      return;
    }
    setDocumentFile(file);
    setRemoveExistingDocument(false);
  };

  // Keep a copy of unsent writing on this device, per bill, as they type.
  useEffect(() => {
    if (!selectedBill || existing || !edited.current) return;
    const timer = setTimeout(() => writeAutosave(state.currentUser?.id, selectedBill, { clauseRef, submissionText }), 600);
    return () => clearTimeout(timer);
  }, [clauseRef, submissionText, selectedBill, existing]);

  const keepsExistingDocument = Boolean(existing?.has_document && !removeExistingDocument && !documentFile);
  const hasContent = Boolean(submissionText.trim() || documentFile || keepsExistingDocument);
  const readOnly = Boolean(existing && !existing.editable);
  const formDisabled = !bill || !participation.accepting || readOnly || loadingExisting;

  const canContinueFromBill = Boolean(bill && participation.accepting && !readOnly && !loadingExisting);
  const goToReview = () => {
    setFormError('');
    if (!hasContent) { setFormError('Write your submission or upload it as a document.'); return; }
    setStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) { if (canContinueFromBill) setStep(2); return; }
    if (step === 2) { goToReview(); return; }
    setFormError('');
    if (!state.currentUser || !bill || formDisabled) return;
    if (!hasContent) {
      setFormError('Write your submission or upload it as a document.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        clause_ref: clauseRef.trim() || undefined,
        submission_text: submissionText.trim(),
        show_name_publicly: showName,
        document: documentFile,
      };
      const result = existing
        ? await api.updateReceipt(existing.public_id, { ...payload, remove_document: removeExistingDocument && !documentFile })
        : await api.createReceipt({ ...payload, legislative_item_id: bill.id });
      const receipt = {
        ...(result.receipt || {}),
        id: String(result.receipt_id),
        public_id: String(result.public_id),
        author_id: state.currentUser.id,
        legislative_item_id: bill.id,
        lodging_status: 'pending' as const,
        timestamp: result.timestamp,
        hash: result.hash,
        previous_hash: result.previous_hash,
      };
      writeAutosave(state.currentUser.id, bill.id, null);
      if (existing) dispatch({ type: 'REPLACE_RECEIPT', payload: { previousId: existing.id, receipt } });
      else dispatch({ type: 'ADD_RECEIPT', payload: receipt });
      for (const match of result.match_proposals || []) dispatch({ type: 'ADD_MATCH', payload: match });
      setSuccess({
        receiptId: receipt.id,
        publicId: receipt.public_id,
        matchingStatus: String(result.matching_status || (result.match_proposals?.length ? 'pending_review' : 'submission_triage')),
        edited: Boolean(existing),
      });
      setTimeout(fireConfetti, 120);
    } catch (error) {
      // Someone may have submitted from another tab; switch to editing that submission.
      if (error instanceof ApiError && error.status === 409 && !existing) await loadExisting(bill.id);
      setFormError(error instanceof Error ? error.message : 'Unable to submit your view.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedBill || !submissionText.trim()) return;
    setSavingDraft(true);
    const draft: OfflineDraft = {
      id: uuidv4(),
      legislative_item_id: selectedBill,
      clause_ref: clauseRef || undefined,
      submission_text: submissionText.trim(),
      created_at: new Date().toISOString(),
      synced: false,
    };
    await saveDraft(draft);
    setOfflineDrafts(prev => [...prev, draft]);
    setSavingDraft(false);
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 3000);
  };

  // ============== SUCCESS VIEW ==============
  if (success) {
    return (
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <Card className="!p-0 overflow-hidden !rounded-3xl text-center" hover={false}>
            <div className="relative p-10 md:p-14 pt-12 md:pt-16 text-white overflow-hidden" style={{ background: 'linear-gradient(135deg, #101616 0%, #252525 62%, #176B2B 100%)' }}>
              <div className="absolute inset-x-0 top-0 h-2.5" aria-hidden="true" style={{ background: 'linear-gradient(to bottom, #101616 0 27%, #FFFFFF 27% 36%, #A52D29 36% 64%, #FFFFFF 64% 73%, #176B2B 73% 100%)' }} />
              <div className="relative">
                <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }} className="mx-auto w-24 h-24 md:w-28 md:h-28 p-2 rounded-[32px] bg-white shadow-2xl mb-6" role="img" aria-label="Submission successful">
                  <div className="w-full h-full rounded-[24px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #176B2B, #0F5220)' }}>
                    <ThumbsUp className="h-10 w-10 md:h-12 md:w-12 text-white" strokeWidth={2.5} />
                  </div>
                </motion.div>
                <span className="inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider text-white" style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.4)' }}>
                  <Sparkles className="h-3 w-3" /> {success.edited ? 'Submission Updated' : 'Submission Received'}
                </span>
                <h2 className="text-3xl md:text-5xl font-black tracking-tighter mb-4">
                  {success.edited ? 'Your changes are on the record.' : 'All done. Your voice is on the record.'}
                </h2>
                <p className="text-white/90 text-lg md:text-xl max-w-xl mx-auto leading-relaxed font-medium">
                  {success.edited
                    ? 'Your edited submission was added to the tamper-evident record. Your receipt ID has not changed.'
                    : 'Your view has been recorded and a tamper-evident receipt has been issued. Save this ID — it is your proof.'}
                </p>
              </div>
            </div>

            <div className="px-7 md:px-10 pb-8 md:pb-10 -mt-6 md:-mt-8 relative z-10">
              <div className="rounded-3xl p-7 md:p-9 bg-white border border-[#e2ded5] shadow-xl text-left">
                <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[#687575] mb-2">Your Receipt ID</p>
                    <p className="font-mono text-3xl md:text-4xl font-black gradient-text tracking-wider select-all">{success.publicId}</p>
                  </div>
                  <button onClick={async () => { const ok = await copyText(success.publicId); setCopiedReceipt(ok); setTimeout(() => setCopiedReceipt(false), 2000); }} className="action-button is-secondary self-start" title="Copy receipt ID">
                    <Copy className="h-4 w-4" /> {copiedReceipt ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-sm font-semibold text-[#3b4747] leading-relaxed">
                  Use this ID to look up your submission status anytime. It is public — sharing it reveals no personal information.
                </p>
                <div role="status" className={`mt-5 notice-box ${success.matchingStatus === 'pending_review' ? 'is-info' : 'is-closed'}`}>
                  {success.matchingStatus === 'pending_review' && 'A match proposal was generated from the available committee report and sent to the Moderator Pending Review queue. A moderator must confirm or reject the proposal.'}
                  {success.matchingStatus === 'submission_triage' && 'No linked committee report is available yet. Your submission is in the Moderator Submission Triage queue until a report becomes available.'}
                  {success.matchingStatus === 'report_extraction_required' && 'A report is linked, but it has not yielded usable entries yet. Your submission is flagged for moderator triage while the report is checked.'}
                  {success.matchingStatus === 'report_reference_mismatch' && 'The linked report’s official bill reference does not match the bill you selected. The submission is flagged for moderator review rather than being matched against potentially incorrect evidence.'}
                  {success.matchingStatus === 'already_processed' && 'A committee report is available, but this submission has no new proposal. It remains visible to the moderator for follow-up.'}
                </div>
              </div>
            </div>

            <div className="px-7 md:px-10 pb-8 md:pb-10">
              <DisclaimerBox className="!p-5">
                <div className="pl-3 text-sm leading-relaxed font-semibold flex items-start gap-3 text-left">
                  <Shield className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-black">Important:</strong> This receipt proves your view was submitted on this platform at the given time.
                    It does <span className="underline decoration-2">NOT</span> prove it reached the committee.
                    The receipt's lodging status is "pending" until external lodging is confirmed.
                  </div>
                </div>
              </DisclaimerBox>
            </div>

            <div className="px-7 md:px-10 pb-10 md:pb-14 flex flex-wrap justify-center gap-3 md:gap-4">
              <Link to={`/receipt-lookup?id=${success.publicId}`} className="action-button is-primary">
                <FileText className="h-4 w-4" /> View your receipt
              </Link>
              <Link to={`/bills/${selectedBill}`} className="action-button is-secondary">
                <Gavel className="h-4 w-4" /> Back to the bill
              </Link>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ============== FORM VIEW ==============
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-[#a52d29] rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29]">Public Participation</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-[#182020] mb-4">
          Submit <span className="gradient-text">Your View</span>
        </h1>
        <p className="text-lg text-[#3b4747] leading-relaxed max-w-3xl">
          Choose a bill that is open for public participation, then write your view or upload your memorandum.
          You can make one submission per bill and edit it until the committee's call for views closes.
        </p>
      </div>

      <AnimatePresence>
        {offlineDrafts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <InfoBox className="!p-5">
              <div className="pl-3 flex items-start gap-3">
                <WifiOff className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-semibold leading-relaxed">
                  You have {offlineDrafts.length} unsent draft{offlineDrafts.length > 1 ? 's' : ''} saved on this device.
                  {state.isOnline && ' They will be sent when you are online.'}
                </p>
              </div>
            </InfoBox>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="submit-card grid gap-7" noValidate>
        <ol className="submit-steps" aria-label="Steps">
          {['Choose the bill', 'Your view', 'Review and submit'].map((label, index) => (
            <li key={label} className={index + 1 < step ? 'is-done' : index + 1 === step ? 'is-current' : ''} aria-current={index + 1 === step ? 'step' : undefined}>
              <span>{index + 1}</span>{label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <>
        {/* Bill */}
        <div>
          <label className="field-label" htmlFor="bill-select">Bill <span className="text-[#a52d29]">*</span></label>
          <select id="bill-select" value={selectedBill} onChange={e => { edited.current = false; setRestoredDraft(false); setSelectedBill(e.target.value); }} className="input-field" required>
            <option value="">{openBills.length ? `Select one of ${openBills.length} bills open for submissions…` : 'No bills are open for submissions right now'}</option>
            {billOptions.map(option => (
              <option key={option.id} value={option.id}>{option.title} ({option.identifier})</option>
            ))}
          </select>
          {bill && (
            <div className="selected-bill">
              <h3>{bill.title}</h3>
              <div className="meta">
                <StagePill stage={bill.stage} />
                <span className="font-mono">{bill.identifier}</span>
                <span>{bill.institution}</span>
                <Link to={`/bills/${bill.id}`} className="font-bold text-[#11521f] underline underline-offset-2">Read the bill and its documents</Link>
              </div>
              <p className={`notice-box ${participation.accepting ? 'is-info' : 'is-closed'} !m-0`}>
                <strong>{participation.accepting ? (participation.closes_on ? `Open until ${formatDate(participation.closes_on)}. ` : 'Open for submissions. ') : 'Submissions are closed. '}</strong>
                {participation.reason}
              </p>
            </div>
          )}
          {!bill && !openBills.length && (
            <p className="field-hint">Committees take public views after a bill's First Reading and before its Second Reading. Check the Notices page for upcoming calls for memoranda.</p>
          )}
        </div>
        {existing && (
          <p className="notice-box is-info !m-0" role="status">
            {existing.editable ? (
              <><strong>You already made a submission on this bill</strong> (receipt <Link to={`/receipt-lookup?id=${existing.public_id}`} className="font-mono font-bold underline">{existing.public_id}</Link>). Your changes replace it, and the receipt ID stays the same. The earlier version stays on the tamper-evident record.</>
            ) : (
              <><strong>Your submission {existing.public_id} can no longer be edited.</strong> {existing.edit_block === 'closed' ? "The committee's call for views on this bill has closed." : 'A moderator has already reviewed it against the committee report.'}</>
            )}
          </p>
        )}
            <div className="form-actions">
              <button type="submit" disabled={!canContinueFromBill} className="action-button is-primary">{existing ? 'Continue to edit your view' : 'Continue'}</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {bill && (
              <div className="selected-bill !mt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3>{bill.title}</h3>
                  <button type="button" className="text-sm font-bold text-accent-700 underline" onClick={() => setStep(1)}>Change bill</button>
                </div>
                <div className="meta"><StagePill stage={bill.stage} /><span className="font-mono">{bill.identifier}</span>{participation.closes_on && <span>Views close {formatDate(participation.closes_on)}</span>}</div>
                {!participation.accepting && <p className="notice-box is-closed !m-0"><strong>Submissions are closed. </strong>{participation.reason}</p>}
              </div>
            )}
        {existing && (
          <p className="notice-box is-info !m-0" role="status">
            {existing.editable ? (
              <><strong>You already made a submission on this bill</strong> (receipt <Link to={`/receipt-lookup?id=${existing.public_id}`} className="font-mono font-bold underline">{existing.public_id}</Link>). Your changes replace it, and the receipt ID stays the same. The earlier version stays on the tamper-evident record.</>
            ) : (
              <><strong>Your submission {existing.public_id} can no longer be edited.</strong> {existing.edit_block === 'closed' ? "The committee's call for views on this bill has closed." : 'A moderator has already reviewed it against the committee report.'}</>
            )}
          </p>
        )}
            {restoredDraft && !existing && <p className="notice-box is-info !m-0" role="status">We brought back the draft you were writing on this device.</p>}
        <fieldset disabled={formDisabled} className="grid gap-7 m-0 p-0 border-0 min-w-0">
          {/* Clause ref */}
          <div>
            <label className="field-label" htmlFor="clause-ref">Clause reference <span className="optional">(optional)</span></label>
            <input id="clause-ref" type="text" value={clauseRef} onChange={e => { edited.current = true; setClauseRef(e.target.value); }} placeholder="e.g. Clause 4, Section 2.1" className="input-field" maxLength={100} />
            <p className="field-hint">If your view is about a specific clause, name it here so it can be matched accurately against the committee report.</p>
          </div>

          {/* Submission text */}
          <div>
            <label className="field-label" htmlFor="submission-text">Your submission {documentFile || keepsExistingDocument ? <span className="optional">(optional when you upload a document)</span> : <span className="text-[#a52d29]">*</span>}</label>
            <textarea
              id="submission-text"
              value={submissionText}
              onChange={e => { edited.current = true; setSubmissionText(e.target.value); }}
              rows={12}
              className="input-field leading-relaxed"
              placeholder="Write your views on this bill. Be specific about what you would like changed, added or kept, and why."
            />
            <div className="flex items-start justify-between gap-4 mt-2">
              <p className="field-hint !m-0">Your submission is recorded with a timestamp and hash. Your name is not shown unless you choose to show it below.</p>
              <p className="text-xs font-black text-[#687575] whitespace-nowrap">{submissionText.length} chars</p>
            </div>
          </div>

          {/* Document upload */}
          <div>
            <span className="field-label">Upload a memorandum <span className="optional">(optional)</span></span>
            {documentFile ? (
              <div className="file-chip">
                <span><FileText className="inline h-4 w-4 mr-2 -mt-0.5" aria-hidden="true" />{documentFile.name} · {formatBytes(documentFile.size)}</span>
                <button type="button" onClick={() => { setDocumentFile(null); if (fileInput.current) fileInput.current.value = ''; }}>Remove</button>
              </div>
            ) : keepsExistingDocument ? (
              <div className="file-chip">
                <span><FileText className="inline h-4 w-4 mr-2 -mt-0.5" aria-hidden="true" />{existing?.attachment_name || 'Current document'}{existing?.attachment_size_bytes ? ` · ${formatBytes(existing.attachment_size_bytes)}` : ''}</span>
                <span className="!overflow-visible flex gap-3">
                  <button type="button" onClick={() => fileInput.current?.click()}>Replace</button>
                  <button type="button" onClick={() => setRemoveExistingDocument(true)}>Remove</button>
                </span>
              </div>
            ) : (
              <label
                className={`file-drop ${dragging ? 'is-dragging' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); pickDocument(e.dataTransfer.files?.[0]); }}
              >
                <Upload className="h-6 w-6 text-[#176b2b] flex-shrink-0" aria-hidden="true" />
                <span>
                  <strong>Choose a file or drag it here</strong>
                  <small>PDF, Word (.docx) or text file, up to 10 MB</small>
                </span>
                <input ref={fileInput} type="file" accept={ACCEPTED_DOCUMENTS} className="sr-only" onChange={e => pickDocument(e.target.files?.[0])} />
              </label>
            )}
            {(documentFile || keepsExistingDocument) && <input ref={fileInput} type="file" accept={ACCEPTED_DOCUMENTS} className="sr-only" onChange={e => pickDocument(e.target.files?.[0])} aria-label="Replace document" />}
            <p className="field-hint">
              If you leave the text box empty, the text of your document becomes your public submission, so leave out phone numbers or other details you don't want published.
              The original file is only visible to you and parliamentary staff.
            </p>
          </div>

          {/* Show name */}
          <div className="rounded-2xl p-5 bg-[#faf9f6] border border-[#e7e3da]">
            <div className="flex items-start gap-3">
              <input id="show-name" type="checkbox" checked={showName} onChange={e => { edited.current = true; setShowName(e.target.checked); }} className="mt-1 h-4 w-4 accent-[#176b2b]" />
              <div className="flex-1 min-w-0">
                <label htmlFor="show-name" className="font-bold text-[#182020] text-sm cursor-pointer block mb-1">Display my name publicly with this submission</label>
                <p className="text-xs font-semibold text-[#3b4747] leading-relaxed flex items-center gap-1.5 m-0">
                  {showName ? <Eye className="h-3.5 w-3.5 text-[#176b2b] flex-shrink-0" /> : <EyeOff className="h-3.5 w-3.5 text-[#94a09d] flex-shrink-0" />}
                  <span><span className="font-black">Privacy by default:</span> your name is not shown unless you opt in.</span>
                </p>
              </div>
            </div>
          </div>
        </fieldset>
            {formError && <p role="alert" className="notice-box is-error !m-0">{formError}</p>}
            <div className="form-actions">
              <button type="submit" disabled={formDisabled || !hasContent} className="action-button is-primary">Review your view</button>
              {!existing && (
                <button type="button" onClick={handleSaveDraft} disabled={savingDraft || formDisabled || !submissionText.trim()} className="action-button is-secondary">
                  {draftSaved ? 'Draft saved' : savingDraft ? 'Saving…' : 'Save for later'}
                </button>
              )}
            </div>
          </>
        )}

        {step === 3 && bill && (
          <>
            <div>
              <h2 className="text-xl font-black text-surface-900 m-0">Check your view before you submit</h2>
              <p className="field-hint">This is exactly what will be recorded. Everything except your name is public unless you chose to show it.</p>
            </div>
            <dl className="submission-detail-meta">
              <div><dt>Bill</dt><dd>{bill.title}</dd></div>
              <div><dt>Clause</dt><dd>{clauseRef.trim() || 'Whole bill'}</dd></div>
              <div><dt>Your name</dt><dd>{showName ? 'Shown publicly' : 'Not shown'}</dd></div>
              {(documentFile || keepsExistingDocument) && <div><dt>Document</dt><dd>{documentFile?.name || existing?.attachment_name || 'Current document'}</dd></div>}
            </dl>
            {submissionText.trim()
              ? <p className="submission-detail-text">{submissionText.trim()}</p>
              : <p className="notice-box is-closed !m-0">You did not type anything, so the text of your document will be your public submission.</p>}
            <p className="notice-box is-info !m-0">
              After you submit you get a receipt ID to track this submission. {participation.closes_on ? `You can edit it until ${formatDate(participation.closes_on)}, when the call for views closes.` : 'You can edit it until the committee stops taking views.'}
            </p>
            {formError && <p role="alert" className="notice-box is-error !m-0">{formError}</p>}
            <div className="form-actions">
              <button type="submit" disabled={submitting || formDisabled || !hasContent} className="action-button is-primary">
                {submitting ? (existing ? 'Saving…' : 'Submitting…') : existing ? 'Save changes' : 'Submit my view'}
              </button>
              <button type="button" className="action-button is-secondary" onClick={() => setStep(2)}>Back to edit</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
