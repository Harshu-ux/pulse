const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const RANGES = [
  { key: '15m', label: '15m', words: 'the last 15 minutes' },
  { key: '1h', label: '1h', words: 'the last hour' },
  { key: '6h', label: '6h', words: 'the last 6 hours' },
  { key: '24h', label: '24h', words: 'the last 24 hours' },
  { key: '7d', label: '7d', words: 'the last 7 days' },
];
export const rangeWords = (key) => (RANGES.find((r) => r.key === key) || RANGES[1]).words;

export function count(n) {
  if (n == null) return '–';
  return n >= 100_000 ? compact.format(n) : nf.format(Math.round(n));
}

/** 0.4 -> "0.4", 12.345 -> "12.3", 0 -> "0" */
export function pct(n) {
  if (n == null) return '–';
  if (n === 0) return '0';
  return n < 10 ? n.toFixed(n < 1 ? 2 : 1).replace(/\.?0+$/, '') : n.toFixed(0);
}

/** Milliseconds as "38 ms", "1.24 s". */
export function duration(ms) {
  if (ms == null) return '–';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
  return `${ms >= 100 ? Math.round(ms) : Number(ms.toFixed(1))} ms`;
}

/** Split for KPI display: { value: "1.24", unit: "s" } */
export function durationParts(ms) {
  const [value, unit] = duration(ms).split(' ');
  return { value, unit: unit || '' };
}

export function timeAgo(date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function clock(date, withSeconds = true) {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

/** Axis label for a chart bucket, depending on how wide the range is. */
export function tick(date, rangeKey) {
  const d = new Date(date);
  if (rangeKey === '7d') return d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  return clock(d, rangeKey === '15m');
}

export function tooltipTime(date, rangeKey) {
  const d = new Date(date);
  const day = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return rangeKey === '7d' || rangeKey === '24h' ? `${day}, ${clock(d, false)}` : clock(d);
}

/**
 * Compares a metric with the previous period.
 * Returns { text, tone } where tone is better | worse | same, given whether
 * higher numbers are bad for this metric.
 */
export function delta(current, previous, { higherIsWorse = true, unit = '%' } = {}) {
  if (current == null || previous == null || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 5) return { text: 'about the same as before', tone: 'same' };
  const up = change > 0;
  const tone = up === higherIsWorse ? 'worse' : 'better';
  const ratio = current / previous;
  const size = ratio >= 10 ? 'over 10×' : Math.abs(change) >= 100 ? `${ratio.toFixed(1)}×` : `${Math.round(Math.abs(change))}${unit}`;
  return { text: `${up ? '↑' : '↓'} ${size} vs previous period`, tone };
}
