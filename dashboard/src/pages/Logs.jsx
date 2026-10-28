import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProject } from '../components/Layout.jsx';
import RangePicker from '../components/RangePicker.jsx';
import { api } from '../lib/api.js';
import { clock, duration, rangeWords } from '../lib/format.js';

const TYPES = [
  { key: '', label: 'Everything' },
  { key: 'request', label: 'Requests' },
  { key: 'error', label: 'Errors' },
  { key: 'log', label: 'Log messages' },
];
const LEVELS = [
  { key: '', label: 'Any level' },
  { key: 'warn,error', label: 'Warnings and errors' },
  { key: 'error', label: 'Errors only' },
];

export default function Logs() {
  const { projectId, range, live } = useProject();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || '';
  const level = params.get('level') || '';
  const q = params.get('q') || '';
  const [search, setSearch] = useState(q);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [following, setFollowing] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [liveSince, setLiveSince] = useState(Date.now());

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Debounce typing into the search box.
  useEffect(() => {
    const t = setTimeout(() => search !== q && setParam('q', search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const p = new URLSearchParams({ range, limit: '100' });
    if (type) p.set('type', type);
    if (level) p.set('level', level);
    if (q) p.set('q', q);
    return p;
  }, [range, type, level, q]);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus('loading');
    setError(null);
    api(`/api/projects/${projectId}/logs?${query}`, { signal: ctrl.signal })
      .then((d) => {
        setItems(d.items);
        setCursor(d.nextCursor);
        setStatus('ready');
        setLiveSince(Date.now());
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError(e);
          setStatus('ready');
        }
      });
    return () => ctrl.abort();
  }, [projectId, query]);

  const loadOlder = async () => {
    setStatus('more');
    try {
      const d = await api(`/api/projects/${projectId}/logs?${query}&before=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...d.items]);
      setCursor(d.nextCursor);
    } catch (e) {
      setError(e);
    }
    setStatus('ready');
  };

  // Live tail: new events from the WebSocket that match the current filters.
  const fresh = useMemo(() => {
    if (!following) return [];
    const levels = level ? level.split(',') : null;
    const needle = q.toLowerCase();
    return live.events.filter(
      (e) =>
        new Date(e.timestamp).getTime() > liveSince &&
        (!type || e.type === type) &&
        (!levels || levels.includes(e.level)) &&
        (!needle || (e.message || '').toLowerCase().includes(needle)),
    );
  }, [live.events, following, type, level, q, liveSince]);

  const rows = [...fresh, ...items];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>Logs</h1>
          <p className="muted">Every request, error and log message, newest first.</p>
        </div>
        <RangePicker />
      </div>

      <div className="filters">
        <label className="sr-only" htmlFor="log-search">Search messages</label>
        <input id="log-search" className="input" type="search" placeholder="Search messages, like “payment” or “timeout”" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="sr-only" htmlFor="log-type">Event type</label>
        <select id="log-type" className="select" value={type} onChange={(e) => setParam('type', e.target.value)}>
          {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="log-level">Level</label>
        <select id="log-level" className="select" value={level} onChange={(e) => setParam('level', e.target.value)}>
          {LEVELS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={following} onChange={(e) => { setFollowing(e.target.checked); setLiveSince(Date.now()); }} />
          <i className={`live-dot${following && live.connected ? ' on' : ''}`} />Show new events as they arrive
        </label>
      </div>

      {error && <p className="error-text" role="alert">{error.message}</p>}

      <section className="panel loglist" aria-busy={status === 'loading'}>
        {status === 'loading' && items.length === 0 ? (
          <div className="panel-body" style={{ paddingTop: 18 }}><div className="skeleton" style={{ height: 240 }} /></div>
        ) : rows.length === 0 ? (
          <div className="empty" style={{ fontFamily: 'var(--font)' }}>
            <h2>Nothing matches</h2>
            <p>No events in {rangeWords(range)} match these filters. Try a wider time range or clear the search.</p>
          </div>
        ) : (
          <>
            {rows.map((e) => (
              <LogLine key={e.id} e={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />
            ))}
            <div className="log-foot">
              {cursor ? (
                <button type="button" className="btn" onClick={loadOlder} disabled={status === 'more'} style={{ fontFamily: 'var(--font)' }}>
                  {status === 'more' ? 'Loading…' : 'Load older events'}
                </button>
              ) : (
                <span className="faint" style={{ fontFamily: 'var(--font)', fontSize: 13 }}>That's everything in {rangeWords(range)}.</span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LogLine({ e, open, onToggle }) {
  const message = e.type === 'error' ? `${e.errorName || 'Error'}: ${e.message}` : e.message || `${e.method} ${e.route} ${e.status}`;
  const meta = e.type === 'request' ? `${duration(e.durationMs)}` : e.route || e.service;
  return (
    <>
      <div
        className={`logline${e.live ? ' fresh' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onToggle())}
      >
        <span className="time" title={new Date(e.timestamp).toLocaleString()}>{clock(e.timestamp)}</span>
        <span className={`level ${e.level}`}>{e.level}</span>
        <span className="msg">{message}</span>
        <span className="meta">{meta}</span>
      </div>
      {open && (
        <div className="log-detail">
          <div className="chips" style={{ fontFamily: 'var(--font)' }}>
            <span className="chip">{e.type}</span>
            <span className="chip">{e.service}</span>
            {e.status != null && <span className="chip">status {e.status}</span>}
            {e.route && <span className="chip">{e.method} {e.route}</span>}
            <span className="chip">{new Date(e.timestamp).toLocaleString()}</span>
          </div>
          {e.stack && <pre className="mono">{e.stack}</pre>}
          {e.attrs && <pre className="mono">{JSON.stringify(e.attrs, null, 2)}</pre>}
        </div>
      )}
    </>
  );
}
