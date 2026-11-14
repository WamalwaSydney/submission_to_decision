import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, Landmark } from 'lucide-react';
import { api, FinalActItem, FinalActText } from '../api/endpoints';
import { getApiUrl } from '../api/client';
import { actSourceName } from '../utils/actSource';
import { ActBadge, ACT_NOTE, DecisionBadge } from '../components/ParticipationSummary';

/** Lower-case letters and digits with single spaces, plus where each character came from in the original. */
function normalise(text: string) {
  let norm = '';
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toLowerCase();
    if (/[a-z0-9]/.test(ch)) { norm += ch; map.push(i); space = false; }
    else if (!space) { norm += ' '; map.push(i); space = true; }
  }
  return { norm, map };
}

type Highlight = { start: number; end: number; keys: string[] };

/**
 * Where each verified quote sits in the Act text. Several submissions can point
 * to the same (or overlapping) wording, so one highlight can carry several of them.
 */
function findHighlights(text: string, items: FinalActItem[]): Highlight[] {
  const { norm, map } = normalise(text);
  const found: Highlight[] = [];
  items.forEach(item => {
    if (item.status !== 'in_act' || !item.quote) return;
    // The Act's own wording, as the server matched it, is found exactly.
    const exact = item.act_span ? text.indexOf(item.act_span) : -1;
    if (exact >= 0) { found.push({ start: exact, end: exact + item.act_span!.length, keys: [item.key] }); return; }
    const needle = normalise(item.quote).norm.trim();
    const at = needle.length >= 15 ? norm.indexOf(needle) : -1;
    if (at < 0) return;
    found.push({ start: map[at], end: map[at + needle.length - 1] + 1, keys: [item.key] });
  });
  found.sort((a, b) => a.start - b.start);
  const merged: Highlight[] = [];
  found.forEach(h => {
    const last = merged[merged.length - 1];
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      last.keys.push(...h.keys.filter(k => !last.keys.includes(k)));
    } else {
      merged.push({ ...h, keys: [...h.keys] });
    }
  });
  return merged;
}

