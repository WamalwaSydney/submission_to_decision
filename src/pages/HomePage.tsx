import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ClipboardList, FileUp, FolderOpen, Gavel, Link2, MessageSquarePlus, Receipt, Settings2, ShieldCheck, Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { LegislativeItem, ParticipationReceipt, SubmissionMatch, User } from '../types';
import { StatusBadge } from '../components/UI';
import { Deadline, StagePill, participationFor } from '../components/Participation';
import { OUTCOME_STAGES, PROGRESS_STEPS, STAGE_META } from '../utils/submissionStage';

// ---------- shared pieces ----------

function Hero({ kicker, title, lead, children }: { kicker: string; title: React.ReactNode; lead: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="home-hero">
      <p className="kicker">{kicker}</p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {children && <div className="actions">{children}</div>}
    </section>
  );
}

function Tile({ value, label, note, tone, to }: { value: React.ReactNode; label: string; note?: string; tone: 'red' | 'green' | 'black' | 'gold'; to?: string }) {
  const body = <><strong>{value}</strong><span>{label}</span>{note && <small>{note}</small>}</>;
  return to ? <Link to={to} className={`stat-tile is-${tone}`}>{body}</Link> : <div className={`stat-tile is-${tone}`}>{body}</div>;
}

function SectionHead({ title, note, link }: { title: string; note?: string; link?: { to: string; label: string } }) {
  return (
    <div className="home-section-head">
      <div><h2>{title}</h2>{note && <p>{note}</p>}</div>
      {link && <Link to={link.to}>{link.label} →</Link>}
    </div>
  );
}

function QuickAction({ to, icon: Icon, title, note }: { to: string; icon: React.ElementType; title: string; note: string }) {
  return (
    <Link to={to} className="quick-action">
      <span className="icon"><Icon size={20} aria-hidden="true" /></span>
      <span><strong>{title}</strong><small>{note}</small></span>
    </Link>
  );
}

function committeeName(state: ReturnType<typeof useApp>['state'], bill: LegislativeItem) {
  return state.committees.find(c => c.id === bill.committee_id)?.name || bill.institution;
}

/** Open bills, soonest closing date first; bills with no published deadline last. */
function useOpenBills() {
  const { state } = useApp();
  return useMemo(() => state.bills
    .filter(bill => participationFor(bill).accepting)
    .sort((a, b) => (participationFor(a).closes_on || '9999').localeCompare(participationFor(b).closes_on || '9999') || a.title.localeCompare(b.title)),
  [state.bills]);
}

function OpenBillsList({ limit = 6, submittedBillIds = new Set<string>() }: { limit?: number; submittedBillIds?: Set<string> }) {
  const { state } = useApp();
  const open = useOpenBills();
  return (
    <section>
      <SectionHead title="Open for your views now" note={state.isLoading ? 'Loading bills…' : `${open.length} ${open.length === 1 ? 'bill is' : 'bills are'} with a committee for public participation.`} link={{ to: '/bills?open=1', label: 'See all open bills' }} />
      <div className="list-card">
        {open.slice(0, limit).map(bill => (
          <Link key={bill.id} to={`/bills/${bill.id}`} className="list-row">
            <div className="main"><strong>{bill.title}</strong><small>{committeeName(state, bill)} · {bill.identifier}</small></div>
            <div className="side">
              <Deadline participation={participationFor(bill)} />
              <span className="action-button is-secondary !min-h-9 !py-1.5 !px-3 !text-sm">{submittedBillIds.has(bill.id) ? 'Edit your view' : 'Give your view'}</span>
            </div>
          </Link>
        ))}
        {!open.length && <p className="empty-note">{state.isLoading ? 'Loading bills…' : 'No bill is open for public participation right now. Committees take views after a bill’s First Reading — check back soon.'}</p>}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section>
      <SectionHead title="How it works" />
      <div className="steps">
        <div className="step"><h3>Read the bill</h3><p>Every bill shows its stage in Parliament, the official documents, and whether its committee is taking public views.</p></div>
        <div className="step"><h3>Give your view</h3><p>Type your view or upload your memorandum. You can make one submission per bill and edit it until the call for views closes.</p></div>
        <div className="step"><h3>Track what happens</h3><p>You get a tamper-evident receipt. When the committee reports, the platform finds its response and a moderator checks it.</p></div>
      </div>
    </section>
  );
}

