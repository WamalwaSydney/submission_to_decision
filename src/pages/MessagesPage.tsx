import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { CheckCircle2, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Card, Pager, usePaged } from '../components/UI';

const MESSAGES_PER_PAGE = 10;

const TYPE_LABELS: Record<string, string> = {
  submission_received: 'Submission received',
  notice_published: 'Call for views',
  report_received: 'Committee report',
  match_pending: 'Response found',
  no_match_yet: 'No response yet',
  match_confirmed: 'Response confirmed',
  match_rejected: 'Not addressed',
  outcome_updated: 'Outcome updated',
};
const typeLabel = (type: string) => TYPE_LABELS[type] || type.replace(/_/g, ' ');

type ReadFilter = 'all' | 'unread' | 'read';
const READ_FILTERS: { id: ReadFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'read', label: 'Read' },
];

const formatWhen = (value?: string) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function MessagesPage() {
  const { state, dispatch } = useApp();
  const [messages, setMessages] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  const [language, setLanguage] = useState<'en' | 'sw'>(state.currentUser?.notification_language === 'sw' ? 'sw' : 'en');
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [messageLanguage, setMessageLanguage] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = () => api.messages()
    .then(r => { setMessages(r.messages); setLoaded(true); })
    .catch(e => { setStatus(e instanceof Error ? e.message : 'Unable to load messages.'); setLoaded(true); });

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

  const billTitles = useMemo(() => new Map(state.bills.map(b => [b.id, b.title])), [state.bills]);
  const types = useMemo(() => [...new Set(messages.map(m => m.message_type).filter(Boolean))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b))), [messages]);

  // Every filter except read/unread, so each chip shows what it would leave.
  const base = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages
      .filter(m => type === 'all' || m.message_type === type)
      .filter(m => messageLanguage === 'all' || m.language === messageLanguage)
      .filter(m => !needle || `${m.subject} ${m.body} ${m.receipt_public_id || ''} ${billTitles.get(m.bill_id) || ''}`.toLowerCase().includes(needle));
  }, [messages, type, messageLanguage, query, billTitles]);

  const counts: Record<ReadFilter, number> = {
    all: base.length,
    unread: base.filter(m => !m.is_read).length,
    read: base.filter(m => m.is_read).length,
  };
  const unreadTotal = messages.filter(m => !m.is_read).length;

  const visible = useMemo(() => base
    .filter(m => readFilter === 'all' || (readFilter === 'unread' ? !m.is_read : m.is_read))
    .sort((a, b) => (sortBy === 'newest' ? -1 : 1) * (a.created_at || '').localeCompare(b.created_at || '')),
  [base, readFilter, sortBy]);

  const paged = usePaged(visible, MESSAGES_PER_PAGE, `${readFilter}|${query}|${type}|${messageLanguage}|${sortBy}`);
  const selected = messages.find(m => m.id === selectedId) || null;
  const filtersActive = readFilter !== 'all' || query.trim() !== '' || type !== 'all' || messageLanguage !== 'all';
  const clearFilters = () => { setReadFilter('all'); setQuery(''); setType('all'); setMessageLanguage('all'); };

  // Opening an update marks it as read.
  const openMessage = (message: any) => {
    setSelectedId(message.id);
    if (!message.is_read) {
      setMessages(list => list.map(m => (m.id === message.id ? { ...m, is_read: true } : m)));
      api.markMessageRead(message.id).catch(() => load());
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.markAllMessagesRead();
      setMessages(list => list.map(m => ({ ...m, is_read: true })));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to mark updates as read.');
    } finally {
      setMarkingAll(false);
    }
  };

  if (state.currentUser?.role !== 'citizen') {
    return <Card><h1 className="text-2xl font-black">Citizen updates</h1><p className="mt-2 text-surface-600">Automated notification inboxes are available to citizen accounts only.</p></Card>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <h1 className="text-4xl font-black">Automated Updates</h1>
        <p className="text-surface-600 mt-2">Notifications about meaningful changes to your submissions, based on the official record. A human reviewer confirms proposed matches before they are treated as final.</p>
        <div className="mt-5 flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="flex-1 text-sm font-bold">Notification language
            <select className="input-field mt-1" value={language} onChange={e => setLanguage(e.target.value as 'en' | 'sw')}>
              <option value="en">English</option>
              <option value="sw">Kiswahili</option>
            </select>
          </label>
          <button className="btn-secondary" type="button" onClick={saveLanguage} disabled={savingLanguage}>
            {savingLanguage ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save preference
          </button>
        </div>
        {status && <p role="status" className="mt-2 text-sm text-surface-600">{status}</p>}
      </Card>

      <Card className="!p-6 md:!p-7">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-black m-0">Notification history</h2>
          {unreadTotal > 0 && (
            <button type="button" onClick={markAllRead} disabled={markingAll} className="text-sm font-bold text-primary-600 hover:underline disabled:opacity-60">
              {markingAll ? 'Marking…' : `Mark all ${unreadTotal} as read`}
            </button>
          )}
        </div>

        {!loaded ? (
          <p className="text-surface-500">Loading updates…</p>
        ) : !messages.length ? (
          <p className="text-surface-500">No updates yet. Meaningful changes to your submissions will appear here.</p>
        ) : (
          <>
            <section className="bill-filters mb-4" aria-label="Filter updates">
              <div className="bill-filter-chips" role="tablist" aria-label="Read status">
                {READ_FILTERS.map(item => (
                  <button key={item.id} type="button" role="tab" aria-selected={readFilter === item.id} className={`bill-chip ${readFilter === item.id ? 'is-active' : ''}`} onClick={() => setReadFilter(item.id)}>
                    {item.label} <span>{counts[item.id]}</span>
                  </button>
                ))}
              </div>
              <div className="bill-filter-row notice-filter-row">
                <div className="bill-search">
                  <label htmlFor="message-search" className="sr-only">Search updates</label>
                  <Search className="h-5 w-5" aria-hidden="true" />
                  <input id="message-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search updates" className="input-field" />
                </div>
                <label className="sr-only" htmlFor="message-type">Type</label>
                <select id="message-type" className="input-field" value={type} onChange={e => setType(e.target.value)}>
                  <option value="all">All types</option>
                  {types.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
                </select>
                <label className="sr-only" htmlFor="message-language">Language</label>
                <select id="message-language" className="input-field" value={messageLanguage} onChange={e => setMessageLanguage(e.target.value)}>
                  <option value="all">All languages</option>
                  <option value="en">English</option>
                  <option value="sw">Kiswahili</option>
                </select>
                <label className="sr-only" htmlFor="message-sort">Sort</label>
                <select id="message-sort" className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-sm font-semibold text-surface-600 m-0" role="status">
                {visible.length ? `${paged.summary} ${visible.length === 1 ? 'update' : 'updates'}` : 'No updates'}
                {visible.length !== messages.length ? ` (filtered from ${messages.length})` : ''}
              </p>
              {filtersActive && <button type="button" onClick={clearFilters} className="text-sm font-bold text-primary-600 hover:underline">Clear filters</button>}
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-surface-300 p-8 text-center text-sm text-surface-600">
                <p className="font-bold text-surface-800 mb-1">No updates match these filters.</p>
                <p className="m-0">Try another type, language or search term.</p>
              </div>
            ) : (
              <div className="submissions-table-wrap">
                <table className="submissions-table">
                  <thead>
                    <tr><th><span className="sr-only">Read status</span></th><th>Update</th><th>Type</th><th>Submission</th><th>Received</th><th><span className="sr-only">Open</span></th></tr>
                  </thead>
                  <tbody>
                    {paged.rows.map(message => {
                      const open = () => openMessage(message);
                      return (
                        <tr key={message.id} tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                          aria-label={`${message.is_read ? '' : 'Unread: '}${message.subject}`} className={message.is_read ? '' : 'bg-primary-50/40'}>
                          <td className="!pr-0 w-6">{!message.is_read && <span className="block h-2.5 w-2.5 rounded-full bg-primary-600" title="Unread" />}</td>
                          <td>
                            <div className={`excerpt !max-w-[340px] ${message.is_read ? '' : 'font-black text-surface-900'}`}>{message.subject}</div>
                            <div className="excerpt !max-w-[340px] text-xs text-surface-500">{message.body}</div>
                          </td>
                          <td className="whitespace-nowrap text-xs font-bold">{typeLabel(message.message_type)}</td>
                          <td>{message.receipt_public_id ? <span className="receipt-id">{message.receipt_public_id}</span> : '—'}</td>
                          <td className="whitespace-nowrap text-xs">{formatWhen(message.created_at)}</td>
                          <td className="chevron"><ChevronRight size={18} aria-hidden="true" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pager page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} label="Update pages" className="mt-4 !border !border-[#e2ded5] !rounded-2xl" />
          </>
        )}
      </Card>

      <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} fullWidth maxWidth="sm" scroll="paper" aria-labelledby="message-dialog-title">
        {selected && (
          <>
            <DialogTitle id="message-dialog-title" sx={{ pr: 7, pb: 1 }}>
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#a52d29]">{typeLabel(selected.message_type)}</span>
              <span className="block text-xl font-black text-[#182020] mt-1">{selected.subject}</span>
              <IconButton onClick={() => setSelectedId(null)} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}><X size={20} /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
              <dl className="submission-detail-meta">
                <div><dt>Received</dt><dd>{formatWhen(selected.created_at)}</dd></div>
                <div><dt>Language</dt><dd>{selected.language === 'sw' ? 'Kiswahili' : 'English'}</dd></div>
                <div><dt>Written by</dt><dd>{selected.generation_source === 'gemini' ? 'AI-drafted' : 'Reviewed template'}</dd></div>
                {selected.bill_id && billTitles.get(selected.bill_id) && (
                  <div style={{ gridColumn: '1 / -1' }}><dt>Bill</dt><dd><Link to={`/bills/${selected.bill_id}`} className="underline">{billTitles.get(selected.bill_id)}</Link></dd></div>
                )}
              </dl>
              <p className="submission-detail-text whitespace-pre-wrap">{selected.body}</p>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
              {selected.receipt_public_id && (
                <Link to={`/receipt-lookup?id=${selected.receipt_public_id}`} className="action-button is-secondary">View submission {selected.receipt_public_id}</Link>
              )}
              <button type="button" onClick={() => setSelectedId(null)} className="action-button is-primary">Close</button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}
