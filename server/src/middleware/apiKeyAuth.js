'use strict';

const { hashApiKey } = require('../lib/apiKeys');

const CACHE_TTL_MS = 60_000;

/**
 * Resolves the x-pulse-key header to a project. Lookups are cached in memory
 * for a minute because this runs on every ingest request, and hitting the
 * database each time would make it the bottleneck. Unknown keys are cached
 * too, so a misconfigured client hammering us costs nothing.
 */
function apiKeyAuth(projects, { ttlMs = CACHE_TTL_MS } = {}) {
  const cache = new Map();

  return async function authenticate(req, res, next) {
    const key = req.get('x-pulse-key');
    if (!key) return res.status(401).json({ error: 'missing x-pulse-key header' });

    const hash = hashApiKey(key);
    const now = Date.now();
    let entry = cache.get(hash);

    if (!entry || entry.expires < now) {
      try {
        const project = await projects.findByKeyHash(hash);
        entry = { project, expires: now + ttlMs };
        cache.set(hash, entry);
        if (cache.size > 10_000) cache.delete(cache.keys().next().value);
      } catch (err) {
        return next(err);
      }
    }

    if (!entry.project) return res.status(401).json({ error: 'invalid api key' });
    req.project = entry.project;
    return next();
  };
}

module.exports = { apiKeyAuth };