function Journey() {
  return (
    <section>
      <SectionHead title="What happens to your view" note="Every submission moves through the same stages, from the moment you send it to the committee's answer." />
      <div className="list-card">
        {PROGRESS_STEPS.slice(0, 4).map((label, index) => {
          const stage = (['received', 'with_committee', 'report_published', 'under_review'] as const)[index];
          return (
            <div key={label} className="list-row">
              <div className="main"><strong>{index + 1}. {STAGE_META[stage].label}</strong><small>{STAGE_META[stage].description}</small></div>
            </div>
          );
        })}
        <div className="list-row">
          <div className="main"><strong>5. The outcome</strong><small>What the committee's report says about your view. These are records of the report, not legal findings.</small></div>
          <div className="side">{OUTCOME_STAGES.map(stage => <StatusBadge key={stage} status={stage} />)}</div>
        </div>
      </div>
    </section>
  );
}

// ---------- visitor ----------

function VisitorHome() {
  const { state } = useApp();
  const open = useOpenBills();
  const responses = state.matches.filter(m => m.reviewer_decision === 'confirmed').length;
  return (
    <div className="home">
      <Hero kicker="Public participation · Kenya" title={<>Have your say on the laws <span className="gradient-text">being made for Kenya</span></>}
        lead="Find the bills Parliament's committees are asking the public about, send your view in a few minutes, and see what the committee did with it.">
        <Link to="/bills?open=1" className="action-button is-primary">See bills open for views <ArrowRight aria-hidden="true" /></Link>
        <Link to="/receipt-lookup" className="action-button is-secondary">Track a submission</Link>
      </Hero>
      <div className="stat-tiles">
        <Tile tone="green" value={state.isLoading ? '…' : open.length} label="Bills open for views" note="Committees are collecting public views on these now." to="/bills?open=1" />
        <Tile tone="red" value={state.isLoading ? '…' : state.receipts.length} label="Views submitted" note="Each one has a tamper-evident receipt." />
        <Tile tone="black" value={state.isLoading ? '…' : responses} label="Committee responses traced" note="Checked by a moderator against the report." />
      </div>
      <OpenBillsList />
      <HowItWorks />
      <Journey />
      <section className="quick-actions">
        <QuickAction to="/signup" icon={Users} title="Create a free account" note="You need an account to submit, so you can edit your view and get updates." />
        <QuickAction to="/receipt-verify" icon={ShieldCheck} title="Verify hash chain" note="Confirm no submission has been changed since it was sent." />
        <QuickAction to="/notices" icon={FolderOpen} title="Calls for views" note="See each committee's published call for memoranda and its deadline." />
      </section>
    </div>
  );
}

// ---------- citizen ----------

