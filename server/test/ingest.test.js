'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { startRedis, fakeProjects, testConfig, quietLogger, TEST_KEY } = require('./helpers');

let r;
beforeAll(async () => {
  r = await startRedis();
});
afterAll(() => r.stop());
beforeEach(() => r.redis.flushall());

const reqEvent = (over = {}) => ({
  type: 'request', service: 'shop-api', method: 'GET', route: '/orders/:id',
  status: 200, durationMs: 42.5, timestamp: new Date().toISOString(), ...over,
});

function build(configOverrides, projects = fakeProjects()) {
  const config = testConfig(configOverrides);
  return { app: createApp({ redis: r.redis, projects, config, logger: quietLogger }), config, projects };
}

describe('POST /v1/ingest', () => {
  test('rejects a missing or unknown API key', async () => {
    const { app } = build();
    await request(app).post('/v1/ingest').send({ events: [reqEvent()] }).expect(401);
    await request(app).post('/v1/ingest').set('x-pulse-key', 'nope').send({ events: [reqEvent()] }).expect(401);
  });

  test('queues valid events on the Redis stream', async () => {
    const { app, config } = build();
    const res = await request(app)
      .post('/v1/ingest')
      .set('x-pulse-key', TEST_KEY)
      .send({ events: [reqEvent(), reqEvent({ status: 500 })] })
      .expect(202);
    expect(res.body).toMatchObject({ accepted: 2, rejected: 0 });

    const entries = await r.redis.xrange(config.streamKey, '-', '+');
    expect(entries).toHaveLength(1); // one stream entry per request batch
    const fields = entries[0][1];
    expect(fields[1]).toBe('proj_shopx');
    expect(JSON.parse(fields[3]).map((e) => e.status)).toEqual([200, 500]);
  });

  test('accepts good events and reports bad ones individually', async () => {
    const { app, config } = build();
    const tooOld = new Date(Date.now() - 30 * 86400_000).toISOString();
    const res = await request(app)
      .post('/v1/ingest')
      .set('x-pulse-key', TEST_KEY)
      .send({
        events: [
          reqEvent(),
          { type: 'banana' },
          { type: 'request', service: 'x' }, // missing status/duration
          reqEvent({ timestamp: tooOld }),
          { type: 'log', message: 'cache warmed', unknownField: 'stripped' },
        ],
      })
      .expect(202);

    expect(res.body.accepted).toBe(2);
    expect(res.body.rejected).toBe(3);
    expect(res.body.errors.map((e) => e.index)).toEqual([1, 2, 3]);
    const [[, fields]] = await r.redis.xrange(config.streamKey, '-', '+');
    expect(JSON.parse(fields[3])[1]).not.toHaveProperty('unknownField');
  });

  test('validates the body shape and size', async () => {
    const { app } = build({ maxEventsPerRequest: 2 });
    const post = () => request(app).post('/v1/ingest').set('x-pulse-key', TEST_KEY);
    await post().send({ events: [] }).expect(400);
    await post().send({ nope: true }).expect(400);
    await post().set('content-type', 'application/json').send('{not json').expect(400);
    await post().send({ events: [reqEvent(), reqEvent(), reqEvent()] }).expect(413);
  });

  test('rate limits per project by event count', async () => {
    const { app } = build({ rateLimitPerSecond: 3 });
    // Align to the start of a fresh 1s window so the test isn't flaky.
    await new Promise((res) => setTimeout(res, 1000 - (Date.now() % 1000) + 5));
    const post = (n) =>
      request(app).post('/v1/ingest').set('x-pulse-key', TEST_KEY).send({ events: Array.from({ length: n }, () => reqEvent()) });
    await post(2).expect(202);
    const res = await post(2).expect(429);
    expect(res.headers['retry-after']).toBe('1');
  });

  test('caches API key lookups', async () => {
    const { app, projects } = build();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/ingest').set('x-pulse-key', TEST_KEY).send({ events: [reqEvent()] }).expect(202);
    }
    expect(projects.lookups).toBe(1);
  });

  test('returns 503 (so the SDK retries) when Redis is down', async () => {
    // A Redis client whose every command fails, like a real one during an outage.
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    const deadRedis = { ping: down, xadd: down, multi: () => ({ incrby() { return this; }, expire() { return this; }, exec: down }) };
    const app = createApp({ redis: deadRedis, projects: fakeProjects(), config: testConfig(), logger: quietLogger });
    await request(app).post('/v1/ingest').set('x-pulse-key', TEST_KEY).send({ events: [reqEvent()] }).expect(503);
    await request(app).get('/health').expect(503);
  });
});
