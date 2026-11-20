import React, { useEffect, useMemo, useState } from 'react';
import { formatDate } from '../components/Participation';
import { SubmissionDetailDialog } from './BillsPages';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Download, FileText, BarChart3, Shield, AlertTriangle, Users, Eye, Clock, CheckCircle2, XCircle, Sparkles, Lock, Flag, Info, FileCheck2, Search, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts';
import { Card, DisclaimerBox, InfoBox, Badge, Label, InputField, StatusBadge, Pager, usePaged } from '../components/UI';
import { STAGE_META, STAGE_ORDER, SubmissionStage } from '../utils/submissionStage';
import { api } from '../api/endpoints';

export function ResearchExportPage() {
  const { state, getSubmissionStatus, getBillOutcomes } = useApp();

  const outcomeTotals = STAGE_ORDER.map(status => ({
    name: STAGE_META[status].label,
    count: state.bills.reduce((total, bill) => total + getBillOutcomes(bill.id).filter(item => item.status === status).reduce((sum, item) => sum + item.count, 0), 0),
  }));
  const outcomeTotal = outcomeTotals.reduce((sum, item) => sum + item.count, 0);
  const noticeMetrics = state.notices.map(notice => {
    const start = new Date(notice.window_start);
    const end = new Date(notice.window_end);
    const published = new Date(notice.notice_date);
    return {
      bill: (state.bills.find(bill => bill.id === notice.bill_ref)?.title || 'Untitled bill').slice(0, 28),
      windowDays: Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000)),
      noticeDays: Math.max(0, Math.ceil((start.getTime() - published.getTime()) / 86400000)),
    };
  });
  const exportOutcomeTrail = () => {
    const data = state.bills.map(bill => {
      const outcomes = getBillOutcomes(bill.id);
      const receipts = state.receipts.filter(r => r.legislative_item_id === bill.id);
      return {
        bill_id: bill.id,
        bill_title: bill.title,
        identifier: bill.identifier,
        institution: bill.institution,
        stage: bill.stage,
        total_submissions: receipts.length,
        outcomes: outcomes.reduce((acc, o) => ({ ...acc, [o.status]: o.count }), {} as Record<string, number>),
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'outcome-trail.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportNoticeData = () => {
    const data = state.notices.map(n => {
      const bill = state.bills.find(b => b.id === n.bill_ref);
      const start = new Date(n.window_start);
      const end = new Date(n.window_end);
      const noticeDate = new Date(n.notice_date);
      return {
        bill_title: bill?.title,
        institution: n.institution,
        notice_date: n.notice_date,
        window_start: n.window_start,
        window_end: n.window_end,
        window_length_days: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        days_of_notice: Math.ceil((start.getTime() - noticeDate.getTime()) / (1000 * 60 * 60 * 24)),
        mode: n.mode,
        bill_text_accessible: n.bill_text_accessible,
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notice-adequacy-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Open Data</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Public <span className="gradient-text">Data</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Export public outcome trail and notice-adequacy datasets for research and journalism.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.35, delay: 0 * 0.04 }}
        >
          <Card className="!p-7 md:!p-8 relative overflow-hidden h-full">
            <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/40 blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-xl shadow-primary-500/30 mb-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/40 bg-white/15"><BarChart3 className="h-8 w-8" /></div>
              </div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight mb-3">Outcome Trail Dataset</h2>
              <p className="text-sm text-surface-600 leading-relaxed mb-6">
                Per-bill counts of where each submission is: received, with the committee, report published, response under review, or its outcome (adopted, amended, rejected with reasons, not addressed).
              </p>
              <button
                onClick={exportOutcomeTrail}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Download className="h-4 w-4" /> Export JSON
              </button>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.35, delay: 1 * 0.04 }}
        >
          <Card className="!p-7 md:!p-8 relative overflow-hidden h-full">
            <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-green-100/60 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white shadow-xl shadow-green-500/30 mb-5">
                <FileText className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight mb-3">Notice Adequacy Dataset</h2>
              <p className="text-sm text-surface-600 leading-relaxed mb-6">
                For each observed call for participation: notice date, window length, days of notice, mode, and bill-text accessibility.
              </p>
              <button
                onClick={exportNoticeData}
                className="btn-primary inline-flex items-center gap-2 !bg-gradient-to-r !from-green-500 !to-emerald-600 hover:!from-green-600 hover:!to-emerald-700 !border-green-200"
              >
                <Download className="h-4 w-4" /> Export JSON
              </button>
            </div>
          </Card>
        </motion.div>
      </div>

      <section className="space-y-5" aria-labelledby="public-data-charts">
        <div>
          <div className="inline-flex items-center gap-2 mb-2"><BarChart3 className="h-4 w-4 text-primary-600" /><span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Data visualizations</span></div>
          <h2 id="public-data-charts" className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight">Public data at a glance</h2>
          <p className="mt-2 text-sm text-surface-600">Charts below use the same currently loaded public records as the downloadable datasets.</p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="!p-6">
            <h3 className="text-lg font-black text-surface-900 mb-1">Recorded outcome totals</h3>
            <p className="text-xs text-surface-500 mb-4">Counts across tracked bills</p>
            {outcomeTotal ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={outcomeTotals} margin={{ top: 8, right: 12, left: -15, bottom: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={52} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" name="Submissions" fill="#3a5cff" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="h-72 flex items-center justify-center rounded-xl bg-surface-50 text-sm text-surface-500">No outcome records are available yet.</div>}
          </Card>
          <Card className="!p-6">
            <h3 className="text-lg font-black text-surface-900 mb-1">Outcome mix</h3>
            <p className="text-xs text-surface-500 mb-4">Distribution of recorded statuses</p>
            {outcomeTotal ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={outcomeTotals.filter(item => item.count > 0)} dataKey="count" nameKey="name" cx="50%" cy="48%" outerRadius={92} label={({ name, percent }) => `${name}: ${Math.round((percent || 0) * 100)}%`}><Cell fill="#3a5cff" /><Cell fill="#8b5cf6" /><Cell fill="#ef4444" /><Cell fill="#f59e0b" /><Cell fill="#94a3b8" /></Pie><Tooltip /></PieChart></ResponsiveContainer></div> : <div className="h-72 flex items-center justify-center rounded-xl bg-surface-50 text-sm text-surface-500">No outcome records are available yet.</div>}
          </Card>
          <Card className="!p-6 xl:col-span-2">
            <h3 className="text-lg font-black text-surface-900 mb-1">Public notice periods</h3>
            <p className="text-xs text-surface-500 mb-4">Notice lead time and participation-window length, in days</p>
            {noticeMetrics.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={noticeMetrics} margin={{ top: 8, right: 12, left: -15, bottom: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="bill" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="noticeDays" name="Days of notice" fill="#3a5cff" radius={[5, 5, 0, 0]} /><Bar dataKey="windowDays" name="Window length (days)" fill="#22c55e" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="h-56 flex items-center justify-center rounded-xl bg-surface-50 text-sm text-surface-500">No notice records are available yet.</div>}
          </Card>
        </div>
      </section>
      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 mt-0.5 flex-shrink-0 text-accent-600" />
          <div>
            <h3 className="font-bold text-surface-900 mb-2">Data Access Notes</h3>
            <ul className="text-sm text-surface-700 space-y-2 list-disc list-inside leading-relaxed">
              <li>All exported data is public and does not contain user identifiers.</li>
              <li>Outcome data is derived from confirmed matches only (human-reviewed).</li>
              <li>Notice data records observable facts about publication timing and accessibility.</li>
              <li>These exports do not constitute legal findings or judgments.</li>
            </ul>
          </div>
        </div>
      </InfoBox>
    </div>
  );
}

export function CommunityRulesPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Community</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        Community <span className="gradient-text">Rules</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-3">
        Rules governing user-generated content on this platform.
      </p>
      <p className="text-sm text-surface-600 mb-8">
        How we handle your personal data is set out in our <Link to="/privacy" className="font-bold text-primary-700 underline">Privacy Policy</Link>.
      </p>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, delay: 0 * 0.05 }}
      >
        <Card className="!p-7 md:!p-8 relative overflow-hidden mb-6">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-red-100/50 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white shadow-md shadow-red-500/30">
                <XCircle className="h-5.5 w-5.5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-red-600 mb-1">Enforceable</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">Prohibited Content</h2>
              </div>
            </div>
            <p className="text-sm text-surface-700 mb-4 font-medium">The following content violates community rules and may be reported:</p>
            <ul className="space-y-3 text-sm text-surface-800">
              {[
                ['Threats', 'Direct or implied threats of violence or harm against any person.'],
                ['Harassment', 'Targeted, repeated, or severe abusive behavior toward individuals.'],
                ['Hate speech', 'Content that attacks or dehumanizes people based on protected characteristics.'],
                ['Impersonation', 'Pretending to be another person, office holder, or institution.'],
                ['Spam', 'Repeated irrelevant or automated submissions.'],
                ['Doxxing', 'Publishing private personal information without consent.'],
                ['Coordinated manipulation', 'Organized campaigns to distort participation records.'],
                ['Unsupported allegations', 'Claims of corruption or misconduct presented as fact without evidence.'],
              ].map(([title, desc], i) => (
                <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-red-50/60 to-transparent border border-red-100/60">
                  <div className="w-6 h-6 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-red-500 text-xs font-black">•</span>
                  </div>
                  <div>
                    <strong className="text-surface-900">{title}:</strong> <span className="text-surface-700">{desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, delay: 1 * 0.05 }}
      >
        <Card className="!p-7 md:!p-8 relative overflow-hidden mb-6">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-md shadow-primary-500/30">
                <Flag className="h-5.5 w-5.5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Process</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">Reporting Content</h2>
              </div>
            </div>
            <p className="text-sm text-surface-700 mb-4 leading-relaxed font-medium">
              If you encounter content that violates these rules, you can report it. Reporting creates a moderation case — content is never automatically deleted.
            </p>
            <ul className="text-sm text-surface-700 space-y-2 list-disc list-inside leading-relaxed pl-1">
              <li>A reviewer will review the report and record the rule applied, action taken, and any appeal.</li>
              <li>Moderation logs are preserved for accountability.</li>
              <li>Appeals are handled through a defined process.</li>
              <li>Representatives can report content but get no special power to remove criticism.</li>
            </ul>
          </div>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, delay: 2 * 0.05 }}
      >
        <Card className="!p-7 md:!p-8 relative overflow-hidden mb-6">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-green-100/50 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white shadow-md shadow-green-500/30">
                <Lock className="h-5.5 w-5.5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-green-700 mb-1">Protection</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">Privacy &amp; Data Use</h2>
              </div>
            </div>
            <ul className="text-sm text-surface-700 space-y-3">
              {[
                ['Data minimization', 'We collect only what is needed for authentication, abuse prevention, notifications, and the selected feature.'],
                ['Privacy by default', 'Your name is not shown publicly unless you opt in.'],
                ['No facial recognition', 'Or collection of sensitive political opinions beyond what the feature strictly needs.'],
                ['Consent', 'You are informed about what data is collected, how it is used, and how long it is retained.'],
                ['Retention', 'Receipts and audit logs are retained indefinitely for integrity. Other data follows a defined retention schedule.'],
                ['Visibility', 'Public content is visible to all. Private data (auth credentials, identity) is never exposed.'],
              ].map(([title, desc], i) => (
                <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-green-50/60 to-transparent border border-green-100/60">
                  <div className="w-6 h-6 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  </div>
                  <div>
                    <strong className="text-surface-900">{title}:</strong> <span className="text-surface-700">{desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, delay: 3 * 0.05 }}
      >
        <Card className="!p-7 md:!p-8 relative overflow-hidden mb-6">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-warm-100/60 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-warm-500 to-red-600 flex items-center justify-center text-white shadow-md shadow-warm-500/30">
                <AlertTriangle className="h-5.5 w-5.5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-warm-700 mb-1">Transparency</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">Platform Limitations</h2>
              </div>
            </div>
            <DisclaimerBox className="!p-5">
              <ul className="text-sm space-y-2.5 text-surface-800 leading-relaxed">
                <li>This platform <strong>cannot force</strong> a representative to engage with your submission.</li>
                <li>This platform <strong>cannot guarantee</strong> that your concern will be resolved.</li>
                <li>Online participation is <strong>not statistically representative</strong> of the electorate.</li>
                <li>The platform <strong>cannot ensure</strong> that every affected group is reflected in online submissions.</li>
                <li>Where a user has no smartphone or computer, this is recorded as an access limitation.</li>
                <li>This platform does not provide <strong>legal advice</strong>.</li>
                <li>Non-response or low response rates are shown as neutral, observable facts — never as evidence of misconduct.</li>
              </ul>
            </DisclaimerBox>
          </div>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, delay: 4 * 0.05 }}
      >
        <Card className="!p-7 md:!p-8 relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-purple-100/50 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-purple-500/30">
                <Sparkles className="h-5.5 w-5.5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-purple-600 mb-1">Classification</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">Content Categories</h2>
              </div>
            </div>
            <p className="text-sm text-surface-700 mb-5 font-medium">Content on this platform falls into three clearly separated categories:</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-primary-50 to-primary-100/60 rounded-2xl p-5 border border-primary-100">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white shadow-md shadow-primary-500/25 mb-3">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="font-black text-primary-900 mb-1.5 text-lg">Citizen-Generated</h3>
                <p className="text-sm text-primary-800 leading-relaxed">Submissions, views, and reports from citizens. Subject to community rules moderation.</p>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-100/60 rounded-2xl p-5 border border-green-100">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white shadow-md shadow-green-500/25 mb-3">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="font-black text-green-900 mb-1.5 text-lg">Representative</h3>
                <p className="text-sm text-green-800 leading-relaxed">Claims from verified representative profiles. Clearly labeled with verification status.</p>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-violet-100/60 rounded-2xl p-5 border border-purple-100">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-purple-500/25 mb-3">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <h3 className="font-black text-purple-900 mb-1.5 text-lg">System Aggregates</h3>
                <p className="text-sm text-purple-800 leading-relaxed">Outcome counts and statistics computed from confirmed matches. Not user-editable.</p>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      <Card className="!p-7 md:!p-8 mt-6" hover={false}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-500 flex items-center justify-center text-white shrink-0">
            <Lock className="h-5.5 w-5.5" />
          </div>
          <div className="flex-1">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-primary-600 mb-1">Your data</div>
            <h2 className="text-2xl font-black text-surface-900 tracking-tight m-0">Privacy Policy</h2>
            <p className="text-sm text-surface-700 mt-1 mb-0">What we collect, what becomes public, how Google Gemini is used, where data is stored and your rights under the Kenya Data Protection Act.</p>
          </div>
          <Link to="/privacy" className="action-button is-primary shrink-0">Read the Privacy Policy</Link>
        </div>
      </Card>
    </div>
  );
}

export function RepresentativeDashboardPage() {
  const { state, getBillOutcomes, getSubmissionStatus } = useApp();
  
  if (!state.currentUser || state.currentUser.role !== 'committee_officer') {
    return (
      <div className="text-center py-16">
        <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-5">
          <Shield className="h-10 w-10 text-surface-400" />
        </div>
        <p className="text-lg font-semibold text-surface-700 mb-1">Sign in required</p>
        <p className="text-surface-500">Sign in through the Clerk’s Office / Committee Secretariat to view your dashboard.</p>
      </div>
    );
  }

  const profile = state.profiles.find(p => p.user_id === state.currentUser?.id);
  
  const relevantBills = profile 
    ? state.bills.filter(b => b.institution === profile.institution)
    : [];

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Rep View</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        My <span className="gradient-text">Dashboard</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Aggregated, non-attributable outcome data for bills under your committee's jurisdiction.
      </p>

      {!profile && (
        <InfoBox className="!p-5 mb-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 mt-0.5 flex-shrink-0 text-accent-600" />
            <div>
              <p className="text-sm font-semibold text-surface-800">
              You have not claimed a profile yet. <Link to="/claim-profile" className="text-primary-600 underline font-bold">Claim your profile</Link> to see relevant data.
              </p>
            </div>
          </div>
        </InfoBox>
      )}

      <DisclaimerBox className="!p-5 mb-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0 text-warm-600" />
          <div>
            <p className="text-sm text-surface-800 leading-relaxed">
              <strong>Important:</strong> You cannot alter receipts, report entries, or confirmed matches through this dashboard. 
              This view shows aggregated data only — individual submission identities are not shown.
            </p>
          </div>
        </div>
      </DisclaimerBox>

      {relevantBills.length > 0 && (
        <div className="space-y-5">
          {relevantBills.map((bill, i) => {
            const outcomes = getBillOutcomes(bill.id);
            const totalSubmissions = outcomes.reduce((sum, o) => sum + o.count, 0);
            
            return (
              <motion.div
              key={bill.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
            >
              <Card className="!p-7 md:!p-8 relative overflow-hidden">
                <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-accent-100/40 blur-3xl pointer-events-none" />
                <div className="relative">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div className="flex-1 min-w-0">
                      <div className="inline-flex items-center gap-2 mb-2">
                        <FileCheck2 className="h-4 w-4 text-primary-600" />
                        <span className="text-xs font-black uppercase tracking-[0.15em] text-primary-600">{bill.identifier}</span>
                      </div>
                      <h3 className="text-xl font-black text-surface-900 tracking-tight mb-1">{bill.title}</h3>
                      <p className="text-sm text-surface-600 font-medium">{bill.stage}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-black tracking-tighter text-surface-900 tabular-nums">{totalSubmissions}</p>
                      <p className="text-xs font-bold uppercase tracking-[0.15em] text-surface-500">Submissions</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {outcomes.map((o, idx) => {
                      const toneMap: any = ['from-green-50 to-emerald-100/60 border-green-100 text-green-800',
                        'from-primary-50 to-blue-100/60 border-primary-100 text-primary-800',
                        'from-red-50 to-rose-100/60 border-red-100 text-red-800',
                        'from-surface-50 to-surface-100/80 border-surface-200 text-surface-700',
                        'from-warm-50 to-warm-100/60 border-warm-100 text-warm-800'];
                      const tone = toneMap[idx % toneMap.length];
                      return (
                        <div key={o.status} className={`text-center p-4 rounded-2xl bg-gradient-to-br ${tone} border`}>
                          <p className="text-2xl md:text-3xl font-black tabular-nums mb-1">{o.count}</p>
                          <p className="text-[10px] md:text-xs font-bold uppercase tracking-[0.1em] leading-tight">{o.status}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            </motion.div>
            );
          })}
        </div>
      )}

      {relevantBills.length === 0 && (
        <Card className="!p-12 relative overflow-hidden text-center">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-surface-100/80 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-5">
              <FileText className="h-10 w-10 text-surface-400" />
            </div>
            <p className="text-xl font-bold text-surface-700 mb-1">No bills found</p>
            <p className="text-surface-500">No bills found for your jurisdiction.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

const RECEIPTS_PER_PAGE = 10;
type ReceiptGroup = 'all' | 'editable' | 'in_progress' | 'outcome';
const RECEIPT_GROUPS: { id: ReceiptGroup; label: string; note: string }[] = [
  { id: 'all', label: 'All', note: 'Every submission you have made' },
  { id: 'editable', label: 'Can edit', note: 'The committee is still taking views and no moderator has reviewed it' },
  { id: 'in_progress', label: 'In progress', note: 'Waiting for the committee or its report' },
  { id: 'outcome', label: 'Outcome recorded', note: "The committee's report has a response, or none" },
];

export function MyReceiptsPage() {
  const { state, getSubmissionStatus } = useApp();
  const [accountReceipts, setAccountReceipts] = useState<any[] | null>(null);
  const [receiptsError, setReceiptsError] = useState('');
  const [group, setGroup] = useState<ReceiptGroup>('all');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [legislature, setLegislature] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'bill'>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!state.currentUser) return;
    let cancelled = false;
    api.myReceipts().then(result => {
      if (!cancelled) {
        setAccountReceipts(result.receipts);
        setReceiptsError('');
      }
    }).catch(error => {
      if (!cancelled) setReceiptsError(error instanceof Error ? error.message : 'Unable to load your saved receipts.');
    });
    return () => { cancelled = true; };
  }, [state.currentUser?.id]);

  const myReceipts: any[] = useMemo(
    () => accountReceipts ?? state.receipts.filter(r => r.author_id === state.currentUser?.id),
    [accountReceipts, state.receipts, state.currentUser?.id],
  );
  const billsById = useMemo(() => new Map(state.bills.map(b => [b.id, b])), [state.bills]);
  const stageOf = (receipt: any) => getSubmissionStatus(receipt.id) as SubmissionStage;
  const groupOf = (receipt: any): 'in_progress' | 'outcome' => ((STAGE_META[stageOf(receipt)]?.step ?? 1) >= 5 ? 'outcome' : 'in_progress');
  const legislatures = useMemo(
    () => [...new Set(myReceipts.map(r => billsById.get(r.legislative_item_id)?.institution).filter(Boolean) as string[])].sort(),
    [myReceipts, billsById],
  );

  // Every filter except the group chips, so each chip shows what it would leave.
  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return myReceipts
      .filter(r => stage === 'all' || stageOf(r) === stage)
      .filter(r => legislature === 'all' || billsById.get(r.legislative_item_id)?.institution === legislature)
      .filter(r => !needle || `${r.public_id} ${billsById.get(r.legislative_item_id)?.title || ''} ${r.clause_ref || ''} ${r.submission_text || ''}`.toLowerCase().includes(needle));
  }, [myReceipts, billsById, query, stage, legislature, state.matches]);

  const counts: Record<ReceiptGroup, number> = {
    all: base.length,
    editable: base.filter(r => r.editable).length,
    in_progress: base.filter(r => groupOf(r) === 'in_progress').length,
    outcome: base.filter(r => groupOf(r) === 'outcome').length,
  };

  const receipts = useMemo(() => {
    const title = (r: any) => billsById.get(r.legislative_item_id)?.title || '';
    const sorters = {
      newest: (a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''),
      oldest: (a: any, b: any) => (a.timestamp || '').localeCompare(b.timestamp || ''),
      bill: (a: any, b: any) => title(a).localeCompare(title(b)),
    };
    return base
      .filter(r => group === 'all' || (group === 'editable' ? r.editable : groupOf(r) === group))
      .sort(sorters[sortBy]);
  }, [base, group, sortBy, billsById]);

  const paged = usePaged(receipts, RECEIPTS_PER_PAGE, `${group}|${query}|${stage}|${legislature}|${sortBy}`);
  const selected = myReceipts.find(r => r.id === selectedId) || null;
  const filtersActive = group !== 'all' || query.trim() !== '' || stage !== 'all' || legislature !== 'all';
  const clearFilters = () => { setGroup('all'); setQuery(''); setStage('all'); setLegislature('all'); };

  if (!state.currentUser) {
    return (
      <div className="text-center py-16">
        <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-5">
          <FileText className="h-10 w-10 text-surface-400" />
        </div>
        <p className="text-lg font-semibold text-surface-700 mb-1">Sign in required</p>
        <p className="text-surface-500">Sign in to view your receipts.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Your Records</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
        My <span className="gradient-text">Receipts</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Every submission you have made, where it is, and whether you can still edit it. Select a row to read it in full.
      </p>

      {receiptsError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">Your receipts could not be refreshed from the server: {receiptsError}</div>}

      {myReceipts.length === 0 ? (
        <Card className="!p-12 relative overflow-hidden text-center">
          <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-5">
            <FileCheck2 className="h-10 w-10 text-surface-400" />
          </div>
          <p className="text-xl font-bold text-surface-700 mb-2">No submissions yet</p>
          <p className="text-surface-500 mb-4">You have not submitted any views yet.</p>
          <Link to="/bills?show=open" className="btn-primary inline-flex items-center gap-2 mt-2">Find a bill open for views</Link>
        </Card>
      ) : (
        <Card className="!p-6 md:!p-7">
          <section className="bill-filters mb-4" aria-label="Filter your submissions">
            <div className="bill-filter-chips" role="tablist" aria-label="Submission group">
              {RECEIPT_GROUPS.map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={group === item.id} className={`bill-chip ${group === item.id ? 'is-active' : ''}`} onClick={() => setGroup(item.id)} title={item.note}>
                  {item.label} <span>{counts[item.id]}</span>
                </button>
              ))}
            </div>
            <div className="bill-filter-row notice-filter-row">
              <div className="bill-search">
                <label htmlFor="receipt-search" className="sr-only">Search your submissions</label>
                <Search className="h-5 w-5" aria-hidden="true" />
                <input id="receipt-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search receipts" className="input-field" />
              </div>
              <label className="sr-only" htmlFor="receipt-stage">Stage</label>
              <select id="receipt-stage" className="input-field" value={stage} onChange={e => setStage(e.target.value)}>
                <option value="all">All stages</option>
                {STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
              </select>
              <label className="sr-only" htmlFor="receipt-legislature">Legislature</label>
              <select id="receipt-legislature" className="input-field" value={legislature} onChange={e => setLegislature(e.target.value)}>
                <option value="all">All legislatures</option>
                {legislatures.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <label className="sr-only" htmlFor="receipt-sort">Sort</label>
              <select id="receipt-sort" className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="bill">Bill title A–Z</option>
              </select>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-sm font-semibold text-surface-600 m-0" role="status">
              {receipts.length ? `${paged.summary} ${receipts.length === 1 ? 'submission' : 'submissions'}` : 'No submissions'}
              {receipts.length !== myReceipts.length ? ` (filtered from ${myReceipts.length})` : ''}
            </p>
            {filtersActive && <button type="button" onClick={clearFilters} className="text-sm font-bold text-primary-600 hover:underline">Clear filters</button>}
          </div>

          {receipts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-surface-300 p-8 text-center text-sm text-surface-600">
              <p className="font-bold text-surface-800 mb-1">No submissions match these filters.</p>
              <p className="m-0">Try another group, stage or search term.</p>
            </div>
          ) : (
            <div className="submissions-table-wrap">
              <table className="submissions-table">
                <thead>
                  <tr><th>Receipt</th><th>Bill</th><th>Submitted</th><th>Stage</th><th>Editing</th><th><span className="sr-only">Open</span></th></tr>
                </thead>
                <tbody>
                  {paged.rows.map(receipt => {
                    const bill = billsById.get(receipt.legislative_item_id);
                    const open = () => setSelectedId(receipt.id);
                    return (
                      <tr key={receipt.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} aria-label={`Open submission ${receipt.public_id}`}>
                        <td><span className="receipt-id">{receipt.public_id}</span>{(receipt.revision || 1) > 1 && <span className="yours">Edited</span>}</td>
                        <td>
                          <div className="excerpt !max-w-[300px] font-semibold">{bill?.title || 'Bill no longer listed'}</div>
                          <div className="text-xs text-surface-500">{bill?.institution}{receipt.clause_ref ? ` · ${receipt.clause_ref}` : ''}</div>
                        </td>
                        <td className="whitespace-nowrap">{formatDate(receipt.timestamp)}</td>
                        <td><StatusBadge status={stageOf(receipt)} /></td>
                        <td className="whitespace-nowrap text-xs font-bold">
                          {receipt.editable
                            ? <span className="text-accent-700">Can edit</span>
                            : <span className="text-surface-500">{receipt.edit_block === 'reviewed' ? 'Reviewed' : 'Closed'}</span>}
                        </td>
                        <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} label="Submission pages" className="mt-4 !border !border-[#e2ded5] !rounded-2xl" />
        </Card>
      )}

      <SubmissionDetailDialog
        receipt={selected}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        isMine
        canOpenDocument
        myEdit={selected ? { editable: Boolean(selected.editable), edit_block: selected.edit_block } : null}
        showBill
      />
    </div>
  );
}

const PRIVACY_UPDATED = '20 November 2026';

const PRIVACY_SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: 'who',
    title: 'Who runs Participation Trace',
    body: (
      <>
        <p>Participation Trace is a research prototype built as a BSc Software Engineering capstone project at the African Leadership University. It is not run by Parliament, a county assembly or any government office, and it does not send your views to them.</p>
        <p>It has not yet been registered as a data controller with the Office of the Data Protection Commissioner (ODPC). We handle personal data following the principles of the Kenya Data Protection Act, 2019, and this page explains how.</p>
      </>
    ),
  },
  {
    id: 'browse',
    title: 'Browsing without an account',
    body: (
      <p>You do not need an account to read bills, calls for views, committee reports, outcomes or receipts, or to verify the hash chain. We do not ask who you are, set tracking cookies, or use analytics or advertising tools.</p>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <ul>
        <li><strong>Your account:</strong> your name, email address and password, your role and, for Clerk's Office staff, your committee. Passwords and recovery codes are stored only as one-way hashes (argon2id and SHA-256), never as text.</li>
        <li><strong>Your submissions:</strong> the text of your view, the clause it is about, the bill, the time, and its hash in the receipt chain. If you upload a memorandum, we keep the file, its size, type and SHA-256 fingerprint, and the text read from it.</li>
        <li><strong>Your settings:</strong> whether your name is shown on your submissions (off unless you turn it on) and the language for your notifications.</li>
        <li><strong>Moderation and audit records:</strong> who reported content and why, moderators' decisions and reasons, and a record of significant actions (such as creating a receipt or confirming a match) and the account that took them.</li>
        <li><strong>Technical data:</strong> your IP address is used to apply rate limits, and our hosting provider's logs record the IP address, time and page of each request to the service.</li>
      </ul>
    ),
  },
  {
    id: 'public',
    title: 'What is public',
    body: (
      <>
        <p>Public participation is a public process, so some of what you submit is public by design:</p>
        <ul>
          <li><strong>Public:</strong> the text of your view, the bill and clause, the time, the receipt ID and its hash, the committee's response once matched, and the text read from an uploaded memorandum. Anyone with a receipt ID can look it up.</li>
          <li><strong>Public only if you choose:</strong> your name. It is hidden by default; you can choose to show it when you submit.</li>
          <li><strong>Never public:</strong> your email address, your password, your account ID, and the original memorandum file, which only you and the platform's Clerk's Office, moderator and administrator accounts can open (it may contain signatures or contact details).</li>
        </ul>
        <p>Do not put personal details you do not want published, such as your phone number or ID number, in the text of a view.</p>
        <p>The platform also shows submissions that committee reports list (memoranda and hearing submissions made to the committee directly). These come from reports Parliament and the county assemblies have already published, including any names those reports give.</p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <ul>
        <li>To issue your receipt and keep the tamper-evident record of your submission.</li>
        <li>To find the committee's response to your view in its report, and to show you where your submission is.</li>
        <li>To send you notifications inside the platform when your submission's status changes, in English or Kiswahili.</li>
        <li>To run the accounts and roles (citizen, Clerk's Office, moderator, administrator), keep the service secure and enforce the Community Rules.</li>
        <li>To publish identifier-free data (submission text, bill, clause, time and outcome; no names, emails or account IDs) for research on public participation.</li>
      </ul>
    ),
  },
  {
    id: 'ai',
    title: 'Automated processing with Google Gemini',
    body: (
      <>
        <p>We send the text of submissions and of committee reports to Google's Gemini API to propose which part of a report answers each view, to list the submissions a report records, and to write some notifications. Your name and email are not sent. Google processes this text under its Gemini API terms.</p>
        <p>No decision about you is made by the AI alone: a human moderator confirms or rejects every proposed match before it is shown as the committee's response.</p>
      </>
    ),
  },
  {
    id: 'where',
    title: 'Where it is stored',
    body: (
      <>
        <p>The service runs on providers outside Kenya:</p>
        <ul>
          <li>Neon: the database, in the United States.</li>
          <li>Render: the server and uploaded files.</li>
          <li>Netlify: the website.</li>
          <li>GitHub Actions: the nightly update from official sources, which handles no personal data.</li>
        </ul>
        <p>Data is sent to and from them over encrypted HTTPS connections. By using the platform you are told that your data is processed in these countries.</p>
      </>
    ),
  },
  {
    id: 'keep',
    title: 'How long we keep it',
    body: (
      <>
        <p>Receipts and the audit record are <strong>permanent and append-only</strong>: the database refuses to change or delete them, because a record that could be quietly edited would prove nothing. If you edit your view while a call for views is open, the earlier version stays in the chain, marked as superseded.</p>
        <p>Account details are kept while your account exists. Password reset tokens expire and recovery codes stop working once used. Our hosting provider keeps request logs for a limited period.</p>
      </>
    ),
  },
  {
    id: 'device',
    title: 'On your device',
    body: (
      <p>Your browser stores your sign-in session and profile (local storage), and drafts of views you are writing, including those saved while offline (IndexedDB), so you do not lose them. They stay on your device until they are sent or you clear your browser data. Signing out removes your session.</p>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <p>Under the Kenya Data Protection Act, 2019 you can ask to see the personal data we hold about you, to correct it, to object to its use, and to have it deleted. You can change your notification language and see all your submissions from your account.</p>
        <p>Deletion has one limit: we cannot delete or edit a receipt already in the hash chain, as that would break the record for everyone. We can close your account and erase the name and email in it; your submissions stay in the chain without your account details, except that a submission on which you chose to show your name keeps that name in its receipt.</p>
        <p>If you are not satisfied with how we handle a request, you can complain to the Office of the Data Protection Commissioner (odpc.go.ke).</p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Age',
    body: <p>Accounts are for people aged 18 or older.</p>,
  },
  {
    id: 'contact',
    title: 'Contact and changes',
    body: (
      <>
        <p>To make a request or ask a question, open an issue on the project's repository at <a href="https://github.com/WamalwaSydney/submission_to_decision/issues" target="_blank" rel="noreferrer">github.com/WamalwaSydney/submission_to_decision</a>, without putting personal details in it; we will reply there and arrange a private channel if needed.</p>
        <p>If we change this policy, we will update it here and change the date at the top.</p>
      </>
    ),
  },
];

export function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <nav className="mb-4 text-sm" aria-label="Breadcrumb">
        <Link to="/community-rules" className="font-semibold text-[#11521f] hover:underline">← Community Rules</Link>
      </nav>
      <div className="inline-flex items-center gap-2 mb-4">
        <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
        <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Your data</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-3">
        Privacy <span className="gradient-text">Policy</span>
      </h1>
      <p className="text-sm font-semibold text-surface-500 mb-4">Last updated {PRIVACY_UPDATED}</p>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        What Participation Trace collects, what becomes public, who processes it and what you can ask us to do.
      </p>

      <Card className="!p-6 md:!p-7 mb-6" hover={false}>
        <h2 className="text-lg font-black text-surface-900 mb-3">In short</h2>
        <div className="privacy-text"><ul>
          <li>You can read everything without an account. We use no tracking cookies or analytics.</li>
          <li>The text of your view and your receipt are public; your name is shown only if you choose.</li>
          <li>Receipts are permanent: they cannot be edited or deleted, by you or by us.</li>
          <li>Submission text is processed by Google Gemini to find the committee's response; a person confirms every match.</li>
          <li>Data is stored with providers in the United States.</li>
        </ul></div>
      </Card>

      <Card className="!p-6 md:!p-7 mb-6" hover={false}>
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-surface-500 mb-3">Contents</h2>
        <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 list-decimal list-inside text-sm">
          {PRIVACY_SECTIONS.map(s => <li key={s.id}><a href={`#privacy-${s.id}`} onClick={e => { e.preventDefault(); document.getElementById(`privacy-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="font-semibold text-primary-700 hover:underline">{s.title}</a></li>)}
        </ol>
      </Card>

      <div className="space-y-6">
        {PRIVACY_SECTIONS.map((s, i) => (
          <Card key={s.id} className="!p-6 md:!p-8 scroll-mt-6" hover={false}>
            <section id={`privacy-${s.id}`} aria-labelledby={`privacy-${s.id}-title`}>
              <h2 id={`privacy-${s.id}-title`} className="text-xl md:text-2xl font-black text-surface-900 tracking-tight mb-3">
                <span className="text-primary-600 mr-2">{i + 1}.</span>{s.title}
              </h2>
              <div className="privacy-text">{s.body}</div>
            </section>
          </Card>
        ))}
      </div>
    </div>
  );
}
