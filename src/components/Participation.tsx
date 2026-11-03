import React from 'react';
import { CheckCircle2, CircleDot, CircleSlash, Clock3 } from 'lucide-react';
import { LegislativeItem, ParticipationWindow } from '../types';
import { PROGRESS_STEPS, STAGE_META, normalizeStage } from '../utils/submissionStage';

type Tone = 'law' | 'open' | 'progress' | 'ended';

const ENDED = /withdrawn|lapsed|defeated|stayed|rejected/i;
const OPEN = /^(first reading|public participation|introduced)$/i;

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

/** The API sends this with every bill; older responses fall back to "accepting" (the API still enforces it). */
export function participationFor(bill?: LegislativeItem | null): ParticipationWindow {
  return bill?.participation || { status: 'open', accepting: true, reason: '' };
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
