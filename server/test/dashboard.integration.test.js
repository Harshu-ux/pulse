'use strict';

/**
 * Dashboard API against a real MongoDB: accounts, project ownership, the
 * query endpoints that power the charts, and live WebSocket updates.
 * Runs when TEST_MONGO_URL is set; skipped otherwise.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const WebSocket = require('ws');
const helpers = require('./helpers');

const BASE_URL = process.env.TEST_MONGO_URL;
const describeIfMongo = BASE_URL ? describe : describe.skip;

describeIfMongo('Dashboard API', () => {
  let r;
  let app;
  let Event;
  let Project;
  const config = helpers.testConfig({ rateLimitPerSecond: 100_000 });

  beforeAll(async () => {
    const url = new URL(BASE_URL);
    url.pathname = '/pulse_test_dashboard';
    const { connectMongo, projectRepo } = require('../src/lib/mongoStore');
    Event = require('../src/models/Event');
    Project = require('../src/models/Project');
    const User = require('../src/models/User');
    await connectMongo(url.toString());
    await Promise.all([Event.deleteMany({}), Project.deleteMany({}), User.deleteMany({})]);
    r = await helpers.startRedis();
    const { createApp } = require('../src/app');
    app = createApp({ redis: r.redis, projects: projectRepo, config, logger: helpers.quietLogger, dashboardApi: true });
  });

  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    await r.stop();
  });

  async function signup(email, name = 'Test User') {
    const res = await request(app).post('/api/auth/register').send({ name, email, password: 'correct-horse' }).expect(201);
    return res.body.token;
  }
  const authed = (token) => ({
    get: (url) => request(app).get(url).set('authorization', `Bearer ${token}`),
    post: (url, body) => request(app).post(url).set('authorization', `Bearer ${token}`).send(body),
    del: (url) => request(app).delete(url).set('authorization', `Bearer ${token}`),
  });

  describe('accounts', () => {
    test('register, log in and fetch the current user', async () => {
      await signup('priya@example.com', 'Priya');
      const login = await request(app).post('/api/auth/login').send({ email: 'PRIYA@example.com', password: 'correct-horse' }).expect(200);
      const me = await authed(login.body.token).get('/api/auth/me').expect(200);
      expect(me.body.user).toMatchObject({ email: 'priya@example.com', name: 'Priya' });
      expect(me.body.user).not.toHaveProperty('passwordHash');
    });

    test('rejects bad credentials, duplicates, weak passwords and bad tokens', async () => {
      await request(app).post('/api/auth/login').send({ email: 'priya@example.com', password: 'wrong' }).expect(401);
      await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'x' }).expect(401);
      await request(app).post('/api/auth/register').send({ name: 'P', email: 'priya@example.com', password: 'longenough' }).expect(409);
      await request(app).post('/api/auth/register').send({ name: 'P', email: 'new@example.com', password: 'short' }).expect(400);
      await authed('not-a-token').get('/api/auth/me').expect(401);
      await request(app).get('/api/projects').expect(401);
    });

    test('locks out repeated failed logins', async () => {
      await signup('target@example.com');
      for (let i = 0; i < 10; i++) {
        await request(app).post('/api/auth/login').send({ email: 'target@example.com', password: 'guess' }).expect(401);
      }
      await request(app).post('/api/auth/login').send({ email: 'target@example.com', password: 'correct-horse' }).expect(429);
    });
  });

  describe('projects', () => {
    test('create shows the key once; list shows only the prefix', async () => {
      const api = authed(await signup('owner@example.com'));
      const created = await api.post('/api/projects', { name: 'ShopX' }).expect(201);
      expect(created.body.apiKey).toMatch(/^pk_/);
      const list = await api.get('/api/projects').expect(200);
      expect(list.body.projects).toEqual([expect.objectContaining({ name: 'ShopX', apiKeyPrefix: created.body.apiKey.slice(0, 10) })]);
      expect(JSON.stringify(list.body)).not.toContain(created.body.apiKey);

      // The new key works for ingestion.
      await request(app).post('/v1/ingest').set('x-pulse-key', created.body.apiKey)
        .send({ events: [{ type: 'log', message: 'hello' }] }).expect(202);
    });

    test("users can't see or touch each other's projects", async () => {
      const alice = authed(await signup('alice@example.com'));
      const bob = authed(await signup('bob@example.com'));
      const { body } = await alice.post('/api/projects', { name: 'Alice app' }).expect(201);
      const id = body.project.id;

      expect((await bob.get('/api/projects').expect(200)).body.projects).toEqual([]);
      await bob.get(`/api/projects/${id}`).expect(404);
      await bob.get(`/api/projects/${id}/overview`).expect(404);
      await bob.post(`/api/projects/${id}/rotate-key`).expect(404);
      await bob.del(`/api/projects/${id}`).expect(404);
      await alice.get(`/api/projects/${id}/overview`).expect(200);
    });

    test('rotating the key replaces it; deleting removes the project and its data', async () => {
      const api = authed(await signup('rotator@example.com'));
      const { body } = await api.post('/api/projects', { name: 'Rotate me' }).expect(201);
      const rotated = await api.post(`/api/projects/${body.project.id}/rotate-key`).expect(200);
      expect(rotated.body.apiKey).not.toBe(body.apiKey);
      const stored = await Project.findById(body.project.id).lean();
      expect(stored.apiKeyPrefix).toBe(rotated.body.apiKey.slice(0, 10));

      await Event.create({ timestamp: new Date(), meta: { projectId: body.project.id, service: 's', type: 'log' }, message: 'x' });
      await api.del(`/api/projects/${body.project.id}`).expect(204);
      expect(await Project.countDocuments({ _id: body.project.id })).toBe(0);
      expect(await Event.countDocuments({ 'meta.projectId': body.project.id })).toBe(0);
    });
  });

  describe('queries', () => {
    let api;
    let pid;
    const now = Date.now();
    const at = (minutesAgo) => new Date(now - minutesAgo * 60e3);

    beforeAll(async () => {
      api = authed(await signup('analyst@example.com'));
      pid = (await api.post('/api/projects', { name: 'Analytics' }).expect(201)).body.project.id;
      const meta = (type) => ({ projectId: pid, service: 'shopx-api', environment: 'production', type });
      const docs = [];
      // 100 healthy product page loads, 1..100 ms, spread across the last 50 minutes.
      for (let i = 1; i <= 100; i++) {
        docs.push({ timestamp: at(50 - i * 0.49), meta: meta('request'), method: 'GET', route: '/products', status: 200, durationMs: i, level: 'info', message: 'GET /products 200' });
      }
      // 10 checkouts, 4 of them failing.
      for (let i = 0; i < 10; i++) {
        const failed = i < 4;
        docs.push({ timestamp: at(10 + i), meta: meta('request'), method: 'POST', route: '/checkout', status: failed ? 500 : 200, durationMs: 500, level: failed ? 'error' : 'info', message: `POST /checkout ${failed ? 500 : 200}` });
      }
      // Errors: 4 payment timeouts + 1 type error.
      for (let i = 0; i < 4; i++) {
        docs.push({ timestamp: at(10 + i), meta: meta('error'), level: 'error', errorName: 'Error', message: 'payment gateway timeout', route: '/checkout', stack: `Error: payment gateway timeout\n    at attempt ${i}` });
      }
      docs.push({ timestamp: at(5), meta: meta('error'), level: 'error', errorName: 'TypeError', message: 'x is undefined', route: '/search' });
      // Logs.
      for (let i = 0; i < 3; i++) docs.push({ timestamp: at(20 + i), meta: meta('log'), level: 'info', message: 'order placed', attrs: { amount: 100 * i } });
      docs.push({ timestamp: at(30), meta: meta('log'), level: 'warn', message: 'slow query on orders' });
      // Previous hour: 20 requests, used for the comparison numbers.
      for (let i = 0; i < 20; i++) {
        docs.push({ timestamp: at(90 + i), meta: meta('request'), method: 'GET', route: '/products', status: 200, durationMs: 10, level: 'info' });
      }
      // Another project's data must never leak in.
      docs.push({ timestamp: at(5), meta: { ...meta('request'), projectId: 'someone-else' }, method: 'GET', route: '/x', status: 500, durationMs: 1 });
      await Event.insertMany(docs);
    });

    test('overview: totals, error rate, percentiles and previous period', async () => {
      const { body } = await api.get(`/api/projects/${pid}/overview?range=1h`).expect(200);
      expect(body).toMatchObject({ requests: 110, errors: 4, errorRate: 3.64, errorEvents: 5, services: ['shopx-api'] });
      expect(body.p50).toBeGreaterThanOrEqual(50);
      expect(body.p50).toBeLessThanOrEqual(62);
      expect(body.p99).toBe(500);
      expect(body.previous).toMatchObject({ requests: 20, errors: 0, errorRate: 0 });
    });

    test('timeseries: one point per minute, gaps filled, totals add up', async () => {
      const { body } = await api.get(`/api/projects/${pid}/timeseries?range=1h`).expect(200);
      expect(body.bucketMs).toBe(60e3);
      expect(body.points.length).toBeGreaterThanOrEqual(60);
      expect(body.points.length).toBeLessThanOrEqual(61);
      expect(body.points.reduce((s, p) => s + p.requests, 0)).toBe(110);
      expect(body.points.reduce((s, p) => s + p.errors, 0)).toBe(4);
      expect(body.points.some((p) => p.requests === 0 && p.p95 === null)).toBe(true);
    });

    test('endpoints: grouped by route with per-route error rates', async () => {
      const { body } = await api.get(`/api/projects/${pid}/endpoints?range=1h`).expect(200);
      expect(body.endpoints.map((e) => `${e.method} ${e.route}`)).toEqual(['GET /products', 'POST /checkout']);
      expect(body.endpoints[1]).toMatchObject({ requests: 10, errors: 4, errorRate: 40, p50: 500 });
    });

    test('issues: errors grouped by type and message, newest stack kept', async () => {
      const { body } = await api.get(`/api/projects/${pid}/issues?range=1h`).expect(200);
      expect(body.issues).toHaveLength(2);
      const payment = body.issues.find((i) => i.message === 'payment gateway timeout');
      expect(payment).toMatchObject({ count: 4, errorName: 'Error', routes: ['/checkout'] });
      expect(payment.stack).toContain('at attempt 0'); // most recent occurrence
      expect(body.issues[0].message).toBe('x is undefined'); // sorted by last seen
    });

    test('logs: filters by type, level and text', async () => {
      const logs = (qs) => api.get(`/api/projects/${pid}/logs?range=1h&${qs}`).expect(200).then((res) => res.body.items);
      expect(await logs('type=log')).toHaveLength(4);
      expect((await logs('level=warn')).map((e) => e.message)).toEqual(['slow query on orders']);
      expect(await logs('level=warn,error')).toHaveLength(1 + 4 + 5);
      expect((await logs('q=ORDER PLACED')).every((e) => e.message === 'order placed')).toBe(true);
      expect(await logs('q=.*')).toHaveLength(0); // regex characters are treated literally
      await api.get(`/api/projects/${pid}/logs?level=fatal`).expect(400);
      await api.get(`/api/projects/${pid}/overview?range=1y`).expect(400);
    });

    test('logs: cursor pagination walks every event exactly once, newest first', async () => {
      const seen = [];
      let cursor = null;
      let pages = 0;
      do {
        const qs = `range=1h&limit=50${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`;
        const { body } = await api.get(`/api/projects/${pid}/logs?${qs}`).expect(200);
        seen.push(...body.items);
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(119);
      expect(new Set(seen.map((e) => e.id)).size).toBe(119);
      const times = seen.map((e) => new Date(e.timestamp).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });
  });

  describe('live updates', () => {
    let server;
    let hub;
    let subscriber;
    let token;
    let pid;

    beforeAll(async () => {
      const { attachLiveHub } = require('../src/lib/liveHub');
      server = app.listen(0);
      subscriber = r.newClient();
      hub = attachLiveHub(server, {
        subscriber, config, logger: helpers.quietLogger,
        findOwnedProject: (id, ownerId) => Project.findOne({ _id: id, ownerId }).lean(),
      });
      token = await signup('live@example.com');
      pid = (await authed(token).post('/api/projects', { name: 'Live' }).expect(201)).body.project.id;
    });

    afterAll(async () => {
      hub.close();
      server.closeAllConnections();
      server.close();
      subscriber.disconnect();
    });

    const wsUrl = (qs) => `ws://127.0.0.1:${server.address().port}/ws?${qs}`;

    function nextMessage(ws, type) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type} message`)), 5000);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === type) {
            clearTimeout(timer);
            resolve(msg);
          }
        });
      });
    }

    test('workers -> Redis pub/sub -> WebSocket to the right dashboard', async () => {
      const { IngestWorker } = require('../src/workers/IngestWorker');
      const ws = new WebSocket(wsUrl(`token=${token}&project=${pid}`));
      await nextMessage(ws, 'hello');

      const worker = new IngestWorker({
        redis: r.redis, store: helpers.fakeStore(), streamKey: 'live:test', deadLetterKey: 'live:dead',
        group: 'g', liveChannel: config.liveChannel, logger: helpers.quietLogger,
      });
      const incoming = nextMessage(ws, 'events');
      await worker.publishLive([
        { timestamp: new Date(), meta: { projectId: pid, service: 's', type: 'request' }, status: 503, route: '/checkout', durationMs: 900 },
        { timestamp: new Date(), meta: { projectId: 'another-project', service: 's', type: 'request' }, status: 200 },
      ]);
      const msg = await incoming;
      expect(msg).toMatchObject({ projectId: pid, counts: { request: 1, error: 0, log: 0 }, serverErrors: 1 });
      expect(msg.events).toHaveLength(1);
      ws.close();
    });

    test('rejects sockets without a valid token or for someone else\'s project', async () => {
      const other = await signup('intruder@example.com');
      for (const qs of [`project=${pid}`, `token=bad&project=${pid}`, `token=${other}&project=${pid}`]) {
        const ws = new WebSocket(wsUrl(qs));
        const result = await new Promise((resolve) => {
          ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
          ws.on('error', () => resolve('error'));
          ws.on('open', () => resolve('open'));
        });
        expect(result).toBe(401);
      }
    });
  });
});
