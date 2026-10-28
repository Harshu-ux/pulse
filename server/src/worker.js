'use strict';

const Redis = require('ioredis');
const mongoose = require('mongoose');
const config = require('./config');
const { connectMongo, eventStore } = require('./lib/mongoStore');
const { IngestWorker } = require('./workers/IngestWorker');

async function main() {
  await connectMongo(config.mongoUrl);
  // Workers use blocking reads, so they get their own Redis connection.
  const redis = new Redis(config.redisUrl);

  const worker = new IngestWorker({
    redis,
    store: eventStore,
    streamKey: config.streamKey,
    deadLetterKey: config.deadLetterKey,
    group: config.consumerGroup,
    liveChannel: config.liveChannel,
    ...config.worker,
  });

  const shutdown = async (signal) => {
    console.info(`[worker] ${signal} received, finishing current batch`);
    worker.stop();
    // The loop exits after the current blocking read returns (at most blockMs).
    setTimeout(async () => {
      await Promise.allSettled([redis.quit(), mongoose.disconnect()]);
      console.info('[worker] stats', worker.stats);
      process.exit(0);
    }, config.worker.blockMs + 500);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await worker.start();
}

main().catch((err) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
