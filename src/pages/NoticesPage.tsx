import React from 'react';
import { useApp } from '../context/AppContext';
import { getDaysOfNotice, getWindowLength } from '../data/seed';
import { Link } from 'react-router-dom';
import { Clock, Download, AlertTriangle, Info, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge, DisclaimerBox, InfoBox, Card } from '../components/UI';

export function NoticesPage() {
  const { state } = useApp();

  const exportCSV = () => {
    const headers = ['Bill', 'Institution', 'Notice Date', 'Window Start', 'Window End', 'Window Length (days)', 'Days of Notice', 'Mode', 'Bill Text Accessible'];
    const rows = state.notices.map(n => {
      const bill = state.bills.find(b => b.id === n.bill_ref);
      return [
        bill?.title || n.bill_ref,
        n.institution,
        n.notice_date,
        n.window_start,
        n.window_end,
        getWindowLength(n).toString(),
        getDaysOfNotice(n).toString(),
        n.mode,
        n.bill_text_accessible ? 'Yes' : 'No',
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notice-adequacy-data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const data = state.notices.map(n => {
      const bill = state.bills.find(b => b.id === n.bill_ref);
      return {
        bill_title: bill?.title || n.bill_ref,
        institution: n.institution,
        notice_date: n.notice_date,
        window_start: n.window_start,
        window_end: n.window_end,
        window_length_days: getWindowLength(n),
        days_of_notice: getDaysOfNotice(n),
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
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-2">
        <div>
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
            <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Notice Adequacy</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
            Notice <span className="gradient-text">Adequacy Tracker</span>
          </h1>
          <p className="text-lg text-surface-600 leading-relaxed max-w-3xl">
            For each observed call for public participation: notice date, window length, mode, and bill-text accessibility.
          </p>
        </div>
        <div className="inline-flex flex-wrap gap-2">
          <button onClick={exportCSV} className="btn-secondary inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={exportJSON} className="btn-primary inline-flex items-center gap-2">
            <Download className="h-4 w-4" /> Export JSON
          </button>
        </div>
      </div>

      <DisclaimerBox className="!p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm">
              This data is observational and neutral. It records what was published and when. It does not judge adequacy or allege misconduct. Days of notice and window length are computed from published dates.
            </p>
          </div>
        </div>
      </DisclaimerBox>

      <Card className="!p-7 md:!p-8 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-lg shadow-primary-500/25">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-600">Observational Record</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">Participation Notices</h2>
            </div>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Institution</th>
                  <th>Notice Date</th>
                  <th>Window</th>
                  <th>Length (days)</th>
                  <th>Days of Notice</th>
                  <th>Mode</th>
                  <th>Bill Text Accessible</th>
                </tr>
              </thead>
              <tbody>
                {state.notices.map((notice, idx) => {
                  const bill = state.bills.find(b => b.id === notice.bill_ref);
                  return (
                    <motion.tr
                      key={notice.id}
                      initial={{ opacity: 0, y: 16 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: idx * 0.04 }}
                    >
                      <td>
                        <Link to={`/bills/${notice.bill_ref}`} className="text-primary-600 hover:underline font-semibold">
                          {bill?.title || notice.bill_ref}
                        </Link>
                      </td>
                      <td className="font-medium">{notice.institution}</td>
                      <td>{notice.notice_date}</td>
                      <td className="text-xs whitespace-nowrap">{notice.window_start} → {notice.window_end}</td>
                      <td className="font-bold text-surface-900">{getWindowLength(notice)}</td>
                      <td className="font-bold text-surface-900">{getDaysOfNotice(notice)}</td>
                      <td className="text-xs">
                        <Badge variant="blue" className="!text-[10px]">{notice.mode}</Badge>
                      </td>
                      <td>{notice.bill_text_accessible ? <Badge variant="green" showIcon className="!text-[10px]">Yes</Badge> : <Badge variant="yellow" showIcon className="!text-[10px]">No</Badge>}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-primary-900 mb-1">About Notice Adequacy</h3>
            <p className="text-sm text-primary-800/85 leading-relaxed">
              Kenyan courts test public participation as "reasonable, meaningful, and effective" (Constitution of Kenya 2010, Arts. 10(2)(a), 118(1)(b), 196).
              This tracker records observable facts about notice publication: when notice was given, how long the participation window was,
              what mode was used, and whether the bill text was accessible alongside the notice. It does not make legal determinations.
            </p>
          </div>
        </div>
      </InfoBox>
    </div>
  );
}
