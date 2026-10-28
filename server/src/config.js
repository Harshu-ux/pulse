'use strict';

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

module.exports = {
  port: int(process.env.PORT, 4000),
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/pulse',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Dashboard login. Always set JWT_SECRET in production.
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Redis pub/sub channel workers use to push live updates to dashboards.
  liveChannel: process.env.LIVE_CHANNEL || 'pulse:live',

  // Redis stream that sits between the API and the workers.
  streamKey: process.env.STREAM_KEY || 'pulse:events',
  deadLetterKey: process.env.DEAD_LETTER_KEY || 'pulse:events:dead',
  consumerGroup: process.env.CONSUMER_GROUP || 'pulse-writers',
  // Approximate cap on stream length so Redis memory stays bounded if workers fall behind.
  streamMaxLen: int(process.env.STREAM_MAX_LEN, 500_000),

  maxEventsPerRequest: int(process.env.MAX_EVENTS_PER_REQUEST, 500),
  // Events per second each project may send before getting HTTP 429.
  rateLimitPerSecond: int(process.env.RATE_LIMIT_PER_SECOND, 2000),
  retentionDays: int(process.env.RETENTION_DAYS, 14),

  worker: {
    batchCount: int(process.env.WORKER_BATCH_COUNT, 100),
    blockMs: int(process.env.WORKER_BLOCK_MS, 2000),
    claimIdleMs: int(process.env.WORKER_CLAIM_IDLE_MS, 30_000),
    maxDeliveries: int(process.env.WORKER_MAX_DELIVERIES, 5),
  },
};
