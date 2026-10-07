import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Download, FileText, BarChart3, Shield, AlertTriangle, Users, Eye, Clock, CheckCircle2, XCircle, Sparkles, Lock, Flag, Info, FileCheck2, TrendingUp, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, DisclaimerBox, InfoBox, Badge, Label, InputField } from '../components/UI';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
export function ResearchExportPage() {
  const { state, getSubmissionStatus, getBillOutcomes } = useApp();
  const outcomeColors: Record<string, string> = {
    adopted: '#16a34a',
    amended: '#2563eb',
    'rejected with reasons': '#dc2626',
    'not addressed': '#f59e0b',
    'awaiting committee report': '#94a3b8',
  };
  const outcomeLabels: Record<string, string> = {
    adopted: 'Adopted',
    amended: 'Amended',
    'rejected with reasons': 'Rejected',
    'not addressed': 'Not addressed',
    'awaiting committee report': 'Awaiting report',
  };
  const outcomeStatuses = ['awaiting committee report', 'adopted', 'amended', 'rejected with reasons', 'not addressed'];
  const billChartData = state.bills.map(bill => {
    const outcomes = getBillOutcomes(bill.id).reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {} as Record<string, number>);
    return {
      name: bill.identifier,
      title: bill.title,
      awaiting: outcomes['awaiting committee report'] || 0,
      adopted: outcomes.adopted || 0,
      amended: outcomes.amended || 0,
      rejected: outcomes['rejected with reasons'] || 0,
      notAddressed: outcomes['not addressed'] || 0,
    };
  });
  const outcomeChartData = outcomeStatuses.map(status => ({
    name: outcomeLabels[status],
    value: state.receipts.filter(receipt => getSubmissionStatus(receipt.id) === status).length,
    status,
  }));
  const noticeChartData = state.notices.map(notice => {
    const start = new Date(notice.window_start);
    const end = new Date(notice.window_end);
    const noticeDate = new Date(notice.notice_date);
    return {
      name: state.bills.find(bill => bill.id === notice.bill_ref)?.identifier || notice.bill_ref,
      noticeDays: Math.max(0, Math.ceil((start.getTime() - noticeDate.getTime()) / 86400000)),
      windowDays: Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86400000)),
    };
  });
  const totalOutcomes = outcomeChartData.reduce((sum, item) => sum + item.value, 0);
  const decidedCount = outcomeChartData.filter(item => !['Awaiting report'].includes(item.name)).reduce((sum, item) => sum + item.value, 0);
  const averageNoticeDays = noticeChartData.length ? Math.round(noticeChartData.reduce((sum, item) => sum + item.noticeDays, 0) / noticeChartData.length) : 0;

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
        Research <span className="gradient-text">Export</span>
      </h1>
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Explore public participation and accountability statistics visually, then export the underlying datasets for research and journalism.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Submissions tracked', value: state.receipts.length, icon: FileCheck2, color: 'text-primary-600', bg: 'bg-primary-50' },
          { label: 'Bills with data', value: state.bills.length, icon: BarChart3, color: 'text-accent-600', bg: 'bg-accent-50' },
          { label: 'Outcomes decided', value: decidedCount, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Average notice', value: `${averageNoticeDays} days`, icon: CalendarDays, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="!p-4 md:!p-5">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}><Icon className={`h-5 w-5 ${color}`} /></div>
            <div className="text-2xl font-black text-surface-900">{value}</div>
            <div className="text-xs font-bold uppercase tracking-wider text-surface-500 mt-1">{label}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-8">
        <Card className="!p-5 md:!p-6 xl:col-span-2">
          <div className="flex items-start justify-between mb-4">
            <div><h2 className="text-xl font-black text-surface-900">Outcome distribution</h2><p className="text-sm text-surface-500 mt-1">All tracked submissions</p></div>
            <BarChart3 className="h-5 w-5 text-primary-600" />
          </div>
          {totalOutcomes > 0 ? <>
            <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={outcomeChartData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} stroke="none">{outcomeChartData.map(item => <Cell key={item.status} fill={outcomeColors[item.status]} />)}</Pie><Tooltip formatter={(value: number) => [`${value} submissions`, 'Count']} /><Legend verticalAlign="bottom" height={42} iconType="circle" wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>
            <p className="text-center text-xs text-surface-500">{totalOutcomes} submissions represented in the outcome trail</p>
          </> : <div className="h-64 flex items-center justify-center text-sm text-surface-500">No outcome data available yet.</div>}
        </Card>

        <Card className="!p-5 md:!p-6 xl:col-span-3">
          <div className="flex items-start justify-between mb-4"><div><h2 className="text-xl font-black text-surface-900">Outcomes by bill</h2><p className="text-sm text-surface-500 mt-1">Compare how submissions were treated</p></div><TrendingUp className="h-5 w-5 text-green-600" /></div>
          <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={billChartData} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip labelFormatter={(label, payload) => payload?.[0]?.payload?.title || label} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="adopted" name="Adopted" stackId="a" fill="#16a34a" radius={[3, 3, 0, 0]} /><Bar dataKey="amended" name="Amended" stackId="a" fill="#2563eb" /><Bar dataKey="rejected" name="Rejected" stackId="a" fill="#dc2626" /><Bar dataKey="notAddressed" name="Not addressed" stackId="a" fill="#f59e0b" /><Bar dataKey="awaiting" name="Awaiting report" stackId="a" fill="#94a3b8" /></BarChart></ResponsiveContainer></div>
        </Card>
      </div>

      <Card className="!p-5 md:!p-6 mb-8">
        <div className="flex items-start justify-between mb-4"><div><h2 className="text-xl font-black text-surface-900">Notice timing</h2><p className="text-sm text-surface-500 mt-1">Days between publication and opening, compared with the participation window</p></div><CalendarDays className="h-5 w-5 text-amber-600" /></div>
        {noticeChartData.length > 0 ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={noticeChartData} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number, name: string) => [`${value} days`, name === 'noticeDays' ? 'Notice before opening' : 'Participation window']} /><Legend formatter={(value) => value === 'noticeDays' ? 'Notice before opening' : 'Participation window'} wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="noticeDays" name="noticeDays" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="windowDays" name="windowDays" fill="#0ea5e9" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="h-48 flex items-center justify-center text-sm text-surface-500">No notice records available yet.</div>}
      </Card>

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
                <BarChart3 className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight mb-3">Outcome Trail Dataset</h2>
              <p className="text-sm text-surface-600 leading-relaxed mb-6">
                Per-bill outcome counts: how many submissions were adopted, amended, rejected with reasons, not addressed, or awaiting committee report.
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
      <p className="text-lg text-surface-600 leading-relaxed max-w-3xl mb-8">
        Rules governing user-generated content on this platform.
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
              <li>A moderator will review the report and record the rule applied, action taken, and any appeal.</li>
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
                <li>Where a user has no smartphone or computer, this is recorded as a pilot limitation.</li>
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
    </div>
  );
}

