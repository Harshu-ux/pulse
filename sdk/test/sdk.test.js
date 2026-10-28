'use strict';

const express = require('express');
const request = require('supertest');
const { init, PulseClient } = require('../src');

function mockFetch(responses = []) {
  const calls = [];
  const fn = jest.fn(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    const next = responses.length ? responses.shift() : { status: 202 };
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (h) => (next.headers || {})[h.toLowerCase()] || null },
    };
  });
  fn.calls = calls;
  return fn;
}

const baseOpts = (fetch, extra = {}) => ({
  apiKey: 'pk_test',
  endpoint: 'http://pulse.local/',
  service: 'shop-api',
  flushIntervalMs: 60_000,
  retryBaseMs: 1,
  fetch,
  ...extra,
});

describe('PulseClient', () => {
  test('requires an api key', () => {
    expect(() => new PulseClient({})).toThrow(/apiKey/);
  });

  test('batches events and sends them with the api key', async () => {
    const fetch = mockFetch();
    const client = new PulseClient(baseOpts(fetch, { batchSize: 3 }));
    client.log('info', 'a');
    client.log('info', 'b');
    expect(fetch).not.toHaveBeenCalled();
    client.log('info', 'c'); // hits batchSize -> auto flush
    await client.shutdown();

    expect(fetch).toHaveBeenCalledTimes(1);
    const { url, body, headers } = fetch.calls[0];
    expect(url).toBe('http://pulse.local/v1/ingest');
    expect(headers['x-pulse-key']).toBe('pk_test');
    expect(body.events.map((e) => e.message)).toEqual(['a', 'b', 'c']);
    expect(body.events[0]).toMatchObject({ service: 'shop-api', type: 'log', level: 'info' });
  });

  test('retries on 503 and network errors, then succeeds', async () => {
    const fetch = mockFetch([{ status: 503 }, new Error('ECONNREFUSED'), { status: 202 }]);
    const client = new PulseClient(baseOpts(fetch));
    client.log('info', 'hello');
    await client.shutdown();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(client.stats).toMatchObject({ sent: 1, dropped: 0 });
  });

  test('does not retry a rejected (401) batch', async () => {
    const fetch = mockFetch([{ status: 401 }]);
    const client = new PulseClient(baseOpts(fetch));
    client.log('info', 'hello');
    await client.shutdown();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.stats).toMatchObject({ sent: 0, dropped: 1, failedBatches: 1 });
  });

  test('caps the buffer and drops the oldest events', async () => {
    const fetch = mockFetch();
    const client = new PulseClient(baseOpts(fetch, { batchSize: 1000, maxBufferSize: 3 }));
    ['1', '2', '3', '4', '5'].forEach((m) => client.log('info', m));
    expect(client.stats.dropped).toBe(2);
    await client.shutdown();
    expect(fetch.calls[0].body.events.map((e) => e.message)).toEqual(['3', '4', '5']);
  });

  test('never throws when the server is unreachable', async () => {
    const fetch = mockFetch([new Error('down'), new Error('down'), new Error('down'), new Error('down')]);
    const client = new PulseClient(baseOpts(fetch));
    client.log('info', 'x');
    await expect(client.shutdown()).resolves.toBeUndefined();
    expect(client.stats.dropped).toBe(1);
  });
});

describe('Express middleware', () => {
  function buildApp(fetch, extra) {
    const pulse = init(baseOpts(fetch, extra));
    const app = express();
    app.use(pulse.middleware());
    app.get('/orders/:id', (req, res) => res.json({ id: req.params.id }));
    app.get('/boom', () => {
      throw new Error('payment service timeout');
    });
    app.use(pulse.errorHandler());
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
    return { app, pulse };
  }

  test('records route pattern, status and latency', async () => {
    const fetch = mockFetch();
    const { app, pulse } = buildApp(fetch);
    await request(app).get('/orders/8812').expect(200);
    await request(app).get('/orders/9999').expect(200);
    await pulse.shutdown();

    const events = fetch.calls.flatMap((c) => c.body.events);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ type: 'request', method: 'GET', route: '/orders/:id', status: 200 });
      expect(typeof e.durationMs).toBe('number');
    }
  });

  test('captures thrown errors with stack traces', async () => {
    const fetch = mockFetch();
    const { app, pulse } = buildApp(fetch);
    await request(app).get('/boom').expect(500);
    await pulse.shutdown();

    const events = fetch.calls.flatMap((c) => c.body.events);
    const err = events.find((e) => e.type === 'error');
    const req = events.find((e) => e.type === 'request');
    expect(err).toMatchObject({ message: 'payment service timeout', route: '/boom', errorName: 'Error' });
    expect(err.stack).toMatch(/payment service timeout/);
    expect(req).toMatchObject({ status: 500, level: 'error' });
  });

  test('sampling drops healthy requests but always keeps failures', async () => {
    const fetch = mockFetch();
    const { app, pulse } = buildApp(fetch, { sampleRate: 0 });
    await request(app).get('/orders/1').expect(200);
    await request(app).get('/boom').expect(500);
    await pulse.shutdown();

    const events = fetch.calls.flatMap((c) => c.body.events);
    expect(events.filter((e) => e.type === 'request').map((e) => e.status)).toEqual([500]);
  });
});
