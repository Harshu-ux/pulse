'use strict';

const { IngestWorker } = require('../src/workers/IngestWorker');
const { enqueueBatch } = require('../src/queue/eventStream');
const { startRedis, fakeStore, testConfig, quietLogger } = require('./helpers');

let r;
beforeAll(async () => {
  r = await startRedis();
});
afterAll(() => r.stop());
beforeEach(() => r.redis.flushall());

const config = testConfig();
const event = (over = {}) => ({
  type: 'request', service: 'shop-api', environment: 'production', level: 'info',
  method: 'POST', route: '/checkout', status: 200, durationMs: 120, timestamp: new Date().toISOString(), ...over,
});

function makeWorker(store, over = {}) {
  return new IngestWorker({
    redis: r.redis,
    store,
    streamKey: config.streamKey,
    deadLetterKey: config.deadLetterKey,
    group: config.consumerGroup,
    consumer: 'worker-1',
    blockMs: 50,
    claimIdleMs: 0,
    maxDeliveries: 3,
    logger: quietLogger,
    ...over,
  });
}

test('writes queued batches to the store in bulk and acknowledges them', async () => {
  const store = fakeStore();
  const worker = makeWorker(store);
  await worker.ensureGroup();
  await enqueueBatch(r.redis, config, 'proj_a', [event(), event({ status: 503, level: 'error' })]);
  await enqueueBatch(r.redis, config, 'proj_b', [event({ service: 'billing' })]);

  await worker.runOnce({ block: false });

  expect(store.calls).toBe(1); // both stream entries written in one bulk insert
  expect(store.docs).toHaveLength(3);
  expect(store.docs[0]).toMatchObject({
    meta: { projectId: 'proj_a', service: 'shop-api', type: 'request' },
    route: '/checkout',
    status: 200,
  });
  expect(store.docs[0].timestamp).toBeInstanceOf(Date);
  expect(store.docs[2].meta.projectId).toBe('proj_b');

  expect(await r.redis.xlen(config.streamKey)).toBe(0);
  const pending = await r.redis.xpending(config.streamKey, config.consumerGroup);
  expect(pending[0]).toBe(0);
});

test('does not lose events when the database write fails; retries later', async () => {
  const store = fakeStore({ failTimes: 1 });
  const worker = makeWorker(store);
  await worker.ensureGroup();
  await enqueueBatch(r.redis, config, 'proj_a', [event(), event()]);

  await worker.runOnce({ block: false }); // write fails -> left pending
  expect(store.docs).toHaveLength(0);
  expect((await r.redis.xpending(config.streamKey, config.consumerGroup))[0]).toBe(1);

  await worker.runOnce({ block: false }); // reclaimed via XAUTOCLAIM and written
  expect(store.docs).toHaveLength(2);
  expect((await r.redis.xpending(config.streamKey, config.consumerGroup))[0]).toBe(0);
});

test('a crashed worker\'s batch is picked up by another worker', async () => {
  const store = fakeStore();
  await makeWorker(store).ensureGroup();
  await enqueueBatch(r.redis, config, 'proj_a', [event()]);

  // worker-1 reads the entry, then "crashes" before writing it.
  await r.redis.xreadgroup('GROUP', config.consumerGroup, 'worker-1', 'COUNT', 10, 'STREAMS', config.streamKey, '>');

  const worker2 = makeWorker(store, { consumer: 'worker-2' });
  await worker2.runOnce({ block: false });
  expect(store.docs).toHaveLength(1);
});

test('moves a repeatedly failing entry to the dead-letter stream', async () => {
  const store = fakeStore({ failTimes: Infinity });
  const worker = makeWorker(store, { maxDeliveries: 3 });
  await worker.ensureGroup();
  await enqueueBatch(r.redis, config, 'proj_a', [event()]);

  for (let i = 0; i < 4; i++) await worker.runOnce({ block: false });

  expect(worker.stats.deadLettered).toBe(1);
  const dead = await r.redis.xrange(config.deadLetterKey, '-', '+');
  expect(dead).toHaveLength(1);
  expect(dead[0][1]).toEqual(expect.arrayContaining(['reason', 'failed after 3 deliveries', 'project', 'proj_a']));
  expect((await r.redis.xpending(config.streamKey, config.consumerGroup))[0]).toBe(0);
});

test('dead-letters malformed entries immediately without blocking good ones', async () => {
  const store = fakeStore();
  const worker = makeWorker(store);
  await worker.ensureGroup();
  await r.redis.xadd(config.streamKey, '*', 'project', 'proj_a', 'events', '{broken json');
  await enqueueBatch(r.redis, config, 'proj_a', [event()]);

  await worker.runOnce({ block: false });

  expect(store.docs).toHaveLength(1);
  expect(await r.redis.xlen(config.deadLetterKey)).toBe(1);
  expect(await r.redis.xlen(config.streamKey)).toBe(0);
});
