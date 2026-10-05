import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ReviewerDecision } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { CheckCircle2, XCircle, Clock, AlertTriangle, Flag, Shield, Gavel, Users, FileText, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, DisclaimerBox, InfoBox, Badge, Label, SelectField, BtnPrimary, BtnSecondary, BtnDanger } from '../components/UI';

export function ModeratorQueuePage() {
  const { state, dispatch } = useApp();
  const pendingMatches = state.matches.filter(m => m.reviewer_decision === 'pending');
  const reviewedMatches = state.matches.filter(m => m.reviewer_decision !== 'pending');

  const handleDecision = (matchId: string, decision: ReviewerDecision) => {
    if (!state.currentUser) return;
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

      {!state.currentUser && (
        <DisclaimerBox className="!p-5 mb-6">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 mt-0.5 flex-shrink-0 text-warm-600" />
            <p className="text-sm text-surface-700 font-medium">Sign in as a moderator to review matches.</p>
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
              <p className="text-surface-500">No matches pending review.</p>
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
                                className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all"
                                style={{ width: `${confidencePct}%` }}
                              />
                            </div>
                            <span className="text-sm font-black text-surface-900 tabular-nums">{confidencePct}%</span>
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
                            <p className="text-xs text-surface-600 mt-1">Treatment: <span className="font-semibold">{entry?.treatment}</span></p>
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

                        <div className="flex flex-wrap gap-3">
                          <button
                            onClick={() => handleDecision(match.id, 'confirmed')}
                            disabled={!state.currentUser}
                            className="btn-primary inline-flex items-center gap-2 !bg-gradient-to-r !from-green-500 !to-emerald-600 hover:!from-green-600 hover:!to-emerald-700 !border-green-200"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Confirm Match
                          </button>
                          <button
                            onClick={() => handleDecision(match.id, 'rejected')}
                            disabled={!state.currentUser}
                            className="btn-danger inline-flex items-center gap-2"
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
      payload: { id, decision, moderatorId: state.currentUser.id }
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
