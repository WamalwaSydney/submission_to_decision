import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card } from '../components/UI';
import { confidenceClasses, confidenceLabel } from '../utils/confidence';
import { reportDocumentHref } from '../utils/reportLinks';
import { ArrowUpRight, CheckCircle2, FileCheck2, FileText, FileUp, Gavel, Loader2, UploadCloud, X } from 'lucide-react';

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
  return <div className="committee-dashboard space-y-7">
    <header className="committee-dashboard-hero">
      <div>
        <span className="committee-dashboard-kicker">Committee workspace</span>
        <h1>Committee dashboard</h1>
        <p>Publish bills and official documents so citizens can follow legislation and its participation trail.</p>
      </div>
      <div className="committee-dashboard-hero-mark" aria-hidden="true"><Gavel size={30} strokeWidth={1.8} /></div>
    </header>

    <section className="committee-dashboard-stats" aria-label="Workspace overview">
      <div className="committee-dashboard-stat"><span className="committee-dashboard-stat-icon red"><FileText size={20} /></span><span><strong>{bills.length}</strong><small>Published bills</small></span></div>
      <div className="committee-dashboard-stat"><span className="committee-dashboard-stat-icon green"><FileCheck2 size={20} /></span><span><strong>{bills.filter(bill => Boolean(bill.pdf_url || bill.document_url)).length}</strong><small>With documents</small></span></div>
      <Link className="committee-dashboard-shortcut" to="/committee/ingestion"><span>Manage report ingestion</span><ArrowUpRight size={17} /></Link>
    </section>

    <section className="committee-dashboard-content">
    <Card className="committee-dashboard-form-card"><div className="committee-dashboard-section-heading"><div className="committee-dashboard-icon-tile"><FileUp size={22} strokeWidth={2.3} aria-hidden="true" /></div><div><p className="committee-dashboard-section-kicker">New publication</p><h2>Ingest a bill</h2><p>Required: title and unique identifier. Add the official PDF when available.</p></div></div><form onSubmit={ingest} className="grid gap-4 md:grid-cols-2">
      <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-surface-600">Bill title</span><input className="input-field mt-1" required placeholder="e.g. Nairobi County Finance Bill, 2026" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label><span className="text-xs font-black uppercase tracking-wide text-surface-600">Unique bill identifier</span><input className="input-field mt-1" required placeholder="e.g. NCA/2026/Bill-003" value={form.identifier} onChange={e => setForm({ ...form, identifier: e.target.value })} /></label>
      <label><span className="text-xs font-black uppercase tracking-wide text-surface-600">Current stage</span><select className="input-field mt-1" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}><option>Introduced</option><option>Public Participation</option><option>Committee Stage</option><option>Second Reading</option></select></label>
      <label className="md:col-span-2"><span className="text-xs font-black uppercase tracking-wide text-surface-600">Official source URL (optional)</span><input className="input-field mt-1" type="url" placeholder="https://www.parliament.go.ke/..." value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} /></label>
      <div className="md:col-span-2">
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { chooseBillFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInputRef.current?.click()} className="committee-dashboard-file-picker">
          <span className="committee-dashboard-file-icon"><UploadCloud size={25} strokeWidth={2.2} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">{billFile ? <><span className="block font-bold text-surface-900 truncate">{billFile.name}</span><span className="text-xs text-surface-500">{(billFile.size / (1024 * 1024)).toFixed(1)} MB · PDF selected</span></> : <><span className="block font-bold text-surface-900">Select official bill PDF</span><span className="text-xs text-surface-500">Browse your device · PDF up to 50 MB</span></>}</span>
          {billFile ? <span onClick={e => { e.stopPropagation(); setBillFile(null); }} className="p-2 rounded-lg hover:bg-white text-surface-500" aria-label="Remove bill PDF"><X size={17} /></span> : <FileText size={20} className="text-surface-400 shrink-0" />}
        </button>
      </div>
      <button className="btn-primary md:col-span-2 inline-flex items-center justify-center gap-2" type="submit" disabled={saving || !form.title.trim() || !form.identifier.trim()}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading bill...</> : <><FileUp size={17} /> Upload and publish bill</>}</button>
    </form>{message && <p role="status" className={`mt-4 text-sm font-semibold flex items-center gap-2 ${message.includes('ingested') ? 'text-green-700' : 'text-red-700'}`}>{message.includes('ingested') && <CheckCircle2 className="h-4 w-4" />}{message}</p>}</Card>

    <Card className="committee-dashboard-bills-card"><div className="committee-dashboard-bills-heading"><div><p className="committee-dashboard-section-kicker">Legislation</p><h2>Your bills</h2></div><span>{bills.length} total</span></div><div className="committee-dashboard-bills">{bills.map(bill => <article key={bill.id} className="committee-dashboard-bill-row"><span className="committee-dashboard-bill-mark"><Gavel size={18} /></span><div className="committee-dashboard-bill-info"><p>{bill.title}</p><span>{bill.identifier} <i>·</i> {bill.stage}</span></div><Link className="committee-dashboard-flow-link" to={`/bill-flow/${bill.id}`}>View public flow <ArrowUpRight size={15} /></Link></article>)}{!bills.length && <div className="committee-dashboard-empty"><FileText size={24} /><strong>No bills published yet</strong><span>Use the form to add the first bill to your public flow.</span></div>}</div></Card>
    </section>
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
    <Card><h2 className="text-xl font-black mb-3">Committee reports</h2>{flow.reports.map((r: any) => <a key={r.id} href={reportDocumentHref(r)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 text-sm border-b py-3 text-primary-700 hover:text-primary-900"><span>{r.title || r.source_document_ref} · {r.extraction_status} · {r.ocr_used ? 'OCR used' : 'native text'}</span><ArrowUpRight className="h-4 w-4 flex-shrink-0" /></a>)}</Card></div>;
}
