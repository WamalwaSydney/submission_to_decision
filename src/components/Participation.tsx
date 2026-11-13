import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDot, CircleSlash, Clock3 } from 'lucide-react';
import { LegislativeItem, NoticeRecord, ParticipationWindow } from '../types';
import { PROGRESS_STEPS, STAGE_META, normalizeStage } from '../utils/submissionStage';

type Tone = 'law' | 'open' | 'progress' | 'ended';

const ENDED = /withdrawn|lapsed|defeated|stayed|rejected/i;
const OPEN = /^public participation$/i;

export function stageTone(stage: string): Tone {
  if (/^assented$/i.test(stage)) return 'law';
  if (ENDED.test(stage)) return 'ended';
  if (OPEN.test(stage.trim())) return 'open';
  return 'progress';
}

const TONE_ICON: Record<Tone, React.ElementType> = {
  law: CheckCircle2,
  open: CircleDot,
  progress: Clock3,
  ended: CircleSlash,
};

export function StagePill({ stage, asAt, className = '' }: { stage: string; asAt?: string; className?: string }) {
  const tone = stageTone(stage);
  const Icon = TONE_ICON[tone];
  const label = /^assented$/i.test(stage) ? 'Assented — now law' : stage;
  return (
    <span className={`stage-pill is-${tone} ${className}`} title={asAt ? `Stage as at ${asAt}` : undefined}>
      <Icon size={15} strokeWidth={2.4} aria-hidden="true" />
      <span><span className="sr-only">Current stage: </span>{label}</span>
    </span>
  );
}

/** The API sends this with every bill. Without it, treat the bill as closed: never offer a submission the API may refuse. */
export function participationFor(bill?: LegislativeItem | null): ParticipationWindow {
  return bill?.participation || { status: 'closed', accepting: false, reason: 'This bill is not currently open for public participation.' };
}

export function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBytes(size?: number | null): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Received → With the committee → Report published → Response checked → Outcome. */
export function SubmissionProgress({ stage }: { stage: string }) {
  const meta = STAGE_META[normalizeStage(stage)];
  return (
    <div>
      <ol className="progress-track" aria-label={`Progress: ${meta.label}`}>
        {PROGRESS_STEPS.map((label, index) => {
          const step = index + 1;
          const state = step < meta.step || (step === 5 && meta.step === 5) ? 'is-done' : step === meta.step ? 'is-current' : '';
          return <li key={label} className={state} aria-current={step === meta.step ? 'step' : undefined}>{step === 5 && meta.step === 5 ? meta.label : label}</li>;
        })}
      </ol>
      <p className="mt-3 mb-0 text-sm text-[#3c4747] leading-relaxed">{meta.description}</p>
    </div>
  );
}

/** "Closes 10 Nov · 7 days left" for an open bill. */
export function Deadline({ participation }: { participation: ParticipationWindow }) {
  if (!participation.accepting) return <span className="deadline is-none">Closed</span>;
  if (!participation.closes_on) return <span className="deadline is-none">No closing date published</span>;
  const days = Math.ceil((new Date(`${participation.closes_on}T23:59:59`).getTime() - Date.now()) / 86_400_000);
  const left = days <= 0 ? 'last day' : days === 1 ? '1 day left' : `${days} days left`;
  return <span className={`deadline ${days <= 3 ? 'is-soon' : 'is-later'}`}>Closes {formatDate(participation.closes_on)} · {left}</span>;
}

export type EditBlock = 'reviewed' | 'closed' | null | undefined;

/**
 * Edit control for a citizen's own submission. Edits open the submit page for
 * that bill, which loads the submission and keeps its receipt ID.
 */
export function EditSubmissionAction({ billId, editable, editBlock, className = '' }: { billId: string; editable?: boolean; editBlock?: EditBlock; className?: string }) {
  if (editable) {
    return <Link to={`/submit?bill=${encodeURIComponent(billId)}`} className={`action-button is-primary ${className}`}>Edit submission</Link>;
  }
  if (!editBlock) return null;
  return (
    <p className={`text-xs font-semibold text-[#526060] m-0 ${className}`}>
      {editBlock === 'closed' ? "Editing is closed: the committee's call for views has ended." : 'Editing is closed: a moderator has reviewed this submission.'}
    </p>
  );
}

export type CallForViewsStatus = { status: 'open' | 'upcoming' | 'closed'; opens_on: string; closes_on: string };

/** The committee's published call for memoranda, if the bill has one: open now, upcoming, or closed. */
export function callForViews(notices: NoticeRecord[], today = new Date()): CallForViewsStatus | null {
  if (!notices.length) return null;
  const day = today.toISOString().slice(0, 10);
  const windows = notices.map(n => ({ opens_on: n.window_start.slice(0, 10), closes_on: n.window_end.slice(0, 10) }));
  const open = windows.filter(w => w.opens_on <= day && day <= w.closes_on).sort((a, b) => b.closes_on.localeCompare(a.closes_on));
  if (open.length) return { status: 'open', ...open[0] };
  const upcoming = windows.filter(w => w.opens_on > day).sort((a, b) => a.opens_on.localeCompare(b.opens_on));
  if (upcoming.length) return { status: 'upcoming', ...upcoming[0] };
  const closed = [...windows].sort((a, b) => b.closes_on.localeCompare(a.closes_on));
  return { status: 'closed', ...closed[0] };
}

/** Shows a bill's call for views as its status: "Call for views open until 20 Nov". */
export function CallForViewsBadge({ call }: { call: CallForViewsStatus | null }) {
  if (!call) return null;
  const text = call.status === 'open' ? `Call for views open until ${formatDate(call.closes_on)}`
    : call.status === 'upcoming' ? `Call for views opens ${formatDate(call.opens_on)}`
    : `Call for views closed ${formatDate(call.closes_on)}`;
  return <span className={`stage-pill ${call.status === 'open' ? 'is-open' : call.status === 'upcoming' ? 'is-progress' : 'is-ended'}`}><span>{text}</span></span>;
}
