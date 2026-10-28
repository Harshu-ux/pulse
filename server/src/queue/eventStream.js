'use strict';

/**
 * Thin wrapper around the Redis stream that buffers events between the
 * ingestion API and the workers. One stream entry holds one validated batch,
 * which keeps Redis operations to one per API request.
 */
async function enqueueBatch(redis, { streamKey, streamMaxLen }, projectId, events) {
  return redis.xadd(
    streamKey,
    'MAXLEN',
    '~',
    String(streamMaxLen),
    '*',
    'project',
    String(projectId),
    'events',
    JSON.stringify(events),
  );
}

/** Converts ioredis' flat [k1, v1, k2, v2] field arrays into an object. */
function fieldsToObject(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return obj;
}

module.exports = { enqueueBatch, fieldsToObject };