/** The final Act, with the wording that came from adopted public submissions highlighted. */
export function ActPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const [data, setData] = useState<FinalActText | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(params.get('q'));
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api.finalActText(id).then(result => { if (!cancelled) setData(result); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the Act.'); });
    return () => { cancelled = true; };
  }, [id]);

  const highlights = useMemo(() => (data ? findHighlights(data.text, data.act.items) : []), [data]);
  const numberOf = (key: string) => highlights.findIndex(h => h.keys.includes(key)) + 1;
  // Lists follow each item's own status, so a badge and its list always agree.
  const items = data?.act.items || [];
  const inAct = items.filter(item => item.status === 'in_act' && item.evidence !== 'removed');
  const removed = items.filter(item => item.status === 'in_act' && item.evidence === 'removed');
  const notIn = items.filter(item => item.status === 'not_in_act');
  const unclear = items.filter(item => item.status === 'unclear');
  const selectedMark = highlights.find(h => selected && h.keys.includes(selected));
  const isSelected = (key: string) => selected === key || Boolean(selectedMark?.keys.includes(key));

  const jumpTo = (key: string) => {
    setSelected(key);
    const mark = textRef.current?.querySelector<HTMLElement>(`[data-keys~="${CSS.escape(key)}"]`);
    if (mark && textRef.current) {
      textRef.current.scrollTo({ top: mark.offsetTop - textRef.current.offsetTop - 80, behavior: 'smooth' });
    }
  };

  // Open on the quote the bill page linked to.
  useEffect(() => {
    const wanted = params.get('q');
    if (wanted && highlights.length) setTimeout(() => jumpTo(wanted), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights.length]);

  if (error) {
    return (
      <div className="card text-center py-16">
        <Landmark className="h-12 w-12 text-surface-300 mx-auto mb-3" aria-hidden="true" />
        <p className="text-lg font-bold text-surface-800 mb-1">The Act is not available here yet</p>
        <p className="text-surface-500 mb-6">{error}</p>
        <Link to={`/bills/${id}`} className="action-button is-primary"><ArrowLeft className="h-4 w-4" /> Back to the bill</Link>
      </div>
    );
  }
  if (!data) return <div className="card text-center py-20 text-surface-600 font-semibold" role="status">Loading the Act…</div>;

  const pieces: React.ReactNode[] = [];
  let at = 0;
  highlights.forEach((h, i) => {
    if (h.start > at) pieces.push(data.text.slice(at, h.start));
    const who = h.keys.map(k => data.recommendations[k]?.stakeholder).filter(Boolean);
    pieces.push(
      <mark key={h.keys[0]} data-keys={h.keys.join(' ')} className={`act-mark ${h.keys.some(k => k === selected) ? 'is-selected' : ''}`} tabIndex={0}
        title={who.length ? `From ${Array.from(new Set(who)).join(', ')}` : 'From a public submission'}
        onClick={() => setSelected(h.keys[0])} onKeyDown={e => { if (e.key === 'Enter') setSelected(h.keys[0]); }}>
        <sup>{i + 1}</sup>{data.text.slice(h.start, h.end)}
      </mark>,
    );
    at = h.end;
  });
  pieces.push(data.text.slice(at));

  const RecRow = ({ item, number }: { item: FinalActItem; number?: number }) => {
    const rec = data.recommendations[item.key];
    return (
      <li>
        <button type="button" className={`act-rec ${isSelected(item.key) ? 'is-selected' : ''}`} onClick={() => (number ? jumpTo(item.key) : setSelected(item.key))}>
          <span className="act-rec-head">
            {number && <span className="act-rec-num">{number}</span>}
            <strong>{!rec?.stakeholder || rec.stakeholder === 'Not named' ? 'Not named in the report' : rec.stakeholder}</strong>
            {item.section && <span className="act-rec-section">{item.section}</span>}
          </span>
          <span className="act-rec-issue">{rec?.issue}</span>
          {isSelected(item.key) && (
            <span className="act-rec-detail">
              {rec && <DecisionBadge decision={rec.decision} />} <ActBadge status={item.status} />
              {item.removed_wording && item.evidence === 'removed' && <span className="block mt-2"><strong>Removed from the bill:</strong> “{item.removed_wording}”</span>}
              <span className="block mt-2">{item.explanation}</span>
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
        <Link to={`/bills/${data.bill.id}`} className="flex items-center gap-1.5 font-semibold text-[#11521f] hover:underline"><ArrowLeft className="h-4 w-4" /> {data.bill.title}</Link>
        <span className="text-[#b9b4a8]">/</span>
        <span className="font-medium text-[#3b4747]">Final Act</span>
      </nav>

      <header className="space-y-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#a52d29] m-0"><Landmark className="inline h-4 w-4 mr-1 -mt-0.5" aria-hidden="true" />The law as passed</p>
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-[#182020] m-0">{data.act.title || 'Final Act'}</h1>
        <p className="text-sm font-semibold text-[#3b4747] m-0">{data.act.citation}{data.act.citation ? ' · ' : ''}from the {data.bill.title}</p>
        <div className="flex flex-wrap gap-3">
          {data.has_pdf && <a href={`${getApiUrl()}/bills/${encodeURIComponent(data.bill.id)}/final-act/document`} target="_blank" rel="noreferrer" className="action-button is-primary"><Download className="h-4 w-4" aria-hidden="true" /> Download the Act (PDF)</a>}
          {data.act.url && <a href={data.act.url} target="_blank" rel="noreferrer" className="action-button is-secondary"><ExternalLink className="h-4 w-4" aria-hidden="true" /> {actSourceName(data.act.url)}</a>}
        </div>
      </header>

      {data.act.counts && (
        <p className="notice-box is-info !m-0">
          <strong>{inAct.length}</strong> recommendation{inAct.length === 1 ? '' : 's'} the committee adopted from public submissions {inAct.length === 1 ? 'is' : 'are'} in the Act, highlighted below in {highlights.length} place{highlights.length === 1 ? '' : 's'}
          {removed.length ? `, and ${removed.length} led to wording being removed` : ''}. {notIn.length} did not make it into the law and {unclear.length} could not be confirmed. {ACT_NOTE}
        </p>
      )}

      <div className="act-reader">
        <aside className="act-reader-side" aria-label="Recommendations">
          <h2>In the law ({inAct.length})</h2>
          {inAct.length ? <ol>{inAct.map(item => <RecRow key={item.key} item={item} number={numberOf(item.key) || undefined} />)}</ol> : <p>None found in the Act text.</p>}
          {removed.length > 0 && <details open><summary>Removed from the bill ({removed.length})</summary><ul>{removed.map(item => <RecRow key={item.key} item={item} />)}</ul></details>}
          {notIn.length > 0 && <details><summary>Not in the law ({notIn.length})</summary><ul>{notIn.map(item => <RecRow key={item.key} item={item} />)}</ul></details>}
          {unclear.length > 0 && <details><summary>Could not confirm ({unclear.length})</summary><ul>{unclear.map(item => <RecRow key={item.key} item={item} />)}</ul></details>}
        </aside>
        <div className="act-reader-text" ref={textRef} tabIndex={0} aria-label="Text of the Act">
          <pre>{pieces}</pre>
        </div>
      </div>
    </div>
  );
}
