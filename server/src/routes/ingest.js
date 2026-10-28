'use strict';

const express = require('express');
const { validateEvents } = require('../lib/eventSchema');
const { consumeEvents } = require('../middleware/rateLimit');
const { enqueueBatch } = require('../queue/eventStream');

const MAX_REPORTED_ERRORS = 10;

function ingestRouter({ redis, config }) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    const events = req.body && req.body.events;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'body must be { events: [...] } with at least one event' });
    }
    if (events.length > config.maxEventsPerRequest) {
      return res
        .status(413)
        .json({ error: `at most ${config.maxEventsPerRequest} events per request` });
    }

    const { accepted, rejected } = validateEvents(events, { retentionDays: config.retentionDays });
    const projectId = String(req.project.id);

    try {
      if (accepted.length > 0) {
        const limit = await consumeEvents(redis, projectId, accepted.length, config.rateLimitPerSecond);
        if (!limit.allowed) {
          res.set('Retry-After', String(limit.retryAfterSec));
          return res.status(429).json({ error: 'rate limit exceeded' });
        }
        await enqueueBatch(redis, config, projectId, accepted);
      }
    } catch (err) {
      // Redis is unavailable: tell the SDK to retry instead of silently losing data.
      err.status = 503;
      return next(err);
    }

    return res.status(202).json({
      accepted: accepted.length,
      rejected: rejected.length,
      errors: rejected.slice(0, MAX_REPORTED_ERRORS),
    });
  });

  return router;
}

module.exports = { ingestRouter };