function CitizenHome({ user }: { user: User }) {
  const { state, getSubmissionStatus } = useApp();
  const [mine, setMine] = useState<ParticipationReceipt[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.myReceipts().then(result => { if (!cancelled) setMine(result.receipts); }).catch(() => { if (!cancelled) setMine([]); });
    return () => { cancelled = true; };
  }, [state.receipts.length]);
  const receipts = (mine || []).slice().sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const stages = receipts.map(r => getSubmissionStatus(r.id));
  const outcomes = stages.filter(stage => OUTCOME_STAGES.includes(stage)).length;
  const firstName = user.name.split(' ')[0];
  return (
    <div className="home">
      <Hero kicker="Your participation" title={<>Karibu, {firstName}</>}
        lead="Give your view on bills that are open, and follow each submission until the committee responds.">
        <Link to="/bills?open=1" className="action-button is-primary">Find a bill to comment on <ArrowRight aria-hidden="true" /></Link>
        <Link to="/my-receipts" className="action-button is-secondary">My submissions</Link>
      </Hero>
      <div className="stat-tiles">
        <Tile tone="red" value={mine ? receipts.length : '…'} label="Your submissions" to="/my-receipts" />
        <Tile tone="gold" value={mine ? receipts.length - outcomes : '…'} label="Waiting for the committee" note="Received, with the committee, or being checked." />
        <Tile tone="green" value={mine ? outcomes : '…'} label="Outcomes recorded" note="The committee's report has answered these." />
      </div>
      <section>
        <SectionHead title="Your latest submissions" link={receipts.length ? { to: '/my-receipts', label: 'See all' } : undefined} />
        <div className="list-card">
          {receipts.slice(0, 4).map((receipt, index) => {
            const bill = state.bills.find(b => b.id === receipt.legislative_item_id);
            return (
              <Link key={receipt.id} to={`/receipt-lookup?id=${receipt.public_id}`} className="list-row">
                <div className="main"><strong>{bill?.title || 'Bill'}</strong><small className="font-mono">{receipt.public_id}</small></div>
                <div className="side"><StatusBadge status={stages[index]} /></div>
              </Link>
            );
          })}
          {mine && !receipts.length && <p className="empty-note">You haven't made a submission yet. Pick an open bill below to give your first view.</p>}
          {!mine && <p className="empty-note">Loading your submissions…</p>}
        </div>
      </section>
      <OpenBillsList limit={5} submittedBillIds={new Set(receipts.map(r => r.legislative_item_id))} />
      <section className="quick-actions">
        <QuickAction to="/submit" icon={MessageSquarePlus} title="Give your view" note="Type it or upload your memorandum." />
        <QuickAction to="/messages" icon={Receipt} title="Updates" note="Messages when your submission moves to a new stage." />
        <QuickAction to="/receipt-verify" icon={ShieldCheck} title="Verify hash chain" note="Confirm your submission is unchanged." />
      </section>
    </div>
  );
}

// ---------- Clerk's Office / committee secretariat ----------

function CommitteeHome({ user }: { user: User }) {
  const { state } = useApp();
  const committee = state.committees.find(c => c.id === user.committee_id);
  const bills = state.bills.filter(bill => user.committee_id && bill.committee_id === user.committee_id);
  const nextStep = (bill: LegislativeItem) => {
    const reports = state.reports.filter(report => report.bill_ref === bill.id);
    const submissions = state.receipts.filter(receipt => receipt.legislative_item_id === bill.id).length;
    if (participationFor(bill).accepting) return { label: `Collecting views · ${submissions} so far`, tone: 'is-later', to: `/bills/${bill.id}` };
    if (!reports.length) return { label: 'Upload the committee report', tone: 'is-soon', to: '/committee/ingestion' };
    if (reports.some(report => report.extraction_status !== 'verified')) return { label: 'Check and verify the report', tone: 'is-soon', to: '/committee/ingestion' };
    return { label: 'Report verified', tone: 'is-none', to: `/bills/${bill.id}` };
  };
  const steps = bills.map(bill => ({ bill, step: nextStep(bill) }));
  const needsReport = steps.filter(item => item.step.label === 'Upload the committee report').length;
  const needsCheck = steps.filter(item => item.step.label === 'Check and verify the report').length;
  const sorted = [...steps].sort((a, b) => Number(b.step.tone === 'is-soon') - Number(a.step.tone === 'is-soon'));
  return (
    <div className="home">
      <Hero kicker="Clerk's Office · Committee secretariat" title={committee?.name || 'Your committee workspace'}
        lead={user.committee_id ? 'Publish calls for views, upload the committee report when it is tabled, and check that each response is recorded correctly.' : 'Your account is not linked to a committee yet. An administrator must link it before you can manage bills.'}>
        <Link to="/committee/ingestion" className="action-button is-primary"><FileUp aria-hidden="true" /> Upload a report</Link>
        <Link to="/committee/notices" className="action-button is-secondary">Publish a call for views</Link>
      </Hero>
      <div className="stat-tiles">
        <Tile tone="black" value={bills.length} label="Bills assigned to your committee" to="/committee" />
        <Tile tone="green" value={bills.filter(bill => participationFor(bill).accepting).length} label="Collecting public views" />
        <Tile tone="red" value={needsReport} label="Waiting for your report" note="Views have closed; no report uploaded yet." to="/committee/ingestion" />
        <Tile tone="gold" value={needsCheck} label="Reports to check" note="Confirm each extracted response before it is shown." to="/committee/ingestion" />
      </div>
      <section>
        <SectionHead title="Your committee's bills" note="What each bill needs from you next." link={{ to: '/committee', label: 'Open bill ingestion' }} />
        <div className="list-card">
          {sorted.slice(0, 8).map(({ bill, step }) => (
            <Link key={bill.id} to={step.to} className="list-row">
              <div className="main"><strong>{bill.title}</strong><small>{bill.identifier}</small></div>
              <div className="side"><StagePill stage={bill.stage} /><span className={`deadline ${step.tone}`}>{step.label}</span></div>
            </Link>
          ))}
          {!bills.length && <p className="empty-note">{committee ? 'No bills are assigned to your committee yet.' : 'Ask an administrator to link your account to your committee.'}</p>}
        </div>
      </section>
    </div>
  );
}

