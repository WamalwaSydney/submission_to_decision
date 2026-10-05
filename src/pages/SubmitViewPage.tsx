import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { saveDraft, getUnsyncedDrafts } from '../utils/offline';
import { OfflineDraft } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { api } from '../api/endpoints';
import {
  Send, Save, Wifi, WifiOff, FileText, Gavel,
  CheckCircle2, Sparkles, Shield, Eye, EyeOff, Copy, ArrowRight, ThumbsUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Card, Badge, Label, InputField, DisclaimerBox, InfoBox } from '../components/UI';

export function SubmitViewPage() {
  const [searchParams] = useSearchParams();
  const { state, dispatch } = useApp();

  const [selectedBill, setSelectedBill] = useState(searchParams.get('bill') || '');
  const [clauseRef, setClauseRef] = useState('');
  const [submissionText, setSubmissionText] = useState('');
  const [showName, setShowName] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ receiptId: string; publicId: string } | null>(null);
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineDraft[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    getUnsyncedDrafts().then(setOfflineDrafts);
  }, []);

  const fireConfetti = () => {
    const duration = 2500;
    const end = Date.now() + duration;
    const colors = ['#3a5cff', '#13b892', '#1f37f5', '#2dd3ad', '#ed8b29'];

    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0 }, colors, scalar: 0.8 });
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1 }, colors, scalar: 0.8 });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.currentUser) {
      alert('Please sign in to submit a view. (Demo: sign in from the header.)');
      return;
    }
    if (!selectedBill || !submissionText.trim()) return;

    setSubmitting(true);
    const bill = state.bills.find(b => b.id === selectedBill);
    if (!bill) {
      setSubmitting(false);
      return;
    }
    try {
      const result = await api.createReceipt({
        legislative_item_id: selectedBill,
        clause_ref: clauseRef || undefined,
        submission_text: submissionText.trim(),
        show_name_publicly: showName,
      });
      const receiptId = String(result.receipt_id);
      const publicId = String(result.public_id);
      dispatch({
        type: 'ADD_RECEIPT',
        payload: {
          id: receiptId,
          public_id: publicId,
          author_id: state.currentUser.id,
          legislative_item_id: selectedBill,
          clause_ref: clauseRef || undefined,
          submission_text: submissionText.trim(),
          lodging_status: 'pending',
          timestamp: result.timestamp,
          hash: result.hash,
          previous_hash: result.previous_hash,
          author_name_public: showName ? state.currentUser.name : undefined,
        },
      });
      setSubmitting(false);
      setSuccess({ receiptId, publicId });
      setTimeout(fireConfetti, 120);
    } catch (error) {
      setSubmitting(false);
      alert(error instanceof Error ? error.message : 'Unable to submit your view.');
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
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Card className="!p-0 overflow-hidden !rounded-3xl text-center">
            {/* Thumbs up */}
            <div className="flex justify-center pt-8 bg-white">
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 15 }}
                className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
                style={{ background: '#13b892' }}
                role="img"
                aria-label="Submission successful"
              >
                <ThumbsUp className="h-10 w-10 text-white" strokeWidth={2.5} />
              </motion.div>
            </div>

            {/* Banner */}
            <div className="relative p-10 md:p-14 bg-primary-700 bg-gradient-to-br from-primary-600 via-primary-700 to-accent-600 text-white overflow-hidden">
              <div
                className="absolute inset-0 opacity-15"
                style={{
                  backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                  backgroundSize: '28px 28px',
                }}
              />
              <div className="absolute -top-24 -left-24 w-60 h-60 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute -bottom-24 -right-24 w-64 h-64 rounded-full bg-accent-300/20 blur-3xl" />

              <div className="relative">
                <motion.div
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}
                  className="mx-auto w-24 h-24 md:w-28 md:h-28 rounded-[32px] bg-white flex items-center justify-center shadow-2xl mb-6"
                >
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-[24px] bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shadow-inner">
                    <CheckCircle2 className="h-12 w-12 md:h-14 md:w-14 text-white" strokeWidth={2.5} />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.4 }}
                >
                  <Badge variant="accent" className="!bg-white/15 !text-white !border-white/30 backdrop-blur-sm mb-5 !text-[11px]">
                    <Sparkles className="h-3 w-3" /> Submission Received
                  </Badge>
                  <h2 className="text-3xl md:text-5xl font-black tracking-tighter mb-4">
                    All done. Your voice is on the record.
                  </h2>
                  <p className="text-white/85 text-lg md:text-xl max-w-xl mx-auto leading-relaxed font-medium">
                    Your view has been recorded and a tamper-evident receipt has been issued.
                    Save this ID — it's your proof.
                  </p>
                </motion.div>
              </div>
            </div>

            {/* Receipt box */}
            <div className="px-7 md:px-10 pb-8 md:pb-10 -mt-6 md:-mt-8 relative z-10">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="rounded-3xl p-7 md:p-9 bg-white border border-surface-200 shadow-elevated text-left"
              >
                <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-surface-500 mb-2">Your Receipt ID</p>
                    <p className="font-mono text-3xl md:text-4xl font-black gradient-text tracking-wider select-all">
                      {success.publicId}
                    </p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(success.publicId)}
                    className="btn-secondary !py-2 !px-3 self-start"
                    title="Copy receipt ID"
                  >
                    <Copy className="h-4 w-4" /> Copy
                  </button>
                </div>
                <p className="text-sm font-semibold text-surface-600 leading-relaxed">
                  Save this ID to look up your submission status anytime. It's public — sharing it reveals no personal information.
                </p>
              </motion.div>
            </div>

            {/* Disclaimer */}
            <div className="px-7 md:px-10 pb-8 md:pb-10">
              <DisclaimerBox className="!p-5">
                <div className="pl-3 text-sm leading-relaxed font-semibold flex items-start gap-3">
                  <Shield className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-black">Important:</strong> This receipt proves your view was submitted on this platform at the given time.
                    It does <span className="underline decoration-warm-500 decoration-2">NOT</span> prove it reached the committee.
                    The receipt's lodging status is "pending" until external lodging is confirmed.
                  </div>
                </div>
              </DisclaimerBox>
            </div>

            {/* Actions */}
            <div className="px-7 md:px-10 pb-10 md:pb-14">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.4 }}
                className="flex flex-wrap justify-center gap-3 md:gap-4"
              >
                <Link to={`/receipt-lookup?id=${success.publicId}`} className="btn-primary !px-7 !py-3.5 shadow-lg shadow-primary-500/30">
                  <FileText className="h-4.5 w-4.5" /> View Your Receipt
                </Link>
                <Link to="/bills" className="btn-secondary !px-7 !py-3.5">
                  <Gavel className="h-4.5 w-4.5" /> Browse More Bills
                </Link>
                <button
                  onClick={() => {
                    setSuccess(null);
                    setSubmissionText('');
                    setClauseRef('');
                    setSelectedBill(searchParams.get('bill') || '');
                  }}
                  className="btn-secondary !px-7 !py-3.5"
                >
                  <Send className="h-4.5 w-4.5" /> Submit Another View
                </button>
              </motion.div>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ============== FORM VIEW ==============
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Public Participation</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
          Submit <span className="gradient-text">Your View</span>
        </h1>
        <p className="text-lg text-surface-600 leading-relaxed">
          Choose a tracked bill and write your submission. You will receive a tamper-evident receipt.
          No login required to browse — but you must be signed in to submit.
        </p>
      </div>

      {/* Offline notice */}
      <AnimatePresence>
        {offlineDrafts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <InfoBox className="!p-5">
              <div className="pl-3 flex items-start gap-3">
                <WifiOff className="h-5 w-5 text-primary-700 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-semibold leading-relaxed">
                  You have {offlineDrafts.length} unsent draft{offlineDrafts.length > 1 ? 's' : ''} saved on this device.
                  {state.isOnline && ' They will be sent when you submit.'}
                </p>
              </div>
            </InfoBox>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connection + auth status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm backdrop-blur-sm border w-fit ${
            state.isOnline
              ? 'bg-accent-50/80 border-accent-200 text-accent-800'
              : 'bg-warm-50/80 border-warm-200 text-warm-800'
          }`}
        >
          {state.isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {state.isOnline ? 'Online — submissions are processed immediately' : 'Offline — drafts are saved on this device'}
        </div>

        {!state.currentUser ? (
          <Link
            to="/signin"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-primary-50 border border-primary-200 text-primary-800 hover:bg-primary-100 transition-colors"
          >
            <Shield className="h-4 w-4" />
            Sign in to submit
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-surface-200 shadow-soft">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs font-black shadow-sm">
              {state.currentUser.name.charAt(0)}
            </div>
            <div className="leading-tight">
              <p className="text-xs font-bold text-surface-900">{state.currentUser.name}</p>
              <p className="text-[10px] font-black uppercase tracking-wider text-primary-600">{state.currentUser.role}</p>
            </div>
          </div>
        )}
      </div>

      {!state.currentUser && (
        <DisclaimerBox className="!p-5">
          <div className="pl-3 text-sm leading-relaxed font-semibold">
            You are not signed in.{' '}
            <Link to="/signin" className="underline decoration-primary-400 decoration-2 hover:text-primary-800 font-black">
              Sign in
            </Link>
            {' '}to submit a view. (Demo accounts are available on the sign-in page.)
          </div>
        </DisclaimerBox>
      )}

      {/* The form */}
      <Card className="!p-7 md:!p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/60 blur-3xl pointer-events-none" />

        <form onSubmit={handleSubmit} className="relative space-y-6">
          {/* Bill */}
          <div>
            <Label htmlFor="bill-select">Bill <span className="text-red-500">*</span></Label>
            <select
              id="bill-select"
              value={selectedBill}
              onChange={e => setSelectedBill(e.target.value)}
              className="input-field"
              required
            >
              <option value="">Select a bill...</option>
              {state.bills.map(bill => (
                <option key={bill.id} value={bill.id}>
                  {bill.title} ({bill.institution}) {bill.is_simulated ? '[SIMULATED]' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Clause ref */}
          <div>
            <Label htmlFor="clause-ref">
              Clause reference <span className="text-surface-400 font-normal text-xs">(optional)</span>
            </Label>
            <InputField
              id="clause-ref"
              type="text"
              value={clauseRef}
              onChange={e => setClauseRef(e.target.value)}
              placeholder="e.g. Clause 4, Section 2.1"
            />
            <p className="text-xs font-semibold text-surface-500 mt-2 leading-relaxed">
              If your view targets a specific clause, reference it here for more accurate matching against the committee report.
            </p>
          </div>

          {/* Submission text */}
          <div>
            <Label htmlFor="submission-text">Your submission <span className="text-red-500">*</span></Label>
            <textarea
              id="submission-text"
              value={submissionText}
              onChange={e => setSubmissionText(e.target.value)}
              rows={7}
              className="input-field"
              placeholder="Write your views on this bill here. Be specific, constructive, and clear about what you'd like to see changed or retained."
              required
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs font-semibold text-surface-500 leading-relaxed max-w-xl">
                Your submission will be recorded with a timestamp and hash. It will not be shown with your identity unless you choose to make it public.
              </p>
              <p className={`text-xs font-black ${submissionText.length > 0 ? 'text-primary-600' : 'text-surface-400'}`}>
                {submissionText.length} chars
              </p>
            </div>
          </div>

          {/* Show name */}
          <div className="rounded-2xl p-5 bg-surface-50/80 border border-surface-200/80">
            <div className="flex items-start gap-3">
              <input
                id="show-name"
                type="checkbox"
                checked={showName}
                onChange={e => setShowName(e.target.checked)}
                className="checkbox-premium mt-1"
              />
              <div className="flex-1 min-w-0">
                <label htmlFor="show-name" className="font-bold text-surface-900 text-sm cursor-pointer block mb-1">
                  Display my name publicly with this submission
                </label>
                <p className="text-xs font-semibold text-surface-600 leading-relaxed flex items-center gap-1.5">
                  {showName ? <Eye className="h-3.5 w-3.5 text-primary-600" /> : <EyeOff className="h-3.5 w-3.5 text-surface-400" />}
                  <span>
                    <span className="font-black">Privacy by default:</span> your name is <span className="underline">NOT</span> shown unless you opt in.
                    You can change this later in your privacy preferences.
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-3 border-t border-surface-200/80">
            <button
              type="submit"
              disabled={submitting || !state.currentUser || !selectedBill || !submissionText.trim()}
              className="btn-primary flex-1 !py-3.5 shadow-lg shadow-primary-500/30"
            >
              <Send className="h-4.5 w-4.5" />
              {submitting ? 'Submitting...' : 'Submit View'}
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft || !selectedBill || !submissionText.trim()}
              className="btn-secondary flex-1 !py-3.5"
            >
              {draftSaved ? (
                <><CheckCircle2 className="h-4.5 w-4.5 text-accent-600" /> Draft Saved ✓</>
              ) : (
                <><Save className="h-4.5 w-4.5" /> {savingDraft ? 'Saving...' : 'Save as Draft'}</>
              )}
            </button>
          </div>
        </form>
      </Card>

      {/* Content labeling */}
      <Card className="!p-6 md:!p-7">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-primary-600" />
          <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Content Categories</p>
        </div>
        <ul className="space-y-3">
          {[
            { title: 'Citizen-generated content', desc: 'Submissions like yours. Moderated for community rules compliance.' },
            { title: 'Representative statements', desc: 'Claims from verified representative profiles. Clearly labeled.' },
            { title: 'System-derived aggregates', desc: 'Outcome counts and statistics. Computed from confirmed matches only.' },
          ].map((item, i) => (
            <li key={i} className="flex gap-3 p-3 rounded-xl bg-surface-50/60 border border-surface-100">
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-[10px] font-black flex-shrink-0 mt-0.5 shadow-sm">
                {i + 1}
              </span>
              <div>
                <p className="font-bold text-surface-900 text-sm mb-0.5">{item.title}:</p>
                <p className="text-sm font-semibold text-surface-600 leading-relaxed">{item.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}