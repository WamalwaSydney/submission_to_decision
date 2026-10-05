import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { verifyChain } from '../utils/hashChain';
import { api } from '../api/endpoints';
import { ChainVerificationResult, SubmissionStatus } from '../types';
import {
  Search, CheckCircle2, XCircle, AlertTriangle, Clock,
  FileText, Fingerprint, Shield, ArrowRight, Link as LinkIcon,
  RefreshCw, Copy, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Badge, Label, InputField, DisclaimerBox, InfoBox, StatusBadge } from '../components/UI';

function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return StatusBadge({ status });
}

export function ReceiptLookupPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('id') || '');
  const { state, getSubmissionStatus } = useApp();
  const [remoteReceipt, setRemoteReceipt] = useState<any>(null);
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    if (!query) { setRemoteReceipt(null); return; }
    setLookupError('');
    api.receipt(query.toUpperCase()).then(setRemoteReceipt).catch(() => {
      setRemoteReceipt(null);
      setLookupError('Receipt not found on the API.');
    });
  }, [query]);

  const receipt = remoteReceipt || (query ? state.receipts.find(r => r.public_id === query.toUpperCase()) : null);
  const bill = receipt ? state.bills.find(b => b.id === receipt.legislative_item_id) : null;
  const status = remoteReceipt ? remoteReceipt.status as SubmissionStatus : (receipt ? getSubmissionStatus(receipt.id) : null);
  const match = receipt ? state.matches.find(m => m.receipt_ref === receipt.id && m.reviewer_decision === 'confirmed') : null;
  const entry = remoteReceipt?.match ? { treatment: remoteReceipt.match.treatment, stated_reason: remoteReceipt.match.stated_reason } : (match ? state.reportEntries.find(e => e.id === match.report_entry_ref) : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams({ id: query });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Tamper-Evident Records</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
          Receipt <span className="gradient-text">Lookup</span>
        </h1>
        <p className="text-lg text-surface-600 leading-relaxed">
          Enter your receipt ID to check the status of your submission — from the moment you submitted it to the final committee outcome.
          No account required.
        </p>
      </div>

      {/* Lookup form */}
      <Card className="!p-7 md:!p-8 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
        <div className="relative">
          <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 md:gap-5 items-end">
            <div className="flex-1 w-full">
              <Label htmlFor="receipt-id">Receipt ID</Label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center text-primary-700 border border-primary-200/60">
                  <Search className="h-4.5 w-4.5" />
                </div>
                <input
                  id="receipt-id"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value.toUpperCase())}
                  placeholder="e.g. RCT-KN8X2M"
                  className="input-field !pl-16 !py-3.5 !text-base !font-mono font-bold tracking-wider"
                  autoComplete="off"
                />
              </div>
            </div>
            <button type="submit" className="btn-primary !w-full md:!w-auto !px-8 !py-3.5 shadow-lg shadow-primary-500/25">
              <Search className="h-4.5 w-4.5" /> Look Up Receipt
            </button>
          </form>
          <p className="text-xs text-surface-500 font-semibold mt-4 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-accent-600" />
            Your receipt ID is public — it reveals no personally identifiable information.
          </p>
        </div>
      </Card>

      <AnimatePresence mode="wait">
        {/* Not found */}
        {query && !receipt && (
          <motion.div
            key="not-found"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="!p-12 md:!p-16 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-warm-50/60 to-transparent" />
              <div className="relative">
                <div className="w-20 h-20 md:w-24 md:h-24 mx-auto rounded-3xl bg-gradient-to-br from-warm-100 to-warm-200 border border-warm-200 flex items-center justify-center mb-6 shadow-inner">
                  <XCircle className="h-10 w-10 md:h-12 md:w-12 text-warm-600" />
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-surface-900 mb-3 tracking-tight">No receipt found</h2>
                <p className="text-surface-600 max-w-md mx-auto mb-6 leading-relaxed font-medium">
                  No receipt found with ID{' '}
                  <span className="font-mono font-bold bg-surface-100 px-2 py-0.5 rounded-md border border-surface-200">{query}</span>.
                  Please check the ID and try again.
                </p>
                <Link to="/bills" className="btn-secondary inline-flex">
                  Browse Bills Instead
                </Link>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Found */}
        {receipt && bill && status && (
          <motion.div
            key="found"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
          >
            {/* Main receipt card */}
            <Card className="!p-0 overflow-hidden !rounded-3xl">
              {/* Gradient header */}
              <div className="relative p-7 md:p-9 bg-gradient-to-br from-primary-600 via-primary-700 to-accent-600 text-white overflow-hidden">
                <div className="absolute inset-0 opacity-15" style={{
                  backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                  backgroundSize: '26px 26px'
                }} />
                <div className="absolute -top-24 -left-24 w-56 h-56 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full bg-accent-300/20 blur-3xl" />

                <div className="relative flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Fingerprint className="h-4 w-4" />
                      <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white/80">Tamper-Evident Receipt</span>
                    </div>
                    <h2 className="font-mono text-2xl md:text-4xl font-black tracking-wider mb-2 drop-shadow-sm">
                      {receipt.public_id}
                    </h2>
                    <p className="text-sm text-white/80 font-medium flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" />
                      Issued: {new Date(receipt.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <SubmissionStatusBadge status={status as SubmissionStatus} />
                </div>
              </div>

              {/* Receipt body */}
              <div className="p-7 md:p-9 space-y-6">
                <DisclaimerBox className="!p-5">
                  <div className="pl-3 text-sm leading-relaxed font-semibold">
                    <strong className="font-black">Lodging notice:</strong> This receipt proves a view was submitted on this platform at the given time.
                    It does <span className="underline decoration-warm-500 decoration-2">NOT</span> prove it reached the committee.
                    Lodging status: <span className="font-black text-warm-900 bg-white/60 px-1.5 py-0.5 rounded">{receipt.lodging_status}</span>.
                  </div>
                </DisclaimerBox>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                  {/* Bill */}
                  <div className="rounded-2xl p-5 bg-gradient-to-br from-surface-50 to-white border border-surface-200/80">
                    <h3 className="text-xs font-black uppercase tracking-widest text-surface-500 mb-2">Bill</h3>
                    <Link to={`/bills/${bill.id}`} className="group font-bold text-surface-900 text-lg leading-snug hover:text-primary-700 transition-colors flex items-start gap-2">
                      <span>{bill.title}</span>
                      <ExternalLink className="h-4 w-4 text-surface-400 group-hover:text-primary-600 flex-shrink-0 mt-1" />
                    </Link>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-surface-500 bg-surface-100 px-2 py-0.5 rounded-md border border-surface-200">
                        {bill.identifier}
                      </span>
                      {bill.is_simulated && <Badge variant="gray" className="!text-[10px]">SIMULATED</Badge>}
                    </div>
                  </div>

                  {/* Clause */}
                  {receipt.clause_ref && (
                    <div className="rounded-2xl p-5 bg-gradient-to-br from-primary-50/80 to-white border border-primary-100">
                      <h3 className="text-xs font-black uppercase tracking-widest text-primary-600 mb-2">Clause Reference</h3>
                      <p className="font-bold text-surface-900 text-lg">{receipt.clause_ref}</p>
                      <p className="text-xs font-semibold text-surface-500 mt-1">Targeted reference for better matching</p>
                    </div>
                  )}

                  {/* Submission */}
                  <div className={`rounded-2xl p-5 bg-gradient-to-br from-accent-50/70 to-white border border-accent-100 ${!receipt.clause_ref ? 'md:col-span-2' : ''}`}>
                    <h3 className="text-xs font-black uppercase tracking-widest text-accent-700 mb-3">Your Submission</h3>
                    <p className="text-[15px] text-surface-800 leading-relaxed font-medium bg-white/70 p-4 rounded-xl border border-accent-100/80">
                      {receipt.submission_text}
                    </p>
                  </div>
                </div>

                {/* Hashes */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-4 border-t border-surface-200/80">
                  <div className="rounded-2xl p-5 bg-gradient-to-br from-surface-900 to-surface-800 border border-surface-700 shadow-xl">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase tracking-widest text-surface-400">Receipt Hash</h3>
                      <button
                        onClick={() => navigator.clipboard?.writeText(receipt.hash)}
                        className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-white/10 transition-colors"
                        title="Copy"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="font-mono text-[11px] leading-relaxed text-accent-300 break-all font-semibold">
                      {receipt.hash}
                    </p>
                  </div>
                  <div className="rounded-2xl p-5 bg-gradient-to-br from-surface-800 to-surface-900 border border-surface-700 shadow-xl">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase tracking-widest text-surface-400">Previous Hash (Chain)</h3>
                      <LinkIcon className="h-3.5 w-3.5 text-primary-400" />
                    </div>
                    <p className="font-mono text-[11px] leading-relaxed text-primary-300 break-all font-semibold">
                      {receipt.previous_hash}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Match info */}
            <AnimatePresence>
              {match && entry && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                >
                  <Card className="!p-7 md:!p-8 relative overflow-hidden border-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-accent-50 via-white to-primary-50" />
                    <div className="relative">
                      <div className="flex items-center gap-3 mb-6 flex-wrap">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-white shadow-lg shadow-accent-500/40">
                          <LinkIcon className="h-6 w-6" />
                        </div>
                        <div>
                          <div className="inline-flex items-center gap-2 mb-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-accent-600" />
                            <span className="text-xs font-black uppercase tracking-[0.18em] text-accent-700">Committee Report Match</span>
                          </div>
                          <h3 className="text-2xl font-black text-surface-900 tracking-tight">Matched to Report Entry</h3>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                        <div className="rounded-xl p-4 bg-white/80 backdrop-blur-sm border border-surface-200/80">
                          <p className="text-xs font-black uppercase tracking-widest text-surface-500 mb-1.5">Match method</p>
                          <p className="font-bold text-surface-900">{match.match_method}</p>
                        </div>
                        <div className="rounded-xl p-4 bg-white/80 backdrop-blur-sm border border-surface-200/80">
                          <p className="text-xs font-black uppercase tracking-widest text-surface-500 mb-1.5">Confidence</p>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2.5 rounded-full bg-surface-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-accent-500 to-primary-500"
                                style={{ width: `${match.confidence_score * 100}%` }}
                              />
                            </div>
                            <span className="font-black text-surface-900">{(match.confidence_score * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="rounded-xl p-4 bg-white/80 backdrop-blur-sm border border-surface-200/80 md:col-span-2">
                          <p className="text-xs font-black uppercase tracking-widest text-surface-500 mb-1.5">Explanation</p>
                          <p className="font-semibold text-surface-800 leading-relaxed">{match.explanation}</p>
                        </div>
                        <div className="rounded-xl p-4 bg-white/80 backdrop-blur-sm border border-surface-200/80">
                          <p className="text-xs font-black uppercase tracking-widest text-surface-500 mb-2">Committee Treatment</p>
                          <SubmissionStatusBadge status={entry.treatment as SubmissionStatus} />
                        </div>
                        <div className="rounded-xl p-4 bg-white/80 backdrop-blur-sm border border-surface-200/80">
                          <p className="text-xs font-black uppercase tracking-widest text-surface-500 mb-1.5">Confirmed On</p>
                          <p className="font-bold text-surface-900">
                            {new Date(match.timestamp).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}
                          </p>
                          <p className="text-xs font-semibold text-surface-500">By a human moderator</p>
                        </div>
                        {entry.stated_reason && (
                          <div className="rounded-xl p-5 bg-gradient-to-br from-warm-50/80 to-white border border-warm-200 md:col-span-2">
                            <p className="text-xs font-black uppercase tracking-widest text-warm-700 mb-2">Stated Committee Reason</p>
                            <p className="font-semibold text-warm-900 leading-relaxed">{entry.stated_reason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-4">
              <Link to="/receipt-verify" className="btn-secondary !px-6 !py-3 inline-flex">
                <Shield className="h-4.5 w-4.5" /> Verify Hash Chain
              </Link>
              <Link to={`/bills/${bill.id}`} className="btn-secondary !px-6 !py-3 inline-flex">
                <FileText className="h-4.5 w-4.5" /> View Bill Outcome Trail
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ReceiptVerifyPage() {
  const { state } = useApp();
  const [result, setResult] = useState<ChainVerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState('');

  const handleVerify = async () => {
    setVerifying(true);
    setVerificationError('');
    try {
      const remote = await api.verifyChain();
      setResult({
        valid: remote.valid,
        totalChecked: remote.total_checked,
        firstBrokenIndex: remote.first_broken_index ?? undefined,
        details: (remote.details || []).map((item: any) => ({
          index: item.index,
          receiptId: item.receipt_id,
          valid: item.valid,
          expectedHash: item.expected_hash,
          actualHash: item.actual_hash,
        })),
      });
    } catch (error) {
      setResult(null);
      setVerificationError(error instanceof Error ? error.message : 'The receipt chain could not be verified in this browser.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Integrity Check</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
          Verify <span className="gradient-text">Hash Chain</span>
        </h1>
        <p className="text-lg text-surface-600 leading-relaxed">
          Verify the integrity of every receipt in the hash chain. Each link is recomputed and checked — so any tampering,
          anywhere in history, breaks the chain.
        </p>
      </div>

      <InfoBox className="!p-5 !max-w-5xl">
        <div className="pl-3 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-700 flex-shrink-0">
            <Shield className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold leading-relaxed">
            <strong className="font-black">Note:</strong> Full cryptographic verification against the server requires a live connection.
            This check validates the chain integrity of all receipts currently loaded in your session.
          </p>
        </div>
      </InfoBox>

      {/* Run verification card */}
      <Card className="!p-8 md:!p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-accent-500 flex items-center justify-center text-white shadow-2xl shadow-primary-500/40 animate-glow-pulse">
              <Fingerprint className="h-8 w-8 md:h-9 md:w-9" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-2">Current Chain</p>
              <h2 className="text-3xl md:text-4xl font-black text-surface-900 tracking-tight mb-1">
                {state.receipts.length.toLocaleString()}
                <span className="text-surface-400 font-bold"> receipts</span>
              </h2>
              <p className="text-sm text-surface-600 font-medium leading-relaxed max-w-xl">
                Each receipt's hash is computed from its content, timestamp, and the previous receipt's hash.
                Any modification — anywhere — breaks the chain.
              </p>
            </div>
          </div>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="btn-primary !px-8 !py-4 shadow-lg shadow-primary-500/30 min-w-[240px]"
          >
            {verifying ? (
              <>
                <RefreshCw className="h-4.5 w-4.5 animate-spin" /> Verifying Chain...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4.5 w-4.5" /> Verify Entire Chain
              </>
            )}
          </button>
        </div>
      </Card>

      {verificationError && (
        <InfoBox className="!p-5">
          <div className="flex items-start gap-3 py-4 pr-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warm-700" />
            <div><p className="font-extrabold text-surface-900">Verification could not be completed</p><p className="text-sm text-surface-700 mt-1">{verificationError}</p></div>
          </div>
        </InfoBox>
      )}

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
          >
            {/* Summary */}
            <Card className={`!p-8 md:!p-10 relative overflow-hidden ${result.valid ? 'border-0' : 'border-red-200'}`}>
              {result.valid ? (
                <div className="absolute inset-0 bg-gradient-to-br from-accent-50 via-white to-primary-50" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-red-50 via-white to-warm-50" />
              )}
              <div className="relative flex items-start gap-5 md:gap-6">
                <div className={`flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-3xl flex items-center justify-center text-white shadow-2xl ${
                  result.valid
                    ? 'bg-gradient-to-br from-accent-500 to-accent-700 shadow-accent-500/40 animate-glow-pulse'
                    : 'bg-gradient-to-br from-red-500 to-red-700 shadow-red-500/40'
                }`}>
                  {result.valid
                    ? <Shield className="h-8 w-8 md:h-10 md:w-10" />
                    : <AlertTriangle className="h-8 w-8 md:h-10 md:w-10" />
                  }
                </div>
                <div className="flex-1">
                  <div className="inline-flex items-center gap-2 mb-2">
                    {result.totalChecked === 0 ? <Badge variant="gray" showIcon className="!text-[11px]">NO RECEIPTS</Badge> : result.valid
                      ? <Badge variant="accent" showIcon className="!text-[11px]">CHAIN INTACT</Badge>
                      : <Badge variant="red" showIcon className="!text-[11px]">INTEGRITY COMPROMISED</Badge>
                    }
                  </div>
                  <h2 className={`text-3xl md:text-4xl font-black tracking-tight mb-2 ${
                    result.totalChecked === 0 ? 'text-surface-800' :
                    result.valid ? 'text-accent-800' : 'text-red-800'
                  }`}>
                    {result.totalChecked === 0 ? 'No receipts to verify' : result.valid ? 'Chain is intact ✓' : 'Chain integrity compromised ⚠'}
                  </h2>
                  <p className={`text-lg font-semibold leading-relaxed ${
                    result.valid ? 'text-accent-700/90' : 'text-red-700/90'
                  }`}>
                    {result.totalChecked === 0 ? 'No receipt links are currently loaded in this session.' : `${result.totalChecked} receipts checked.`}
                    {result.firstBrokenIndex !== undefined && (
                      <> First broken link at position <span className="font-black bg-white/80 px-2 py-0.5 rounded-md">{result.firstBrokenIndex + 1}</span> (receipt{' '}
                        <span className="font-mono font-bold">{result.details[result.firstBrokenIndex].receiptId}</span>).</>
                    )}
                    {result.valid && result.totalChecked > 0 && (
                      <> Every hash matches — no tampering detected in the current chain.</>
                    )}
                  </p>
                </div>
              </div>
            </Card>

            {/* Chain details table */}
            <Card className="!p-7 md:!p-8">
              <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
                <div>
                  <div className="inline-flex items-center gap-2 mb-2">
                    <LinkIcon className="h-4 w-4 text-primary-600" />
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Chain Details</span>
                  </div>
                  <h3 className="text-2xl font-black text-surface-900 tracking-tight">Per-link verification</h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-500" /> Valid
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Broken
                  </div>
                </div>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Receipt ID</th>
                      <th>Status</th>
                      <th>Hash Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.details.map((d, i) => (
                      <tr key={i}>
                        <td className="font-black text-surface-700">{i + 1}</td>
                        <td className="font-mono font-bold text-xs text-surface-800">{d.receiptId}</td>
                        <td>
                          {d.valid ? (
                            <Badge variant="green" showIcon>Valid</Badge>
                          ) : (
                            <Badge variant="red" showIcon>Broken</Badge>
                          )}
                        </td>
                        <td className="font-mono text-[11px] text-surface-500 truncate max-w-[240px]">{d.actualHash.slice(0, 20)}...</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Back link */}
            <Link to="/receipt-lookup" className="inline-flex items-center gap-2 text-sm font-bold text-primary-700 hover:text-primary-800 transition-colors">
              <ArrowRight className="h-4 w-4 rotate-180" /> Back to Receipt Lookup
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
