import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { ReportEntry, ReviewerDecision, SubmissionStatus } from '../types';
import { api } from '../api/endpoints';
import { v4 as uuidv4 } from 'uuid';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Flag, Shield, Gavel, Users, FileText, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, DisclaimerBox, InfoBox, Badge, Label, SelectField, BtnPrimary, BtnSecondary, BtnDanger } from '../components/UI';
import { confidenceClasses, confidenceBarClass, confidenceLabel } from '../utils/confidence';

function ReportTreatmentEditor({ entry }: { entry: ReportEntry }) {
  const { dispatch } = useApp();
  const [treatment, setTreatment] = useState<SubmissionStatus>(entry.treatment);
  const [reason, setReason] = useState(entry.stated_reason || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const changed = treatment !== entry.treatment || reason.trim() !== (entry.stated_reason || '').trim();

  useEffect(() => {
    setTreatment(entry.treatment);
    setReason(entry.stated_reason || '');
    setFeedback('');
  }, [entry.treatment, entry.stated_reason]);

  const save = async () => {
    if (treatment === 'unclassified' || treatment === 'awaiting committee report') return;
    if (treatment === 'rejected with reasons' && !reason.trim()) {
      setFeedback('Add the reason stated in the official report before saving this outcome.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      await api.updateReportEntry(entry.report_ref, entry.id, treatment, reason.trim() || undefined);
      dispatch({ type: 'UPDATE_REPORT_ENTRY', payload: { entryId: entry.id, treatment, stated_reason: reason.trim() || undefined } });
      setFeedback('Committee outcome saved.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to save the committee outcome.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mt-3 rounded-lg border border-surface-200 bg-white/80 p-3">
    <p className="text-xs font-bold text-surface-700 mb-2">Classify outcome from the official report</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Committee report outcome" value={treatment} onChange={event => { setTreatment(event.target.value as SubmissionStatus); setFeedback(''); }} disabled={saving} className="input-field min-h-10 flex-1 min-w-[190px] !py-2 text-sm">
        <option value="unclassified" disabled>Unclassified (choose an outcome)</option>
        <option value="adopted">Adopted</option>
        <option value="amended">Amended</option>
        <option value="rejected with reasons">Rejected with reasons</option>
        <option value="not addressed">Not addressed</option>
      </select>
      <button type="button" onClick={save} disabled={saving || !changed || treatment === 'unclassified'} className="btn-primary min-h-10 !px-4 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save outcome'}</button>
    </div>
    {treatment === 'rejected with reasons' && <textarea aria-label="Reason stated in committee report" value={reason} onChange={event => { setReason(event.target.value); setFeedback(''); }} rows={2} placeholder="Enter the reason stated in the committee report" className="input-field mt-2 text-sm" />}
    <p role="status" className={`mt-2 text-xs font-semibold ${feedback.includes('saved') ? 'text-green-700' : feedback ? 'text-red-700' : 'text-surface-500'}`}>
      {feedback || 'Match confirmation is separate: only select an outcome supported by the committee report.'}
    </p>
  </div>;
}

export function ReviewerQueuePage() {
  const { state, dispatch } = useApp();
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [decisionMatchId, setDecisionMatchId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const [generatingBillId, setGeneratingBillId] = useState<string | null>(null);
  const [extractingReportId, setExtractingReportId] = useState<string | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<Record<string, string>>({});
  const [recentGeneratedMatches, setRecentGeneratedMatches] = useState<any[]>([]);
  const pendingMatches = state.matches.filter(m => m.reviewer_decision === 'pending');
  const reviewedMatches = state.matches.filter(m => m.reviewer_decision !== 'pending');
  const unmatchedReceipts = state.receipts.filter(receipt => !state.matches.some(match => match.receipt_ref === receipt.id));
  const canModerate = state.currentUser?.role === 'reviewer' || state.currentUser?.role === 'moderator';

  useEffect(() => {
    let cancelled = false;
    if (state.currentUser?.role !== 'reviewer' && state.currentUser?.role !== 'moderator') {
      setQueueLoading(false);
      return () => { cancelled = true; };
    }
    setQueueLoading(true);
    api.autoProcessMatches().then(() => Promise.all([api.bootstrap(), api.pendingMatches(), api.reviewQueueReceipts()])).then(([snapshot, pending, queueReceipts]) => {
      if (cancelled) return;
      dispatch({
        type: 'HYDRATE',
        payload: {
          bills: snapshot.bills,
          receipts: queueReceipts.receipts,
          reports: snapshot.reports,
          reportEntries: snapshot.report_entries,
          matches: [...snapshot.matches.filter(match => match.reviewer_decision !== 'pending'), ...pending.matches],
        },
      });
      setQueueError('');
    }).catch(error => {
      if (!cancelled) setQueueError(error instanceof Error ? error.message : 'Unable to refresh the review queue.');
    }).finally(() => {
      if (!cancelled) setQueueLoading(false);
    });
    return () => { cancelled = true; };
  }, [dispatch, state.currentUser?.id, state.currentUser?.role]);

  const handleDecision = async (matchId: string, decision: ReviewerDecision) => {
    if (!state.currentUser) return;
    if (decision === 'pending') return;
    setDecisionMatchId(matchId);
    setDecisionError('');
    try {
      await api.decideMatch(matchId, decision === 'confirmed' ? 'confirm' : 'reject');
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Unable to update the match. Please refresh and try again.');
      setDecisionMatchId(null);
      return;
    }
    dispatch({
      type: 'UPDATE_MATCH_DECISION',
      payload: { matchId, decision, reviewerId: state.currentUser.id }
    });
    dispatch({
      type: 'ADD_AUDIT_LOG',
      payload: {
        id: uuidv4(),
        entity_type: 'match',
        entity_id: matchId,
        action: decision === 'confirmed' ? 'confirmed' : 'rejected',
        details: `Match ${decision} by ${state.currentUser.name}`,
        timestamp: new Date().toISOString(),
      }
    });
    setRecentGeneratedMatches(previous => previous.filter(match => match.id !== matchId));
    setDecisionMatchId(null);
  };

  const generateForReceipt = async (receiptId: string, billId: string) => {
    setGeneratingBillId(billId);
    setQueueError('');
    setGenerationFeedback(previous => ({ ...previous, [receiptId]: 'Scoring this submission against the bill’s extracted committee report…' }));
    try {
      const generated = await api.generateMatches(billId);
      const forReceipt = generated.matches.filter(match => match.receipt_ref === receiptId);
      if (forReceipt.length) {
        setRecentGeneratedMatches(previous => {
          const byId = new Map(previous.map(match => [match.id, match]));
          for (const match of forReceipt) byId.set(match.id, match);
          return [...byId.values()];
        });
        setGenerationFeedback(previous => ({ ...previous, [receiptId]: `Scoring complete: ${forReceipt.length} proposal${forReceipt.length === 1 ? '' : 's'} created. Review the score and report entry below, then confirm or reject.` }));
      } else {
        setGenerationFeedback(previous => ({ ...previous, [receiptId]: 'Scoring completed, but no new proposal was returned for this submission. Check that the report has extracted entries and that a proposal is not already pending or previously reviewed.' }));
      }
      const [snapshot, pending, queueReceipts] = await Promise.all([api.bootstrap(), api.pendingMatches(), api.reviewQueueReceipts()]);
      dispatch({ type: 'HYDRATE', payload: {
        bills: snapshot.bills,
        receipts: queueReceipts.receipts,
        reports: snapshot.reports,
        reportEntries: snapshot.report_entries,
        matches: [...snapshot.matches.filter(match => match.reviewer_decision !== 'pending'), ...pending.matches],
      } });
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'Unable to generate match proposals.');
    } finally {
      setGeneratingBillId(null);
    }
  };

  const retryExtractionForReceipt = async (receiptId: string, reportId: string) => {
    setExtractingReportId(reportId);
    setGenerationFeedback(previous => ({ ...previous, [receiptId]: 'Re-extracting the official Parliament PDF one page at a time…' }));
    try {
      const result = await api.retryReportExtraction(reportId);
      const proposals = result.matches.filter(match => match.receipt_ref === receiptId);
      if (proposals.length) {
        setRecentGeneratedMatches(previous => {
          const byId = new Map(previous.map(match => [match.id, match]));
          proposals.forEach(match => byId.set(match.id, match));
          return [...byId.values()];
        });
      }
      setGenerationFeedback(previous => ({
        ...previous,
        [receiptId]: result.entries_extracted
          ? `Extracted ${result.entries_extracted} reviewable report entr${result.entries_extracted === 1 ? 'y' : 'ies'}.${proposals.length ? ` Created ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}; review the score below.` : ' No proposal was returned for this submission; check the bill reference and existing moderation decisions.'}`
          : 'The Parliament PDF still yielded no reviewable entries. Check the backend extraction log and confirm the linked report is the correct bill report.',
      }));
      const [snapshot, pending, queueReceipts] = await Promise.all([api.bootstrap(), api.pendingMatches(), api.reviewQueueReceipts()]);
      dispatch({ type: 'HYDRATE', payload: {
        bills: snapshot.bills,
        receipts: queueReceipts.receipts,
        reports: snapshot.reports,
        reportEntries: snapshot.report_entries,
        matches: [...snapshot.matches.filter(match => match.reviewer_decision !== 'pending'), ...pending.matches],
      } });
    } catch (error) {
      setGenerationFeedback(previous => ({ ...previous, [receiptId]: error instanceof Error ? error.message : 'Unable to extract the linked report PDF.' }));
    } finally {
      setExtractingReportId(null);
    }
  };

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Moderation</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Match Review <span className="gradient-text">Queue</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Review proposed matches between citizen submissions and committee report entries. Nothing is published until you confirm a match.
      </p>

      {queueLoading && <p role="status" className="mb-4 text-sm font-semibold text-surface-500">Refreshing matches from the live review queue…</p>}
      {queueError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{queueError}</div>}
      {decisionError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{decisionError}</div>}

      {!state.currentUser && (
        <DisclaimerBox className="!p-5 mb-6">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 mt-0.5 flex-shrink-0 text-warm-600" />
            <p className="text-sm text-surface-700 font-medium">Sign in as a reviewer to review matches.</p>
          </div>
        </DisclaimerBox>
      )}

      <Card className="!p-7 md:!p-8 relative overflow-hidden mb-8">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/60 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-md shadow-primary-500/30">
              <Clock className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Awaiting Action</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Pending Review ({pendingMatches.length})</h2>
            </div>
          </div>

          {pendingMatches.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-10 w-10 text-surface-400" />
              </div>
              <p className="text-lg font-semibold text-surface-700 mb-1">All caught up!</p>
              <p className="text-surface-500">No matches pending review. New proposals appear here after a report is ingested or a submission arrives for a bill with an existing report.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {pendingMatches.map((match, i) => {
                const receipt = state.receipts.find(r => r.id === match.receipt_ref);
                const entry = state.reportEntries.find(e => e.id === match.report_entry_ref);
                const bill = receipt ? state.bills.find(b => b.id === receipt.legislative_item_id) : null;
                const confidencePct = Math.round(match.confidence_score * 100);

                return (
                  <motion.div
                    key={match.id}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: i * 0.04 }}
                  >
                    <Card className="!p-0 relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-warm-400 to-warm-600" />
                      <div className="p-5 md:p-6">
                        <div className="flex flex-wrap items-center gap-3 mb-5">
                          <Badge variant="warm" showIcon>{match.match_method}</Badge>
                          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                            <span className="text-xs font-bold uppercase tracking-wider text-surface-500">Confidence</span>
                            <div className="flex-1 h-2.5 rounded-full bg-surface-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${confidenceBarClass(match.confidence_score)} transition-all`}
                                style={{ width: `${confidencePct}%` }}
                              />
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${confidenceClasses(match.confidence_score)}`}>{confidenceLabel(match.confidence_score)} · {confidencePct}%</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                          <div className="bg-gradient-to-br from-warm-50 to-warm-100/60 rounded-xl p-4 border border-warm-100">
                            <div className="flex items-center gap-2 mb-2">
                              <Users className="h-4 w-4 text-warm-600" />
                              <span className="text-xs font-black uppercase tracking-[0.15em] text-warm-700">Citizen Submission</span>
                            </div>
                            {receipt?.public_id && (
                              <p className="text-sm font-mono font-bold text-primary-700 mb-2 bg-white/60 inline-block px-2 py-0.5 rounded">{receipt.public_id}</p>
                            )}
                            <p className="text-sm text-surface-800 leading-relaxed mb-2">{receipt?.submission_text}</p>
                            {receipt?.clause_ref && (
                              <p className="text-xs font-medium text-warm-700 mt-1 flex items-center gap-1">
                                <FileText className="h-3.5 w-3.5" /> Clause: {receipt.clause_ref}
                              </p>
                            )}
                            {bill && <p className="text-xs text-surface-600 mt-1">Bill: {bill.title}</p>}
                          </div>
                          <div className="bg-gradient-to-br from-primary-50 to-primary-100/60 rounded-xl p-4 border border-primary-100">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-4 w-4 text-primary-600" />
                              <span className="text-xs font-black uppercase tracking-[0.15em] text-primary-700">Report Entry</span>
                            </div>
                            <p className="text-sm text-surface-800 leading-relaxed mb-2">{entry?.extracted_summary}</p>
                            {entry?.clause_ref && (
                              <p className="text-xs font-medium text-primary-700 mt-1 flex items-center gap-1">
                                <FileText className="h-3.5 w-3.5" /> Clause: {entry.clause_ref}
                              </p>
                            )}
                            <p className="text-xs text-surface-600 mt-1">Committee outcome: <span className="font-semibold">{entry?.treatment || 'not classified'}</span></p>
                            <p className="text-xs text-surface-500 mt-1">Your decision confirms or rejects this match only; it does not determine whether the committee adopted the submission.</p>
                          </div>
                        </div>

                        <InfoBox className="!p-5 mb-5">
                          <div className="flex items-start gap-3">
                            <Sparkles className="h-5 w-5 mt-0.5 flex-shrink-0 text-accent-600" />
                            <div className="pl-0">
                              <p className="text-xs font-black uppercase tracking-[0.15em] text-accent-700 mb-1.5">Match Explanation</p>
                              <p className="text-sm text-surface-800 leading-relaxed">{match.explanation}</p>
                            </div>
                          </div>
                        </InfoBox>

                        {canModerate && entry && <ReportTreatmentEditor entry={entry} />}

                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => handleDecision(match.id, 'confirmed')}
                            disabled={!state.currentUser || decisionMatchId !== null}
                            className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 !bg-gradient-to-r !from-green-600 !to-emerald-700 !border-green-700 hover:!from-green-700 hover:!to-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <CheckCircle2 className="h-4 w-4" /> {decisionMatchId === match.id ? 'Saving…' : 'Confirm Match'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDecision(match.id, 'rejected')}
                            disabled={!state.currentUser || decisionMatchId !== null}
                            className="btn-danger inline-flex min-h-11 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <XCircle className="h-4 w-4" /> Reject Match
                          </button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card className="!p-7 md:!p-8 relative overflow-hidden mb-8">
        <div className="inline-flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-warm-500 to-orange-600 flex items-center justify-center text-white shadow-md">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-warm-700 mb-1">Submission Triage</div>
            <h2 className="text-2xl font-black text-surface-900 tracking-tight">Submissions Without a Proposal ({unmatchedReceipts.length})</h2>
          </div>
        </div>
        {unmatchedReceipts.length === 0 ? (
          <p className="text-sm text-surface-500">Every visible submission has a match proposal or a recorded moderation decision.</p>
        ) : (
          <div className="space-y-3">
            {unmatchedReceipts.map(receipt => {
              const bill = state.bills.find(item => item.id === receipt.legislative_item_id);
              const billReports = state.reports.filter(report => report.bill_ref === receipt.legislative_item_id);
              const reportAvailable = billReports.length > 0;
              const reportNeedingExtraction = billReports.find(report => report.source_url && !state.reportEntries.some(entry => entry.report_ref === report.id));
              const houseKey = (value?: string) => value?.toLowerCase().includes('senate') ? 'senate' : value?.toLowerCase().includes('national assembly') || value?.toLowerCase() === 'na' ? 'na' : value?.toLowerCase();
              const reportReferenceMismatch = billReports.some(report =>
                (report.bill_year != null && bill?.bill_year != null && report.bill_year !== bill.bill_year) ||
                (report.bill_number != null && bill?.bill_number != null && report.bill_number !== bill.bill_number) ||
                (report.bill_house && bill?.bill_house && houseKey(report.bill_house) !== houseKey(bill.bill_house))
              );
              const reportEntriesAvailable = !reportReferenceMismatch && state.reportEntries.some(entry => billReports.some(report => report.id === entry.report_ref));
              return (
                <div key={receipt.id} className="rounded-xl border border-surface-200 bg-white p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-primary-700 mb-1">{receipt.public_id || receipt.id}</p>
                    <p className="text-sm text-surface-800 leading-relaxed">{receipt.submission_text}</p>
                    <p className="text-xs text-surface-500 mt-2">Bill: {bill?.title || 'Bill information unavailable'} · {reportReferenceMismatch ? 'The official report house/number/year conflicts with this bill; verify the report link before matching.' : !reportAvailable ? 'No linked committee report yet; awaiting report and triage follow-up.' : !reportEntriesAvailable ? 'A report is linked, but its contents have not been extracted into reviewable entries.' : 'Report entries are available; no proposal is currently recorded.'}</p>
                  </div>
                  {!reportReferenceMismatch && reportNeedingExtraction && canModerate && (
                    <button type="button" onClick={() => retryExtractionForReceipt(receipt.id, reportNeedingExtraction.id)} disabled={extractingReportId !== null} className="btn-secondary inline-flex min-h-10 shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                      <FileText className="h-4 w-4" /> {extractingReportId === reportNeedingExtraction.id ? 'Extracting PDF…' : 'Retry PDF extraction'}
                    </button>
                  )}
                  {reportEntriesAvailable && bill && canModerate && (
                    <button type="button" onClick={() => generateForReceipt(receipt.id, bill.id)} disabled={generatingBillId !== null} className="btn-secondary inline-flex min-h-10 shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                      <Sparkles className="h-4 w-4" /> {generatingBillId === bill.id ? 'Scoring…' : 'Generate AI proposal'}
                    </button>
                  )}
                  {generationFeedback[receipt.id] && <p role="status" className="w-full text-sm font-semibold text-primary-700">{generationFeedback[receipt.id]}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {recentGeneratedMatches.length > 0 && (
        <Card className="!p-7 md:!p-8 relative overflow-hidden mb-8 border border-accent-200">
          <div className="inline-flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-accent-500 to-primary-600 flex items-center justify-center text-white shadow-md"><Sparkles className="h-5 w-5" /></div>
            <div><div className="text-xs font-black uppercase tracking-[0.18em] text-accent-700 mb-1">Scoring Feedback</div><h2 className="text-2xl font-black text-surface-900 tracking-tight">New proposals ({recentGeneratedMatches.length})</h2></div>
          </div>
          <div className="space-y-4">
            {recentGeneratedMatches.map(match => {
              const receipt = state.receipts.find(item => item.id === match.receipt_ref);
              const entry = state.reportEntries.find(item => item.id === match.report_entry_ref);
              const bill = receipt && state.bills.find(item => item.id === receipt.legislative_item_id);
              const score = Math.round(match.confidence_score * 100);
              return <div key={match.id} className="rounded-xl border border-surface-200 bg-white p-4 md:p-5">
                <div className="flex flex-wrap items-center gap-3 mb-3"><Badge variant="blue">{match.match_method}</Badge><span className="text-sm font-black text-primary-800">Proposal score: {score}%</span><span className="text-xs font-semibold text-surface-500">{bill?.title || 'Bill'}</span></div>
                <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-100"><div className={`h-full rounded-full ${confidenceBarClass(match.confidence_score)}`} style={{ width: `${score}%` }} /></div>
                <p className="text-sm font-semibold text-surface-700 mb-1">Report entry: {entry?.clause_ref || 'Entry'}{entry?.treatment && entry.treatment !== 'unclassified' ? ` · ${entry.treatment}` : entry?.treatment === 'unclassified' ? ' · Treatment unclassified' : ''}</p>
                <p className="text-sm text-surface-700 leading-relaxed mb-2">{entry?.extracted_summary || 'Report entry details are loading.'}</p>
                <p className="text-xs text-surface-600 leading-relaxed mb-4">{match.explanation}</p>
                {canModerate && entry && <ReportTreatmentEditor entry={entry} />}
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => handleDecision(match.id, 'confirmed')} disabled={!canModerate || decisionMatchId !== null} className="btn-primary inline-flex min-h-10 items-center gap-2 !bg-gradient-to-r !from-green-600 !to-emerald-700 disabled:opacity-60"><CheckCircle2 className="h-4 w-4" />{decisionMatchId === match.id ? 'Saving…' : 'Confirm Match'}</button>
                  <button type="button" onClick={() => handleDecision(match.id, 'rejected')} disabled={!canModerate || decisionMatchId !== null} className="btn-danger inline-flex min-h-10 items-center gap-2 disabled:opacity-60"><XCircle className="h-4 w-4" />Reject Match</button>
                </div>
              </div>;
            })}
          </div>
        </Card>
      )}

      <Card className="!p-7 md:!p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-primary-100/40 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-accent-500 to-primary-600 flex items-center justify-center text-white shadow-md shadow-accent-500/30">
              <Gavel className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Completed</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Reviewed ({reviewedMatches.length})</h2>
            </div>
          </div>

          <div className="space-y-3">
            {reviewedMatches.map((match, i) => {
              const receipt = state.receipts.find(r => r.id === match.receipt_ref);
              const entry = state.reportEntries.find(e => e.id === match.report_entry_ref);
              const isConfirmed = match.reviewer_decision === 'confirmed';

              return (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.04 }}
                >
                  <Card className="!p-0 relative overflow-hidden">
                    <div className={`absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b ${isConfirmed ? 'from-green-400 to-emerald-600' : 'from-red-400 to-rose-600'}`} />
                    <div className="p-4 md:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-primary-700 bg-primary-50 px-2 py-0.5 rounded">{receipt?.public_id}</span>
                          <span className="text-surface-400 font-bold">→</span>
                          <span className="text-sm font-semibold text-surface-700 bg-surface-50 px-2 py-0.5 rounded">{entry?.clause_ref}</span>
                          <Badge variant="blue" className="ml-1">{match.match_method}</Badge>
                        </div>
                        <Badge variant={isConfirmed ? 'green' : 'red'} showIcon>
                          {match.reviewer_decision}
                        </Badge>
                      </div>
                      <p className="text-xs text-surface-500 font-medium flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        Reviewed: {new Date(match.timestamp).toLocaleDateString()} · Confidence: {Math.round(match.confidence_score * 100)}%
                      </p>
                      <p className="text-xs text-surface-600 font-semibold mt-2">
                        {isConfirmed
                          ? `Committee outcome: ${entry?.treatment || 'not available'}${entry?.treatment === 'unclassified' ? ' — outcome classification is still needed.' : ''}`
                          : 'No confirmed report match; this rejected proposal does not establish a committee outcome.'}
                      </p>
                      {canModerate && isConfirmed && entry && <ReportTreatmentEditor entry={entry} />}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function ReportedContentPage() {
  const { state, dispatch } = useApp();

  const handleDecision = (id: string, decision: 'upheld' | 'dismissed') => {
    if (!state.currentUser) return;
    dispatch({
      type: 'UPDATE_MODERATION',
      payload: { id, decision, reviewerId: state.currentUser.id }
    });
  };

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Safety</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Reported <span className="gradient-text">Content</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Review reported content cases. No content is automatically deleted — all decisions are logged.
      </p>

      <Card className="!p-7 md:!p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-red-100/50 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-primary-100/40 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white shadow-md shadow-red-500/30">
              <Flag className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-red-600 mb-1">Case Queue</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Moderation Cases ({state.moderationActions.length})</h2>
            </div>
          </div>

          <div className="space-y-4">
            {state.moderationActions.map((action, i) => {
              const decisionBadge =
                action.decision === 'pending' ? 'yellow' :
                action.decision === 'upheld' ? 'red' : 'green';

              return (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.04 }}
                >
                  <Card className="!p-0 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-red-400 to-rose-600" />
                    <div className="p-5 md:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge variant="red" showIcon>{action.content_type}</Badge>
                          <span className="text-sm text-surface-600 font-mono font-semibold bg-surface-50 px-2.5 py-1 rounded-lg">
                            ID: {action.content_id}
                          </span>
                        </div>
                        <Badge variant={decisionBadge as any} showIcon>
                          {action.decision}
                        </Badge>
                      </div>

                      <div className="bg-gradient-to-br from-red-50/80 to-surface-50 rounded-xl p-4 border border-red-100/80 mb-4">
                        <div className="text-xs font-black uppercase tracking-[0.15em] text-red-700 mb-1.5 flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5" /> Report Reason
                        </div>
                        <p className="text-sm text-surface-800 font-medium leading-relaxed">{action.reason}</p>
                      </div>

                      <p className="text-xs text-surface-500 font-medium mb-4 flex flex-wrap items-center gap-4">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          Reported: {new Date(action.timestamp).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Gavel className="h-3.5 w-3.5" />
                          Appeal: <span className="font-bold text-surface-700">{action.appeal_status}</span>
                        </span>
                      </p>

                      {action.decision === 'pending' && state.currentUser && (
                        <div className="flex flex-wrap gap-3 pt-2 border-t border-surface-100">
                          <button
                            onClick={() => handleDecision(action.id, 'upheld')}
                            className="btn-danger inline-flex items-center gap-2 text-sm"
                          >
                            <XCircle className="h-4 w-4" /> Uphold Report
                          </button>
                          <button
                            onClick={() => handleDecision(action.id, 'dismissed')}
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Dismiss Report
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}

            {state.moderationActions.length === 0 && (
              <div className="text-center py-12">
                <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-4">
                  <Shield className="h-10 w-10 text-surface-400" />
                </div>
                <p className="text-lg font-semibold text-surface-700 mb-1">All clear</p>
                <p className="text-surface-500">No reported content cases.</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