// ---------- moderator ----------

function ModeratorHome() {
  const { state } = useApp();
  const [pending, setPending] = useState<SubmissionMatch[] | null>(null);
  const [cases, setCases] = useState<any[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.pendingMatches().then(r => { if (!cancelled) setPending(r.matches); }).catch(() => { if (!cancelled) setPending([]); });
    api.moderationCases().then(r => { if (!cancelled) setCases(r.cases); }).catch(() => { if (!cancelled) setCases([]); });
    return () => { cancelled = true; };
  }, []);
  const billsWithReports = new Set(state.reports.map(report => report.bill_ref));
  const unmatched = state.receipts.filter(receipt => billsWithReports.has(receipt.legislative_item_id) && !state.matches.some(m => m.receipt_ref === receipt.id)).length;
  const openCases = (cases || []).filter(item => item.decision === 'pending');
  return (
    <div className="home">
      <Hero kicker="Moderation" title="Check that each response really answers the view"
        lead="The platform proposes where a committee report responds to a submission. You confirm or reject each proposal, and handle submissions citizens have reported.">
        <Link to="/reviewer/queue" className="action-button is-primary"><ClipboardList aria-hidden="true" /> Review proposed matches</Link>
        <Link to="/reviewer/reports" className="action-button is-secondary">Reported submissions</Link>
      </Hero>
      <div className="stat-tiles">
        <Tile tone="red" value={pending ? pending.length : '…'} label="Proposed matches to check" to="/reviewer/queue" />
        <Tile tone="gold" value={cases ? openCases.length : '…'} label="Reported submissions" note="Waiting for your decision." to="/reviewer/reports" />
        <Tile tone="black" value={unmatched} label="Submissions with no proposal yet" note="Their bill has a report, but no response was proposed." to="/reviewer/queue" />
      </div>
      <section>
        <SectionHead title="Next proposals to check" link={pending?.length ? { to: '/reviewer/queue', label: 'Open the queue' } : undefined} />
        <div className="list-card">
          {(pending || []).slice(0, 5).map(match => {
            const receipt = state.receipts.find(r => r.id === match.receipt_ref);
            const flagged = /^Warning for moderators/.test(match.explanation || '');
            return (
              <Link key={match.id} to="/reviewer/queue" className="list-row">
                <div className="main"><strong className="font-mono">{receipt?.public_id || 'Submission'}</strong><small>{(match.explanation || '').slice(0, 140)}</small></div>
                <div className="side">{flagged && <span className="deadline is-soon">Flagged: possible AI manipulation</span>}<span className="deadline is-none">{Math.round(match.confidence_score * 100)}% AI score</span></div>
              </Link>
            );
          })}
          {pending && !pending.length && <p className="empty-note">Nothing to check right now.</p>}
          {!pending && <p className="empty-note">Loading…</p>}
        </div>
      </section>
    </div>
  );
}

