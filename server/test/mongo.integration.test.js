'use strict';

/**
 * Runs against a real MongoDB (and Redis) when TEST_MONGO_URL is set, e.g. in
 * GitHub Actions or locally with `docker compose up mongo`. Skipped otherwise.
 */
const mongoose = require('mongoose');
const request = require('supertest');

const MONGO_URL = process.env.TEST_MONGO_URL;
const describeIfMongo = MONGO_URL ? describe : describe.skip;

describeIfMongo('MongoDB integration', () => {
  let r;
  let mongoStore;
  let Event;
  let Project;
  const helpers = require('./helpers');

  beforeAll(async () => {
    mongoStore = require('../src/lib/mongoStore');
    Event = require('../src/models/Event');
    Project = require('../src/models/Project');
    await mongoStore.connectMongo(MONGO_URL);
    await Promise.all([Event.deleteMany({}), Project.deleteMany({})]);
    r = await helpers.startRedis();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await r.stop();
  });

  test('events collection is a time-series collection', async () => {
    const [info] = await mongoose.connection.db.listCollections({ name: 'events' }).toArray();
    expect(info.type).toBe('timeseries');
    expect(info.options.timeseries).toMatchObject({ timeField: 'timestamp', metaField: 'meta' });
  });

  test('full pipeline: API -> Redis stream -> worker -> MongoDB', async () => {
    const { generateApiKey, hashApiKey } = require('../src/lib/apiKeys');
    const { createApp } = require('../src/app');
    const { IngestWorker } = require('../src/workers/IngestWorker');

    const apiKey = generateApiKey();
    await Project.create({ name: 'ShopX', ownerId: new mongoose.Types.ObjectId(), apiKeyHash: hashApiKey(apiKey), apiKeyPrefix: apiKey.slice(0, 10) });

    const config = helpers.testConfig();
    const app = createApp({ redis: r.redis, projects: mongoStore.projectRepo, config, logger: helpers.quietLogger });
    await request(app)
      .post('/v1/ingest')
      .set('x-pulse-key', apiKey)
      .send({
        events: [
          { type: 'request', service: 'shop-api', method: 'GET', route: '/cart', status: 200, durationMs: 31 },
          { type: 'error', service: 'shop-api', level: 'error', message: 'payment timeout', stack: 'Error: payment timeout' },
        ],
      })
      .expect(202);

    const worker = new IngestWorker({
      redis: r.redis, store: mongoStore.eventStore, streamKey: config.streamKey,
      deadLetterKey: config.deadLetterKey, group: config.consumerGroup, logger: helpers.quietLogger,
    });
    await worker.ensureGroup();
    await worker.runOnce({ block: false });

    const stored = await Event.find({}).sort({ 'meta.type': 1 }).lean();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ meta: { type: 'error', service: 'shop-api' }, message: 'payment timeout' });
    expect(stored[1]).toMatchObject({ meta: { type: 'request' }, route: '/cart', status: 200 });
  });
});
