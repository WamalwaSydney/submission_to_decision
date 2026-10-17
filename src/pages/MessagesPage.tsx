import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card } from '../components/UI';

export function MessagesPage() {
  const { state } = useApp();
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<any[]>([]);
  const [subject, setSubject] = useState('Question about my submission');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const committeeId = params.get('committee') || '';
  const billId = params.get('bill') || undefined;
  const receiptRef = params.get('receipt') || undefined;

  const load = () => api.messages().then(r => setMessages(r.messages)).catch(e => setStatus(e instanceof Error ? e.message : 'Unable to load messages.'));
  useEffect(() => { load(); }, []);
  const send = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus('');
    try { await api.sendMessage({ committee_id: committeeId || undefined, bill_id: billId, subject, body, message_type: receiptRef ? 'outcome_question' : 'general' }); setBody(''); setStatus('Message sent.'); load(); }
    catch (e) { setStatus(e instanceof Error ? e.message : 'Unable to send message.'); }
  };
  return <div className="space-y-6"><Card><h1 className="text-4xl font-black">Messages</h1><p className="text-surface-600 mt-2">Ask a committee for clarification about a submission outcome or send a response to a citizen.</p></Card>
    <Card><h2 className="text-xl font-black mb-4">Send a message</h2><form onSubmit={send} className="space-y-3"><select className="input-field" value={committeeId} disabled><option value="">Choose a committee from a bill flow</option>{state.committees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input className="input-field" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" required /><textarea className="input-field min-h-32" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message" required /><button className="btn-primary" type="submit" disabled={!committeeId || !state.currentUser}>Send message</button>{status && <p className="text-sm mt-2">{status}</p>}</form></Card>
    <Card><h2 className="text-xl font-black mb-4">Conversation history</h2><div className="space-y-3">{messages.map(m => <div key={m.id} className={`rounded-xl border p-4 ${m.is_read ? '' : 'border-primary-400 bg-primary-50/40'}`}><div className="flex justify-between gap-4"><strong>{m.subject}</strong><span className="text-xs text-surface-500">{new Date(m.created_at).toLocaleString()}</span></div><p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>{!m.is_read && <button className="text-xs text-primary-700 mt-3" onClick={() => api.markMessageRead(m.id).then(load)}>Mark as read</button>}</div>)}{!messages.length && <p className="text-surface-500">No messages yet.</p>}</div></Card></div>;
}