// ---------- administrator ----------

function AdminHome() {
  const { state } = useApp();
  const [users, setUsers] = useState<User[] | null>(null);
  const [chain, setChain] = useState<{ valid: boolean; total_checked: number; broken_count?: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.users().then(r => { if (!cancelled) setUsers(r.users); }).catch(() => { if (!cancelled) setUsers([]); });
    api.verifyChain().then(r => { if (!cancelled) setChain(r); }).catch(() => { if (!cancelled) setChain(null); });
    return () => { cancelled = true; };
  }, []);
  const awaiting = (users || []).filter(user => user.status === 'pending_approval');
  const unassigned = state.bills.filter(bill => !bill.committee_id && participationFor(bill).accepting).length;
  return (
    <div className="home">
      <Hero kicker="Administration" title="Keep the platform trustworthy"
        lead="Approve Clerk's Office accounts, make sure open bills are assigned to the right committee, and keep an eye on the receipt chain.">
        <Link to="/admin" className="action-button is-primary"><Settings2 aria-hidden="true" /> Open administration</Link>
        <Link to="/receipt-verify" className="action-button is-secondary">Check the receipt chain</Link>
      </Hero>
      <div className="stat-tiles">
        <Tile tone="red" value={users ? awaiting.length : '…'} label="Accounts awaiting approval" note="Clerk's Office access requests." to="/admin" />
        <Tile tone="gold" value={unassigned} label="Open bills with no committee" note="Committee staff cannot manage these until assigned." to="/admin?tab=assignments" />
        <Tile tone="black" value={state.committees.length} label="Committees" />
        <Tile tone={chain?.valid ? 'green' : 'red'} value={chain ? (chain.valid ? 'Intact' : `${chain.broken_count ?? '?'} broken`) : '…'} label="Receipt chain" note={chain ? `${chain.total_checked} receipts checked` : undefined} to="/receipt-verify" />
      </div>
      {awaiting.length > 0 && (
        <section>
          <SectionHead title="Waiting for your approval" link={{ to: '/admin', label: 'Review requests' }} />
          <div className="list-card">
            {awaiting.slice(0, 5).map(user => (
              <Link key={user.id} to="/admin" className="list-row">
                <div className="main"><strong>{user.name}</strong><small>{user.email}</small></div>
                <div className="side"><span className="deadline is-soon">Clerk's Office access request</span></div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="quick-actions">
        <QuickAction to="/admin" icon={Users} title="Users and roles" note="Approve, suspend or change roles." />
        <QuickAction to="/admin?tab=assignments" icon={FolderOpen} title="Committee assignments" note="Confirm which committee handles each bill." />
        <QuickAction to="/bills" icon={Gavel} title="Bills" note="Browse the live bill catalogue." />
        <QuickAction to="/receipt-verify" icon={Link2} title="Receipt chain" note="Verify every receipt ever issued." />
      </section>
    </div>
  );
}

// ---------- entry ----------

export function HomePage() {
  const { state } = useApp();
  const user = state.currentUser;
  if (!user) return <VisitorHome />;
  if (user.role === 'citizen') return <CitizenHome user={user} />;
  if (user.role === 'committee_officer') return <CommitteeHome user={user} />;
  if (user.role === 'reviewer' || user.role === 'moderator') return <ModeratorHome />;
  if (user.role === 'administrator') return <AdminHome />;
  return <VisitorHome />;
}

