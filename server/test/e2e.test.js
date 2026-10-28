'use strict';

/**
 * End to end over real HTTP: an Express app instrumented with the real SDK
 * sends to a running ingestion API, through Redis, and a worker writes the
 * events to the store.
 */
const express = require('express');
const request = require('supertest');
const pulseSdk = require('../../sdk/src');
const { createApp } = require('../src/app');
const { IngestWorker } = require('../src/workers/IngestWorker');
const { startRedis, fakeProjects, fakeStore, testConfig, quietLogger, TEST_KEY } = require('./helpers');

let r;
let server;
let endpoint;
const config = testConfig();

beforeAll(async () => {
  r = await startRedis();
  const api = createApp({ redis: r.redis, projects: fakeProjects(), config, logger: quietLogger });
  server = api.listen(0);
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await r.stop();
});

test('SDK -> API -> Redis stream -> worker -> store', async () => {
  const pulse = pulseSdk.init({ apiKey: TEST_KEY, endpoint, service: 'shopx-api', batchSize: 10 });
  const shop = express();
  shop.use(pulse.middleware());
  shop.get('/products/:id', (req, res) => res.json({ id: req.params.id }));
  shop.post('/checkout', () => {
    throw new Error('payment gateway timeout');
  });
  shop.use(pulse.errorHandler());
  // eslint-disable-next-line no-unused-vars
  shop.use((err, req, res, next) => res.status(500).end());

  for (let i = 0; i < 20; i++) await request(shop).get(`/products/${i}`).expect(200);
  await request(shop).post('/checkout').expect(500);
  await pulse.shutdown();
  expect(pulse.stats()).toMatchObject({ sent: 22, dropped: 0 });

  const store = fakeStore();
  const worker = new IngestWorker({
    redis: r.redis, store, streamKey: config.streamKey, deadLetterKey: config.deadLetterKey,
    group: config.consumerGroup, logger: quietLogger,
  });
  await worker.ensureGroup();
  await worker.runOnce({ block: false });

  expect(store.docs).toHaveLength(22);
  const routes = new Set(store.docs.filter((d) => d.meta.type === 'request').map((d) => d.route));
  expect([...routes].sort()).toEqual(['/checkout', '/products/:id']);
  const error = store.docs.find((d) => d.meta.type === 'error');
  expect(error).toMatchObject({ message: 'payment gateway timeout', meta: { projectId: 'proj_shopx', service: 'shopx-api' } });
});

test('SDK backs off and recovers when it hits the rate limit', async () => {
  const limited = createApp({ redis: r.redis, projects: fakeProjects(), config: testConfig({ rateLimitPerSecond: 50 }), logger: quietLogger });
  const s = limited.listen(0);
  const pulse = pulseSdk.init({
    apiKey: TEST_KEY, endpoint: `http://127.0.0.1:${s.address().port}`, batchSize: 40, flushIntervalMs: 60_000,
  });
  for (let i = 0; i < 120; i++) pulse.info(`event ${i}`);
  await pulse.shutdown();
  s.closeAllConnections();
  s.close();
  // 120 events at 50/sec: some batches get 429 + Retry-After, but all arrive.
  expect(pulse.stats()).toMatchObject({ sent: 120, dropped: 0 });
});
