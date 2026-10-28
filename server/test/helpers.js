'use strict';

const { spawn } = require('child_process');
const net = require('net');
const Redis = require('ioredis');
const { hashApiKey } = require('../src/lib/apiKeys');

/** Starts a throwaway redis-server on a free port (no persistence). */
async function startRedis() {
  const port = await freePort();
  const proc = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore',
  });
  const redis = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 1 });
  for (let i = 0; i < 50; i++) {
    try {
      await redis.connect();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    port,
    redis,
    newClient: () => new Redis({ port }),
    async stop() {
      redis.disconnect();
      proc.kill();
    },
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const TEST_KEY = 'pk_test_shopx';

/** In-memory stand-in for the Mongo project collection. */
function fakeProjects(keys = { [TEST_KEY]: { id: 'proj_shopx', name: 'ShopX' } }) {
  const byHash = new Map(Object.entries(keys).map(([k, p]) => [hashApiKey(k), p]));
  return { lookups: 0, async findByKeyHash(h) { this.lookups += 1; return byHash.get(h) || null; } };
}

/** In-memory stand-in for the Mongo event store. `failTimes` simulates DB outages. */
function fakeStore({ failTimes = 0 } = {}) {
  return {
    docs: [],
    calls: 0,
    async insertEvents(docs) {
      this.calls += 1;
      if (this.calls <= failTimes) throw new Error('simulated database outage');
      this.docs.push(...docs);
      return docs.length;
    },
  };
}

const testConfig = (overrides = {}) => ({
  streamKey: 'test:events',
  deadLetterKey: 'test:events:dead',
  consumerGroup: 'test-writers',
  streamMaxLen: 100_000,
  maxEventsPerRequest: 500,
  rateLimitPerSecond: 10_000,
  retentionDays: 14,
  jwtSecret: 'test-secret',
  jwtExpiresIn: '1h',
  liveChannel: 'test:live',
  ...overrides,
});

const quietLogger = { info() {}, warn() {}, error() {} };

module.exports = { startRedis, freePort, fakeProjects, fakeStore, testConfig, quietLogger, TEST_KEY };
