import { describe, expect, test } from 'vitest';
import { healthVerdict } from './health.js';
import { delta, duration, pct } from './format.js';

const healthy = { requests: 5000, errorRate: 0.2, p95: 120, previous: { p95: 110 } };

describe('healthVerdict', () => {
  test('no traffic', () => {
    expect(healthVerdict({ requests: 0 }, [], '1h')).toMatchObject({ tone: 'idle', headline: 'No requests in the last hour' });
  });

  test('healthy', () => {
    const v = healthVerdict(healthy, [], '1h');
    expect(v.tone).toBe('good');
    expect(v.detail).toContain('5,000 requests');
  });

  test('names the failing endpoint', () => {
    const endpoints = [
      { method: 'GET', route: '/products', requests: 4000, errors: 2, errorRate: 0.05 },
      { method: 'POST', route: '/checkout', requests: 300, errors: 105, errorRate: 35 },
    ];
    const v = healthVerdict({ ...healthy, errorRate: 2.1 }, endpoints, '1h');
    expect(v).toMatchObject({ tone: 'critical', headline: 'POST /checkout is failing 35% of the time' });
  });

  test('ignores routes with too little traffic to judge', () => {
    const endpoints = [{ method: 'GET', route: '/rare', requests: 2, errors: 1, errorRate: 50 }];
    expect(healthVerdict(healthy, endpoints).tone).toBe('good');
  });

  test('flags a latency regression', () => {
    const v = healthVerdict({ ...healthy, p95: 900, previous: { p95: 200 } });
    expect(v).toMatchObject({ tone: 'warning', headline: 'Responses are slower than usual' });
  });
});

describe('format', () => {
  test('duration', () => {
    expect(duration(38.44)).toBe('38.4 ms');
    expect(duration(412.7)).toBe('413 ms');
    expect(duration(1240)).toBe('1.24 s');
  });
  test('pct', () => {
    expect(pct(0)).toBe('0');
    expect(pct(0.25)).toBe('0.25');
    expect(pct(3.64)).toBe('3.6');
    expect(pct(40)).toBe('40');
  });
  test('delta', () => {
    expect(delta(200, 100)).toMatchObject({ tone: 'worse', text: '↑ 2.0× vs previous period' });
    expect(delta(80, 100)).toMatchObject({ tone: 'better', text: '↓ 20% vs previous period' });
    expect(delta(80, 100, { higherIsWorse: false }).tone).toBe('worse');
    expect(delta(102, 100).tone).toBe('same');
    expect(delta(5, 0)).toBeNull();
    expect(delta(6670, 10).text).toBe('↑ over 10× vs previous period');
  });
});
