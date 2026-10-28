import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../components/Layout.jsx';
import RangePicker from '../components/RangePicker.jsx';
import { Chevron } from '../components/Icons.jsx';
import { useApi } from '../hooks/useApi.js';
import { count, rangeWords, timeAgo } from '../lib/format.js';

export default function Errors() {
  const { projectId, range } = useProject();
  const { data, error } = useApi(`/api/projects/${projectId}/issues?range=${range}`, { refreshMs: 20_000 });
  const [open, setOpen] = useState(null);
  const issues = data?.issues;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>Errors</h1>
          <p className="muted">Crashes grouped by error type and message, most recent first.</p>
        </div>
        <RangePicker />
      </div>
      {error && <p className="error-text" role="alert">{error.message}</p>}

      <section className="panel">
        {!issues ? (
          <div className="panel-body" style={{ paddingTop: 18 }}><div className="skeleton" style={{ height: 180 }} /></div>
        ) : issues.length === 0 ? (
          <div className="empty">
            <h2>No errors in {rangeWords(range)}</h2>
            <p>When your app throws, each kind of error shows up here once, with how often it happened.</p>
          </div>
        ) : (
          issues.map((i) => {
            const isOpen = open === i.id;
            return (
              <div className="issue" key={i.id} data-open={isOpen}>
                <button type="button" className="issue-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.id)}>
                  <span className="issue-title">
                    <strong>{i.errorName}: {i.message}</strong>
                    <span>{i.routes.length ? `in ${i.routes.join(', ')}` : i.services.join(', ')}</span>
                  </span>
                  <span className="issue-count">{count(i.count)}<small>{i.count === 1 ? 'time' : 'times'}</small></span>
                  <span className="when muted" style={{ fontSize: 13 }} title={new Date(i.lastSeen).toLocaleString()}>
                    Last {timeAgo(i.lastSeen)}
                  </span>
                  <Chevron className="chev" />
                </button>
                {isOpen && (
                  <div>
                    <div style={{ padding: '0 18px 12px', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }} className="muted">
                      <span>First seen {timeAgo(i.firstSeen)}</span>
                      <span>Services: {i.services.join(', ')}</span>
                      <Link to={`/p/${projectId}/logs?range=${range}&type=error&q=${encodeURIComponent(i.message)}`}>View occurrences in logs</Link>
                    </div>
                    {i.stack ? <pre className="stack mono">{i.stack}</pre> : <p className="muted" style={{ padding: '0 18px 16px' }}>No stack trace was recorded for this error.</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
