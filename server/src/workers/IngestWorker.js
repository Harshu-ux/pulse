'use strict';

const os = require('os');
const { fieldsToObject } = require('../queue/eventStream');

const LIVE_SAMPLE_SIZE = 25;

/** Maps a validated API event to the shape stored in MongoDB. */
function toDocument(projectId, e) {
  const doc = {
    timestamp: new Date(e.timestamp),
    meta: { projectId, service: e.service, environment: e.environment, type: e.type },
    level: e.level,
  };
  for (const f of ['message', 'method', 'route', 'status', 'durationMs', 'errorName', 'stack', 'attrs']) {
    if (e[f] !== undefined) doc[f] = e[f];
  }
  return doc;
}

/**
 * Reads batches from the Redis stream via a consumer group and writes them to
 * the event store in bulk.
 *
 * Delivery guarantees (at-least-once):
 *  - An entry is acknowledged only after the database write succeeds.
 *  - If a worker crashes mid-batch, its un-acked entries are reclaimed by
 *    another worker once they've been idle for `claimIdleMs`.
 *  - An entry that keeps failing ("poison message") is moved to a
 *    dead-letter stream after `maxDeliveries` attempts, so it can't block
 *    the pipeline forever.
 */
class IngestWorker {
  constructor({
    redis,
    store,
    streamKey,
    deadLetterKey,
    group,
    consumer = `${os.hostname()}-${process.pid}`,
    batchCount = 100,
    blockMs = 2000,
    claimIdleMs = 30_000,
    maxDeliveries = 5,
    liveChannel = null,
    logger = console,
  }) {
    Object.assign(this, {
      redis,
      store,
      streamKey,
      deadLetterKey,
      group,
      consumer,
      batchCount,
      blockMs,
      claimIdleMs,
      maxDeliveries,
      liveChannel,
      logger,
    });
    this.running = false;
    this.stats = { entriesProcessed: 0, eventsWritten: 0, deadLettered: 0, writeFailures: 0 };
  }

  async ensureGroup() {
    try {
      // Start from '0' so events queued before the group existed are not skipped.
      await this.redis.xgroup('CREATE', this.streamKey, this.group, '0', 'MKSTREAM');
    } catch (err) {
      if (!String(err.message).includes('BUSYGROUP')) throw err;
    }
  }

  /** One iteration: recover stuck entries, then read and process new ones. */
  async runOnce({ block = true } = {}) {
    await this.deadLetterPoisonEntries();

    const [, reclaimed] = await this.redis.xautoclaim(
      this.streamKey, this.group, this.consumer, this.claimIdleMs, '0-0', 'COUNT', this.batchCount,
    );
    if (reclaimed && reclaimed.length) {
      await this.processEntries(reclaimed.filter((e) => e && e[1]));
    }

    const args = ['GROUP', this.group, this.consumer, 'COUNT', this.batchCount];
    if (block) args.push('BLOCK', this.blockMs);
    args.push('STREAMS', this.streamKey, '>');
    const result = await this.redis.xreadgroup(...args);
    if (!result) return 0;
    const [[, entries]] = result;
    await this.processEntries(entries);
    return entries.length;
  }

  async processEntries(entries) {
    if (entries.length === 0) return;
    const docs = [];
    const okIds = [];
    const malformed = [];

    for (const [id, fields] of entries) {
      try {
        const { project, events } = fieldsToObject(fields);
        const parsed = JSON.parse(events);
        if (!project || !Array.isArray(parsed)) throw new Error('missing project or events');
        for (const e of parsed) docs.push(toDocument(project, e));
        okIds.push(id);
      } catch (err) {
        malformed.push({ id, fields, reason: err.message });
      }
    }

    // A malformed entry will never succeed, so dead-letter it right away.
    for (const m of malformed) await this.moveToDeadLetter(m.id, m.fields, m.reason);

    if (okIds.length === 0) return;
    try {
      await this.store.insertEvents(docs);
    } catch (err) {
      // Leave the entries un-acked: they'll be retried via XAUTOCLAIM.
      this.stats.writeFailures += 1;
      this.logger.error(`[worker] write of ${docs.length} events failed: ${err.message}`);
      return;
    }

    await this.redis.multi().xack(this.streamKey, this.group, ...okIds).xdel(this.streamKey, ...okIds).exec();
    this.stats.entriesProcessed += okIds.length;
    this.stats.eventsWritten += docs.length;
    if (this.liveChannel) await this.publishLive(docs);
  }

  /**
   * Tells open dashboards that new data has landed (Redis pub/sub -> API ->
   * WebSocket). Sends per-project counts plus the newest few events for the
   * live log tail. Best-effort: a failed publish never fails the batch.
   */
  async publishLive(docs) {
    const byProject = new Map();
    for (const d of docs) {
      const p = byProject.get(d.meta.projectId) || { counts: { request: 0, error: 0, log: 0 }, serverErrors: 0, events: [] };
      p.counts[d.meta.type] += 1;
      if (d.status >= 500) p.serverErrors += 1;
      p.events.push(d);
      byProject.set(d.meta.projectId, p);
    }
    try {
      const pipeline = this.redis.pipeline();
      for (const [projectId, p] of byProject) {
        const events = p.events
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, LIVE_SAMPLE_SIZE)
          .map((d) => ({
            timestamp: d.timestamp, type: d.meta.type, service: d.meta.service, level: d.level,
            message: d.message, method: d.method, route: d.route, status: d.status,
            durationMs: d.durationMs, errorName: d.errorName,
          }));
        pipeline.publish(this.liveChannel, JSON.stringify({ projectId, counts: p.counts, serverErrors: p.serverErrors, events }));
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`[worker] live publish failed: ${err.message}`);
    }
  }

  async deadLetterPoisonEntries() {
    const pending = await this.redis.xpending(
      this.streamKey, this.group, 'IDLE', this.claimIdleMs, '-', '+', this.batchCount,
    );
    for (const [id, , , deliveries] of pending) {
      if (deliveries < this.maxDeliveries) continue;
      const [entry] = await this.redis.xrange(this.streamKey, id, id);
      await this.moveToDeadLetter(id, entry ? entry[1] : [], `failed after ${deliveries} deliveries`);
    }
  }

  async moveToDeadLetter(id, fields, reason) {
    await this.redis
      .multi()
      .xadd(this.deadLetterKey, 'MAXLEN', '~', '10000', '*', 'originalId', id, 'reason', reason, ...fields)
      .xack(this.streamKey, this.group, id)
      .xdel(this.streamKey, id)
      .exec();
    this.stats.deadLettered += 1;
    this.logger.warn(`[worker] moved entry ${id} to dead-letter stream: ${reason}`);
  }

  async start() {
    await this.ensureGroup();
    this.running = true;
    this.logger.info(`[worker] ${this.consumer} consuming ${this.streamKey}`);
    while (this.running) {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(`[worker] loop error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  stop() {
    this.running = false;
  }
}

module.exports = { IngestWorker, toDocument };
