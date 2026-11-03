/**
 * Where a citizen's submission is, from the moment it is sent to the outcome.
 *
 * It follows how the platform works:
 * 1. received        – recorded with a receipt while the committee is still taking views
 * 2. with_committee  – the call for views has closed; the committee is preparing its report
 * 3. report_published – the report is out; the platform is reading it to find the response
 * 4. under_review    – a possible response was found; a moderator is checking it
 * 5. an outcome      – adopted, amended, rejected (with the committee's reason) or not addressed
 *
 * A moderator rejecting a proposed match means the report does not respond to
 * the submission. That is "not addressed", not a rejection by the committee.
 */
import type { ReportEntry, SubmissionMatch } from '../types';

export type SubmissionStage =
  | 'received'
  | 'with_committee'
  | 'report_published'
  | 'under_review'
  | 'adopted'
  | 'amended'
  | 'rejected'
  | 'not_addressed';

export type StageTone = 'progress' | 'success' | 'info' | 'danger' | 'neutral';

export const STAGE_META: Record<SubmissionStage, { label: string; description: string; tone: StageTone; step: number }> = {
  received: { label: 'Received', description: 'Your view is on record. The committee is still collecting views on this bill.', tone: 'progress', step: 1 },
  with_committee: { label: 'With the committee', description: 'The call for views has closed. The committee is considering the views and preparing its report.', tone: 'progress', step: 2 },
  report_published: { label: 'Report published', description: "The committee's report is out. The platform is reading it to find the committee's response to this view.", tone: 'progress', step: 3 },
  under_review: { label: 'Response under review', description: "A possible response was found in the committee's report. A moderator is checking that it really answers this view.", tone: 'progress', step: 4 },
  adopted: { label: 'Adopted', description: 'The committee accepted this view in its report.', tone: 'success', step: 5 },
  amended: { label: 'Amended', description: 'The committee recommended amending the bill in response to this view.', tone: 'info', step: 5 },
  rejected: { label: 'Rejected, with reasons', description: 'The committee considered this view and gave reasons for not adopting it.', tone: 'danger', step: 5 },
  not_addressed: { label: 'Not addressed in the report', description: "The committee's report does not respond to this view.", tone: 'neutral', step: 5 },
};

export const STAGE_ORDER: SubmissionStage[] = ['received', 'with_committee', 'report_published', 'under_review', 'adopted', 'amended', 'rejected', 'not_addressed'];
export const PROGRESS_STEPS = ['Received', 'With the committee', 'Report published', 'Response checked', 'Outcome'];
export const OUTCOME_STAGES: SubmissionStage[] = ['adopted', 'amended', 'rejected', 'not_addressed'];

/** The committee's treatment of a report entry, as a citizen-facing outcome. */
export function treatmentStage(treatment?: string | null): SubmissionStage {
  if (treatment === 'amended') return 'amended';
  if (treatment === 'rejected with reasons') return 'rejected';
  if (treatment === 'not addressed') return 'not_addressed';
  // A confirmed match is adopted unless the report records something else.
  return 'adopted';
}

export function submissionStage(args: {
  receiptId: string;
  matches: SubmissionMatch[];
  entries: ReportEntry[];
  reportPublished: boolean;
  acceptingViews: boolean;
}): SubmissionStage {
  const own = args.matches.filter(match => match.receipt_ref === args.receiptId);
  const confirmed = own.find(match => match.reviewer_decision === 'confirmed');
  if (confirmed) return treatmentStage(args.entries.find(entry => entry.id === confirmed.report_entry_ref)?.treatment);
  if (own.some(match => match.reviewer_decision === 'pending')) return 'under_review';
  if (own.some(match => match.reviewer_decision === 'rejected')) return 'not_addressed';
  if (args.reportPublished) return 'report_published';
  return args.acceptingViews ? 'received' : 'with_committee';
}

/** Accept older API values too, so a stale cache never shows a raw key. */
export function normalizeStage(value: string | null | undefined): SubmissionStage {
  if (value && value in STAGE_META) return value as SubmissionStage;
  if (value === 'rejected with reasons') return 'rejected';
  if (value === 'not addressed') return 'not_addressed';
  if (value === 'amended' || value === 'adopted') return value;
  return 'received';
}
