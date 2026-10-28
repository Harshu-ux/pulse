import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../components/Layout.jsx';
import RangePicker from '../components/RangePicker.jsx';
import PulseStrip from '../components/PulseStrip.jsx';
import { ChartSkeleton, ErrorRateChart, LatencyChart, LatencyLegend, TrafficChart } from '../components/Charts.jsx';
import { AlertIcon, CheckIcon, IdleIcon, SlowIcon } from '../components/Icons.jsx';
import { useApi } from '../hooks/useApi.js';
import { healthVerdict } from '../lib/health.js';
import { count, delta, duration, durationParts, pct, rangeWords } from '../lib/format.js';

const REFRESH_MS = { '15m': 10_000, '1h': 15_000, '6h': 30_000, '24h': 60_000, '7d': 120_000 };
const BUCKET_LABEL = { '15m': '30 seconds', '1h': 'minute', '6h': '5 minutes', '24h': '15 minutes', '7d': '2 hours' };

export default function Overview() {
  const { projectId, range, live, project } = useProject();
  const base = `/api/projects/${projectId}`;
  const opts = { refreshMs: REFRESH_MS[range] };
  const overview = useApi(`${base}/overview?range=${range}`, opts);
  const series = useApi(`${base}/timeseries?range=${range}`, opts);
  const endpoints = useApi(`${base}/endpoints?range=${range}`, opts);

  // When live data starts arriving after a quiet period, refresh straight away
  // instead of waiting for the next poll (so a new project lights up instantly).
  const wasEmpty = overview.data && overview.data.requests === 0;
  const refreshed = useRef(0);
  useEffect(() => {
    if (wasEmpty && live.lastMessageAt && live.lastMessageAt - refreshed.current > 5000) {
      refreshed.current = live.lastMessageAt;
      overview.reload();
      series.reload();
      endpoints.reload();
    }
  }, [live.lastMessageAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const o = overview.data;
  const verdict = useMemo(() => (o ? healthVerdict(o, endpoints.data?.endpoints, range) : null), [o, endpoints.data, range]);
  const points = series.data?.points || [];
  const error = overview.error || series.error || endpoints.error;

  return (
    <div className="page">
      <div className="page-head">
        <div className="faint">{project?.name}</div>
        <RangePicker />
      </div>

      {error && <p className="error-text" role="alert">{error.message}</p>}

      {verdict ? <Verdict verdict={verdict} projectId={projectId} /> : <VerdictSkeleton />}

      <PulseStrip live={live} />

      <section className="panel kpis" aria-label="Key numbers">
        <Kpi label="Requests per minute" value={o && count(o.rpm)} d={o && delta(o.rpm, o.previous.rpm, { higherIsWorse: false })} neutral />
        <Kpi label="Failed requests" value={o && pct(o.errorRate)} unit="%" d={o && delta(o.errorRate, o.previous.errorRate)} />
        <Kpi label="95% finish within" {...(o ? durationParts(o.p95) : {})} d={o && delta(o.p95, o.previous.p95)} />
        <Kpi label="Errors logged" value={o && count(o.errorEvents)} link={`/p/${projectId}/errors?range=${range}`} />
      </section>

      <div className="chart-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Requests</h2>
            <p>Per {BUCKET_LABEL[range]}</p>
          </div>
          <div className="panel-body">{series.data ? <TrafficChart points={points} range={range} bucketLabel={BUCKET_LABEL[range]} /> : <ChartSkeleton />}</div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Failed requests</h2>
            <p>Share of requests answered with a 5xx error</p>
          </div>
          <div className="panel-body">{series.data ? <ErrorRateChart points={points} range={range} /> : <ChartSkeleton />}</div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div style={{ display: 'grid', gap: 2 }}>
            <h2>Response time</h2>
            <p>How long requests took. p95 means 95% of requests were faster than this line.</p>
          </div>
          <LatencyLegend />
        </div>
        <div className="panel-body">{series.data ? <LatencyChart points={points} range={range} /> : <ChartSkeleton />}</div>
      </section>

      <EndpointsTable data={endpoints.data?.endpoints} range={range} />
    </div>
  );
}

function Verdict({ verdict, projectId }) {
  const Icon = { good: CheckIcon, warning: verdict.headline.includes('slower') ? SlowIcon : AlertIcon, critical: AlertIcon, idle: IdleIcon }[verdict.tone];
  const toneWord = { good: 'Healthy', warning: 'Needs attention', critical: 'Problem', idle: 'No data' }[verdict.tone];
  return (
    <section className="verdict" aria-live="polite">
      <div className={`verdict-mark ${verdict.tone}`} title={toneWord}>
        <Icon width={22} height={22} />
        <span className="sr-only">{toneWord}:</span>
      </div>
      <h1>{verdict.headline}</h1>
      <p>
        {verdict.detail}
        {verdict.tone === 'idle' && <> <Link to={`/p/${projectId}/setup`}>Open setup</Link></>}
      </p>
    </section>
  );
}

function VerdictSkeleton() {
  return (
    <div className="verdict" aria-hidden="true">
      <div className="verdict-mark idle" />
      <div className="skeleton" style={{ height: 34, width: '55%' }} />
      <div className="skeleton" style={{ height: 18, width: '75%' }} />
    </div>
  );
}

function Kpi({ label, value, unit, d, neutral, link }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className="value">
        {value ?? <span className="skeleton" style={{ display: 'inline-block', width: 70, height: 26 }} />}
        {value != null && unit && <small>{unit}</small>}
      </span>
      {d && <span className={`delta ${neutral ? 'same' : d.tone}`}>{d.text}</span>}
      {link && value != null && <Link to={link} className="delta" style={{ color: 'var(--accent)' }}>See grouped errors</Link>}
    </div>
  );
}

const COLUMNS = [
  { key: 'route', label: 'Endpoint' },
  { key: 'requests', label: 'Requests', r: true },
  { key: 'errorRate', label: 'Failed', r: true },
  { key: 'p50', label: 'Median', r: true },
  { key: 'p95', label: 'p95', r: true },
];

function EndpointsTable({ data, range }) {
  const [sort, setSort] = useState({ key: 'requests', dir: -1 });
  const rows = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sort.dir;
    });
  }, [data, sort]);
  const maxReq = Math.max(1, ...rows.map((r) => r.requests));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Endpoints</h2>
        <p>Grouped by route pattern, {rangeWords(range)}</p>
      </div>
      {!data ? (
        <div className="panel-body"><div className="skeleton" style={{ height: 160 }} /></div>
      ) : rows.length === 0 ? (
        <div className="empty"><p>No requests recorded in {rangeWords(range)}.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.r ? 'r' : undefined} aria-sort={sort.key === c.key ? (sort.dir < 0 ? 'descending' : 'ascending') : undefined}>
                    <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : c.key === 'route' ? 1 : -1 }))}>
                      {c.label}{sort.key === c.key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.method} ${e.route}`}>
                  <td><span className="method">{e.method}</span><span className="route">{e.route}</span></td>
                  <td className="r">
                    <div className="bar-cell">{count(e.requests)}<span className="bar" aria-hidden="true"><i style={{ width: `${(e.requests / maxReq) * 100}%` }} /></span></div>
                  </td>
                  <td className="r"><span className={`rate ${e.errorRate >= 5 ? 'bad' : e.errorRate >= 1 ? 'meh' : ''}`}>{pct(e.errorRate)}%</span></td>
                  <td className="r">{duration(e.p50)}</td>
                  <td className="r">{duration(e.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
