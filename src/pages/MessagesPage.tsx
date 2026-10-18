import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card } from '../components/UI';
import { CheckCircle2, Loader2 } from 'lucide-react';

export function MessagesPage() {
  const { state, dispatch } = useApp();
  const [messages, setMessages] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [language, setLanguage] = useState<'en' | 'sw'>(state.currentUser?.notification_language === 'sw' ? 'sw' : 'en');
  const [savingLanguage, setSavingLanguage] = useState(false);

  const load = () => api.messages().then(r => setMessages(r.messages)).catch(e => setStatus(e instanceof Error ? e.message : 'Unable to load messages.'));
  const saveLanguage = async () => {
    setSavingLanguage(true); setStatus('');
    try {
      const result = await api.updateNotificationLanguage(language);
      if (state.currentUser) {
        const updated = { ...state.currentUser, notification_language: result.notification_language };
        localStorage.setItem('current_user', JSON.stringify(updated));
        dispatch({ type: 'SET_USER', payload: updated });
      }
      setStatus(language === 'sw' ? 'Lugha ya arifa imehifadhiwa.' : 'Notification language saved.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to save notification language.'); }
    finally { setSavingLanguage(false); }
  };
  useEffect(() => { if (state.currentUser?.role === 'citizen') load(); }, [state.currentUser?.role]);
  if (state.currentUser?.role !== 'citizen') return <Card><h1 className="text-2xl font-black">Citizen updates</h1><p className="mt-2 text-surface-600">Automated notification inboxes are available to citizen accounts only.</p></Card>;
  return <div className="space-y-6"><Card><h1 className="text-4xl font-black">Automated Updates</h1><p className="text-surface-600 mt-2">Polite, source-grounded notifications about meaningful changes to your submissions. A human reviewer confirms proposed matches before they are treated as final.</p><div className="mt-5 flex flex-col sm:flex-row sm:items-end gap-3"><label className="flex-1 text-sm font-bold">Notification language<select className="input-field mt-1" value={language} onChange={e => setLanguage(e.target.value as 'en' | 'sw')}><option value="en">English</option><option value="sw">Kiswahili</option></select></label><button className="btn-secondary" type="button" onClick={saveLanguage} disabled={savingLanguage}>{savingLanguage ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save preference</button></div>{status && <p role="status" className="mt-2 text-sm text-surface-600">{status}</p>}</Card>
    <Card><h2 className="text-xl font-black mb-4">Notification history</h2><div className="space-y-3">{messages.map(m => <div key={m.id} className={`rounded-xl border p-4 ${m.is_read ? '' : 'border-primary-400 bg-primary-50/40'}`}><div className="flex justify-between gap-4"><div><strong>{m.subject}</strong><div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide text-surface-500"><span>{m.language === 'sw' ? 'Kiswahili' : 'English'}</span><span>·</span><span>{m.generation_source === 'gemini' ? 'AI-drafted' : 'Reviewed template'}</span></div></div><span className="text-xs text-surface-500">{new Date(m.created_at).toLocaleString()}</span></div><p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>{!m.is_read && <button className="text-xs text-primary-700 mt-3" onClick={() => api.markMessageRead(m.id).then(load)}>Mark as read</button>}</div>)}{!messages.length && <p className="text-surface-500">No updates yet. Meaningful changes to your submissions will appear here.</p>}</div></Card></div>;
}
