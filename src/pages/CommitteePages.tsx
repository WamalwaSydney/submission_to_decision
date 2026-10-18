import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card } from '../components/UI';
import { confidenceClasses, confidenceLabel } from '../utils/confidence';
import { CheckCircle2, FileText, FileUp, Loader2, UploadCloud, X } from 'lucide-react';

export function CommitteeDashboardPage() {
  const { state } = useApp();
  const [bills, setBills] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', identifier: '', stage: 'Introduced', source_url: '' });
  const [billFile, setBillFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const isCommittee = state.currentUser?.role === 'committee_officer';

  const load = () => { if (isCommittee) api.committeeBills().then(r => setBills(r.bills)).catch(e => setMessage(e instanceof Error ? e.message : 'Unable to load committee bills.')); };
  useEffect(load, [isCommittee]);

  const ingest = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setSaving(true);
    try { await api.ingestBill({ ...form, file: billFile }); setForm({ title: '', identifier: '', stage: 'Introduced', source_url: '' }); setBillFile(null); setMessage('Bill ingested and published to the public bill flow.'); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to ingest bill.'); }
    finally { setSaving(false); }
  };

  const chooseBillFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setMessage('Please choose a PDF bill document.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setMessage('The bill document must be 50 MB or smaller.');
      return;
    }
    setMessage('');
    setBillFile(file);
  };

  if (!isCommittee) return <Card><h1 className="text-2xl font-black">Committee area</h1><p className="mt-2">Sign in with a committee account to ingest and manage bills.</p></Card>;
  return <div className="space-y-6">
    <div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Committee workspace</p><h1 className="text-4xl font-black mt-2">Committee dashboard</h1><p className="text-surface-600 mt-2 max-w-2xl">Publish a bill record and its official PDF so citizens can find the legislation and follow its participation trail.</p></div>
    <Card><div className="flex items-start gap-3 mb-5"><div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 text-white flex items-center justify-center shadow-md"><FileUp className="h-5 w-5" /></div><div><h2 className="text-xl font-black">Ingest a bill</h2><p className="text-sm text-surface-500 mt-1">Required: title and unique identifier. Upload the official bill PDF when available.</p></div></div><form onSubmit={ingest} className="grid gap-4 md:grid-cols-2">
      <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-surface-600">Bill title</span><input className="input-field mt-1" required placeholder="e.g. Nairobi County Finance Bill, 2026" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label><span className="text-xs font-black uppercase tracking-wide text-surface-600">Unique bill identifier</span><input className="input-field mt-1" required placeholder="e.g. NCA/2026/Bill-003" value={form.identifier} onChange={e => setForm({ ...form, identifier: e.target.value })} /></label>
      <label><span className="text-xs font-black uppercase tracking-wide text-surface-600">Current stage</span><select className="input-field mt-1" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}><option>Introduced</option><option>Public Participation</option><option>Committee Stage</option><option>Second Reading</option></select></label>
      <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-surface-600">Official source URL (optional)</span><input className="input-field mt-1" type="url" placeholder="https://www.parliament.go.ke/..." value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} /></label>
      <div className="md:col-span-2">
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { chooseBillFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-surface-200 bg-surface-50/60 hover:border-primary-400 hover:bg-primary-50/40 transition-colors p-6 text-left flex items-center gap-4">
          <span className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0"><UploadCloud className="h-6 w-6" /></span>
          <span className="min-w-0 flex-1">{billFile ? <><span className="block font-bold text-surface-900 truncate">{billFile.name}</span><span className="text-xs text-surface-500">{(billFile.size / (1024 * 1024)).toFixed(1)} MB · PDF selected</span></> : <><span className="block font-bold text-surface-900">Select official bill PDF</span><span className="text-xs text-surface-500">Click to browse or choose a file from your device · maximum 50 MB</span></>}</span>
          {billFile ? <span onClick={e => { e.stopPropagation(); setBillFile(null); }} className="p-2 rounded-lg hover:bg-white text-surface-500" aria-label="Remove bill PDF"><X className="h-4 w-4" /></span> : <FileText className="h-5 w-5 text-surface-400 shrink-0" />}
        </button>
      </div>
      <button className="btn-primary md:col-span-2 inline-flex items-center justify-center gap-2" type="submit" disabled={saving || !form.title.trim() || !form.identifier.trim()}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading bill...</> : <><FileUp className="h-4 w-4" /> Upload and publish bill</>}</button>
    </form>{message && <p className={`mt-4 text-sm font-semibold flex items-center gap-2 ${message.includes('ingested') ? 'text-green-700' : 'text-red-700'}`}>{message.includes('ingested') && <CheckCircle2 className="h-4 w-4" />}{message}</p>}</Card>
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
    <Card><h2 className="text-xl font-black mb-4">Participation outcomes</h2><div className="space-y-3">{flow.submissions.map((s: any) => <div key={s.public_id} className="border rounded-xl p-4"><div className="flex justify-between gap-4"><strong>{s.public_id}</strong><span className="font-semibold">{s.status}</span></div><p className="text-sm text-surface-500 mt-1">{s.clause_ref || 'General submission'}</p>{s.match_percentage !== null && <span className={`inline-flex mt-2 rounded-full border px-2.5 py-1 text-xs font-black ${confidenceClasses(s.match_percentage / 100)}`}>{confidenceLabel(s.match_percentage / 100)} confidence · {s.match_percentage}%</span>}{s.reason && <p className="text-sm mt-2">Committee reason: {s.reason}</p>}</div>)}{!flow.submissions.length && <p className="text-surface-500">No submissions have been recorded yet.</p>}</div></Card>
    <Card><h2 className="text-xl font-black mb-3">Committee reports</h2>{flow.reports.map((r: any) => <p key={r.id} className="text-sm border-b py-2">{r.title || r.source_document_ref} · {r.extraction_status} · {r.ocr_used ? 'OCR used' : 'native text'}</p>)}</Card></div>;
}
