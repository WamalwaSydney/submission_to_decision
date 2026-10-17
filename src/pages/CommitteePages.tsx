import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card } from '../components/UI';
import { confidenceClasses, confidenceLabel } from '../utils/confidence';

export function CommitteeDashboardPage() {
  const { state } = useApp();
  const [bills, setBills] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', identifier: '', stage: 'Introduced', source_url: '' });
  const [message, setMessage] = useState('');
  const isCommittee = state.currentUser?.role === 'committee_officer';

  const load = () => { if (isCommittee) api.committeeBills().then(r => setBills(r.bills)).catch(e => setMessage(e instanceof Error ? e.message : 'Unable to load committee bills.')); };
  useEffect(load, [isCommittee]);

  const ingest = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    try { await api.ingestBill(form); setForm({ title: '', identifier: '', stage: 'Introduced', source_url: '' }); setMessage('Bill ingested and published to the public bill flow.'); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to ingest bill.'); }
  };

  if (!isCommittee) return <Card><h1 className="text-2xl font-black">Committee area</h1><p className="mt-2">Sign in with a committee account to ingest and manage bills.</p></Card>;
  return <div className="space-y-6">
    <div><h1 className="text-4xl font-black">Committee dashboard</h1><p className="text-surface-600 mt-2">Ingest bills, see only your committee’s bills, and follow citizen participation.</p></div>
    <Card><h2 className="text-xl font-black mb-4">Ingest a bill</h2><form onSubmit={ingest} className="grid gap-3 md:grid-cols-2">
      <input className="input-field" required placeholder="Bill title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      <input className="input-field" required placeholder="Unique bill identifier" value={form.identifier} onChange={e => setForm({ ...form, identifier: e.target.value })} />
      <select className="input-field" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}><option>Introduced</option><option>Public Participation</option><option>Committee Stage</option><option>Second Reading</option></select>
      <input className="input-field" type="url" placeholder="Official source URL (optional)" value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} />
      <button className="btn-primary md:col-span-2" type="submit">Ingest bill</button>
    </form>{message && <p className="mt-3 text-sm">{message}</p>}</Card>
    <Card><h2 className="text-xl font-black mb-4">Your bills ({bills.length})</h2><div className="space-y-3">{bills.map(bill => <div key={bill.id} className="border rounded-xl p-4 flex items-center justify-between gap-4"><div><p className="font-bold">{bill.title}</p><p className="text-sm text-surface-500">{bill.identifier} · {bill.stage}</p></div><Link className="btn-secondary" to={`/bill-flow/${bill.id}`}>View public flow</Link></div>)}{!bills.length && <p className="text-surface-500">No bills have been ingested yet.</p>}</div></Card>
  </div>;
}

export function BillFlowPage() {
  const { state } = useApp();
  const [flow, setFlow] = useState<any>(null);
  const billId = window.location.hash.split('/bill-flow/')[1]?.split('?')[0];
  useEffect(() => { if (billId) api.billFlow(billId).then(setFlow).catch(() => setFlow(null)); }, [billId]);
  if (!flow) return <Card><p>Loading the bill flow…</p></Card>;
  const committee = state.committees.find(c => c.id === flow.bill.committee_id);
  return <div className="space-y-6"><Card><p className="text-xs uppercase tracking-widest text-primary-600">Public bill flow</p><h1 className="text-4xl font-black mt-2">{flow.bill.title}</h1><p className="text-surface-600 mt-2">{flow.bill.identifier} · current stage: {flow.bill.stage}</p>{committee && <p className="mt-2 text-sm">Responsible committee: <strong>{committee.name}</strong></p>}</Card>
    <Card><h2 className="text-xl font-black mb-4">Legislative stages</h2><div className="space-y-3">{flow.flow.map((item: any, i: number) => <div key={i} className="border-l-4 border-primary-400 pl-4"><p className="font-bold">{item.stage}</p><p className="text-sm text-surface-500">{item.date} · {item.note}</p></div>)}</div></Card>
    <Card><h2 className="text-xl font-black mb-4">Participation outcomes</h2><div className="space-y-3">{flow.submissions.map((s: any) => <div key={s.public_id} className="border rounded-xl p-4"><div className="flex justify-between gap-4"><strong>{s.public_id}</strong><span className="font-semibold">{s.status}</span></div><p className="text-sm text-surface-500 mt-1">{s.clause_ref || 'General submission'}</p>{s.match_percentage !== null && <span className={`inline-flex mt-2 rounded-full border px-2.5 py-1 text-xs font-black ${confidenceClasses(s.match_percentage / 100)}`}>{confidenceLabel(s.match_percentage / 100)} confidence · {s.match_percentage}%</span>}{s.reason && <p className="text-sm mt-2">Committee reason: {s.reason}</p>}{s.status === 'rejected with reasons' && committee && <Link className="btn-secondary inline-block mt-3" to={`/messages?committee=${committee.id}&bill=${flow.bill.id}&receipt=${s.public_id}`}>Ask the committee about this outcome</Link>}</div>)}{!flow.submissions.length && <p className="text-surface-500">No submissions have been recorded yet.</p>}</div></Card>
    <Card><h2 className="text-xl font-black mb-3">Committee reports</h2>{flow.reports.map((r: any) => <p key={r.id} className="text-sm border-b py-2">{r.title || r.source_document_ref} · {r.extraction_status} · {r.ocr_used ? 'OCR used' : 'native text'}</p>)}</Card></div>;
}
