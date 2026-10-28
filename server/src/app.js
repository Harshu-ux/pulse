'use strict';

const express = require('express');
const helmet = require('helmet');
const { apiKeyAuth } = require('./middleware/apiKeyAuth');
const { ingestRouter } = require('./routes/ingest');

/**
 * Builds the Express app. Dependencies are passed in (rather than imported)
 * so tests can swap the database for a fake and point at a throwaway Redis.
 *
 * @param {object} deps
 * @param {import('ioredis').Redis} deps.redis
 * @param {{ findByKeyHash(hash: string): Promise<{id: string, name: string} | null> }} deps.projects
 * @param {object} deps.config
 * @param {boolean} [deps.dashboardApi] mount the dashboard routes (needs a MongoDB connection)
 */
function createApp({ redis, projects, config, logger = console, dashboardApi = false }) {
  const app = express();
  app.disable('x-powered-by');
  // Behind the dashboard's nginx proxy, so req.ip is the real client IP.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (req, res) => {
    try {
      await redis.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', redis: 'unreachable' });
    }
  });

  app.use('/v1/ingest', apiKeyAuth(projects), ingestRouter({ redis, config }));

  if (dashboardApi) {
    const { authRouter } = require('./routes/auth');
    const { projectsRouter } = require('./routes/projects');
    const { queryRouter } = require('./routes/query');
    const { requireUser, loadOwnedProject } = require('./middleware/requireUser');

    app.use('/api/auth', authRouter({ redis, config }));
    app.use('/api/projects', requireUser(config), projectsRouter());
    app.use('/api/projects/:projectId', requireUser(config), loadOwnedProject, queryRouter());
  }

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request body too large' });
    }
    const status = err.status || 500;
    if (status >= 500) logger.error('[pulse-server]', err);
    return res.status(status).json({ error: status === 503 ? 'temporarily unavailable' : 'internal error' });
  });

  return app;
}

module.exports = { createApp };
