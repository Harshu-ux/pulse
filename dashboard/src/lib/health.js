import { duration, pct, rangeWords, count } from './format.js';

const MIN_REQUESTS_FOR_ROUTE = 10;

/**
 * Turns the numbers into one plain-language verdict, so the first thing an
 * on-call developer reads is what's wrong, not a wall of charts.
 *
 * Returns { tone: good | warning | critical | idle, headline, detail }.
 */
export function healthVerdict(overview, endpoints = [], rangeKey = '1h') {
  const when = rangeWords(rangeKey);
  if (!overview || overview.requests === 0) {
    return {
      tone: 'idle',
      headline: `No requests in ${when}`,
      detail: 'Once your app sends data, its health shows up here. Check the setup page if you expected traffic.',
    };
  }

  const { requests, errorRate, p95, previous } = overview;
  const worst = [...endpoints]
    .filter((e) => e.requests >= MIN_REQUESTS_FOR_ROUTE && e.errors > 0)
    .sort((a, b) => b.errorRate - a.errorRate)[0];
  const summary = `${count(requests)} requests, ${pct(errorRate)}% failed, 95% answered within ${duration(p95)}.`;

  if (errorRate >= 5 || (worst && worst.errorRate >= 20)) {
    return {
      tone: 'critical',
      headline: worst
        ? `${worst.method} ${worst.route} is failing ${pct(worst.errorRate)}% of the time`
        : `${pct(errorRate)}% of requests are failing`,
      detail: `In ${when}: ${summary} Open Errors to see what's breaking.`,
    };
  }

  const slower = previous && previous.p95 && p95 > previous.p95 * 1.5 && p95 > 300;
  if (errorRate >= 1 || (worst && worst.errorRate >= 5)) {
    return {
      tone: 'warning',
      headline: worst
        ? `Some ${worst.method} ${worst.route} requests are failing`
        : `${pct(errorRate)}% of requests are failing`,
      detail: `In ${when}: ${summary}`,
    };
  }
  if (slower) {
    return {
      tone: 'warning',
      headline: 'Responses are slower than usual',
      detail: `95% of requests now finish within ${duration(p95)}, up from ${duration(previous.p95)} in the period before. ${count(requests)} requests in ${when}.`,
    };
  }
  return {
    tone: 'good',
    headline: 'Everything looks healthy',
    detail: `In ${when}: ${summary}`,
  };
}