export function RepresentativeDashboardPage() {
  const { state, getBillOutcomes, getSubmissionStatus } = useApp();
  
  if (!state.currentUser || state.currentUser.role !== 'representative') {
    return (
      <div className="text-center py-16">
        <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-5">
          <Shield className="h-10 w-10 text-surface-400" />
        </div>
        <p className="text-lg font-semibold text-surface-700 mb-1">Sign in required</p>
        <p className="text-surface-500">Sign in as a representative to view your dashboard.</p>
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

export function MyReceiptsPage() {
  const { state, getSubmissionStatus } = useApp();

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

  const myReceipts = state.receipts.filter(r => r.author_id === state.currentUser?.id);

  const statusMap: Record<string, any> = {
    'awaiting committee report': 'yellow',
    'adopted': 'green',
    'amended': 'blue',
    'rejected with reasons': 'red',
  };

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
        All receipts issued for your submissions.
      </p>

      {myReceipts.length === 0 ? (
        <Card className="!p-12 relative overflow-hidden text-center">
          <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/50 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-surface-100 to-surface-200 flex items-center justify-center mb-5">
              <FileCheck2 className="h-10 w-10 text-surface-400" />
            </div>
            <p className="text-xl font-bold text-surface-700 mb-2">No submissions yet</p>
            <p className="text-surface-500 mb-4">
              You haven&apos;t submitted any views yet.
            </p>
            <a href="/submit" className="btn-primary inline-flex items-center gap-2 mt-2">
              <Sparkles className="h-4 w-4" /> Submit your first view
            </a>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {myReceipts.map((receipt, i) => {
            const bill = state.bills.find(b => b.id === receipt.legislative_item_id);
            const status = getSubmissionStatus(receipt.id);
            const statusVariant = statusMap[status] || 'gray';
            
            return (
              <motion.div
                key={receipt.id}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: i * 0.04 }}
              >
                <Card className="!p-0 relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-primary-400 to-accent-600" />
                  <div className="p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <span className="font-mono font-black text-primary-700 bg-gradient-to-r from-primary-50 to-accent-50 px-3 py-1.5 rounded-xl border border-primary-100 text-sm tracking-wide">
                            {receipt.public_id}
                          </span>
                          <Badge variant={statusVariant} showIcon className="!text-[11px]">
                            {status}
                          </Badge>
                        </div>
                        <p className="text-sm font-semibold text-surface-800 mb-1">{bill?.title}</p>
                        <p className="text-xs text-surface-500 font-medium flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {new Date(receipt.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-surface-50/80 to-white rounded-xl p-4 border border-surface-100 mb-4">
                      <p className="text-sm text-surface-800 leading-relaxed line-clamp-2">{receipt.submission_text}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-surface-100">
                      <a
                        href={`/receipt-lookup?id=${receipt.public_id}`}
                        className="btn-secondary inline-flex items-center gap-2 text-sm !py-2 !px-4"
                      >
                        <Eye className="h-4 w-4" /> View Details
                      </a>
                      <span className="text-xs font-semibold text-surface-500 ml-auto flex items-center gap-1.5">
                        <FileCheck2 className="h-3.5 w-3.5" />
                        Lodging: <span className="font-bold text-surface-700">{receipt.lodging_status}</span>
                      </span>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
