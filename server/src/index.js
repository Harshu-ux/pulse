'use strict';

const Redis = require('ioredis');
const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');
const { connectMongo, projectRepo } = require('./lib/mongoStore');
const { attachLiveHub } = require('./lib/liveHub');
const Project = require('./models/Project');

async function main() {
  if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-only-insecure-secret') {
    throw new Error('JWT_SECRET must be set in production');
  }
  await connectMongo(config.mongoUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  // Pub/sub needs a dedicated connection.
  const subscriber = new Redis(config.redisUrl);

  const app = createApp({ redis, projects: projectRepo, config, dashboardApi: true });
  const server = app.listen(config.port, () => {
    console.info(`[pulse-server] API listening on :${config.port}`);
  });
  const live = attachLiveHub(server, {
    subscriber,
    config,
    findOwnedProject: (id, ownerId) => Project.findOne({ _id: id, ownerId }).lean(),
  });

  const shutdown = async (signal) => {
    console.info(`[pulse-server] ${signal} received, shutting down`);
    live.close();
    server.close(async () => {
      await Promise.allSettled([redis.quit(), subscriber.quit(), mongoose.disconnect()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[pulse-server] failed to start', err);
  process.exit(1);
});
