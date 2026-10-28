'use strict';

/**
 * Per-project rate limit counted in events (not requests), using a 1-second
 * fixed window in Redis so the limit holds across multiple API instances.
 * Returns { allowed, retryAfterSec }.
 */
async function consumeEvents(redis, projectId, count, limitPerSecond) {
  const windowSec = Math.floor(Date.now() / 1000);
  const key = `pulse:ratelimit:${projectId}:${windowSec}`;
  const [[, used]] = await redis.multi().incrby(key, count).expire(key, 2).exec();
  if (used > limitPerSecond) {
    return { allowed: false, retryAfterSec: 1 };
  }
  return { allowed: true, retryAfterSec: 0 };
}

module.exports = { consumeEvents };
