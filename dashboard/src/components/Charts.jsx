import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useThemeColors } from '../hooks/useThemeColors.js';
import { count, duration, pct, tick, tooltipTime } from '../lib/format.js';

const HEIGHT = 220;

function axisProps(c) {
  return {
    tick: { fill: c['ink-3'], fontSize: 12 },
    tickLine: false,
    axisLine: false,
  };
}

function ChartTooltip({ active, payload, label, range, rows }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="t">{tooltipTime(label, range)}</div>
      {rows.map((r) => (
        <div className="row" key={r.key}>
          {r.color && <span className="swatch" style={{ background: r.color }} />}
          {r.label}
          <b>{r.format(point[r.key])}</b>
        </div>
      ))}
    </div>
  );
}

function XAxisFor({ range, c, points }) {
  return (
    <XAxis
      dataKey="t"
      {...axisProps(c)}
      tickFormatter={(t) => tick(t, range)}
      minTickGap={36}
      interval="preserveStartEnd"
      ticks={points.length > 8 ? undefined : points.map((p) => p.t)}
    />
  );
}

/** Requests per bucket. One series, so the panel title names it and no legend is needed. */
export function TrafficChart({ points, range, bucketLabel }) {
  const c = useThemeColors();
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <BarChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        {XAxisFor({ range, c, points })}
        <YAxis {...axisProps(c)} width={44} tickFormatter={count} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: c.grid }}
          content={<ChartTooltip range={range} rows={[
            { key: 'requests', label: `Requests per ${bucketLabel}`, format: count, color: c['series-traffic'] },
            { key: 'errors', label: 'Failed (5xx)', format: count, color: c['critical-mark'] },
          ]} />}
        />
        <Bar dataKey="requests" fill={c['series-traffic']} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Share of requests that failed, per bucket. Separate chart rather than a second y-axis. */
export function ErrorRateChart({ points, range }) {
  const c = useThemeColors();
  const color = c['critical-mark'];
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <AreaChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        {XAxisFor({ range, c, points })}
        <YAxis {...axisProps(c)} width={44} tickFormatter={(v) => `${v}%`} domain={[0, (max) => Math.max(5, Math.ceil(max))]} />
        <Tooltip
          cursor={{ stroke: c['ink-3'], strokeDasharray: '3 3' }}
          content={<ChartTooltip range={range} rows={[
            { key: 'errorRate', label: 'Failed', format: (v) => `${pct(v)}%`, color },
            { key: 'errors', label: 'Failed requests', format: count },
            { key: 'requests', label: 'All requests', format: count },
          ]} />}
        />
        <Area type="linear" dataKey="errorRate" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} isAnimationActive={false} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: c.panel }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export const LATENCY_SERIES = [
  { key: 'p50', label: 'Median (p50)', token: 'series-p50', dash: undefined },
  { key: 'p95', label: 'p95', token: 'series-p95', dash: undefined },
  { key: 'p99', label: 'p99', token: 'series-p99', dash: '5 4' },
];

/** Direct label at the end of each line, so identity never depends on color alone. */
function EndLabel({ x, y, index, value, last, text, color }) {
  if (index !== last || value == null) return null;
  return <text x={x + 6} y={y + 4} fill={color} fontSize={12} fontWeight={600}>{text}</text>;
}

export function LatencyChart({ points, range }) {
  const c = useThemeColors();
  const lastIndex = (key) => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i][key] != null) return i;
    return -1;
  };
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <LineChart data={points} margin={{ top: 8, right: 34, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        {XAxisFor({ range, c, points })}
        <YAxis {...axisProps(c)} width={52} tickFormatter={(v) => duration(v).replace(' ', '')} />
        <Tooltip
          cursor={{ stroke: c['ink-3'], strokeDasharray: '3 3' }}
          content={<ChartTooltip range={range} rows={LATENCY_SERIES.slice().reverse().map((s) => ({
            key: s.key, label: s.label, format: duration, color: c[s.token],
          }))} />}
        />
        {LATENCY_SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={c[s.token]}
            strokeWidth={2}
            strokeDasharray={s.dash}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: c.panel }}
            connectNulls
            isAnimationActive={false}
            label={(props) => <EndLabel {...props} last={lastIndex(s.key)} text={s.key} color={c[s.token]} />}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function LatencyLegend() {
  return (
    <div className="legend" aria-label="Legend">
      {LATENCY_SERIES.map((s) => (
        <span key={s.key} style={{ color: `var(--${s.token})` }}>
          <i className={`swatch${s.dash ? ' dashed' : ''}`} style={{ background: `var(--${s.token})` }} />
          <span style={{ color: 'var(--ink-2)' }}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return <div className="skeleton" style={{ height: HEIGHT }} aria-hidden="true" />;
}
