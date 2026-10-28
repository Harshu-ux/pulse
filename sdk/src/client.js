'use strict';

const DEFAULTS = {
  endpoint: 'http://localhost:4000',
  service: 'default',
  environment: process.env.NODE_ENV || 'development',
  batchSize: 100,          // flush when this many events are buffered
  flushIntervalMs: 2000,   // ...or at least this often
  maxBufferSize: 10000,    // hard cap so a down server can't eat the host app's memory
  maxRetries: 3,
  retryBaseMs: 250,
  sampleRate: 1,           // fraction of successful requests to keep (errors are always kept)
  timeoutMs: 5000,
  debug: false,
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class PulseClient {
  constructor(options = {}) {
    if (!options.apiKey) {
      throw new Error('pulse-sdk: apiKey is required');
    }
    this.options = { ...DEFAULTS, ...options };
    this.options.endpoint = this.options.endpoint.replace(/\/+$/, '');
    this.buffer = [];
    this.inFlight = new Set();
    this.stats = { sent: 0, dropped: 0, failedBatches: 0 };
    this.closed = false;
    this._fetch = options.fetch || globalThis.fetch;

    this.timer = setInterval(() => this.flush(), this.options.flushIntervalMs);
    // Never keep the host process alive just because of us.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Queue an event. Never throws into the host application. */
  capture(event) {
    if (this.closed) return;
    try {
      const enriched = {
        timestamp: new Date().toISOString(),
        service: this.options.service,
        environment: this.options.environment,
        ...event,
      };
      if (this.buffer.length >= this.options.maxBufferSize) {
        // Drop the oldest event: recent data is more useful during an incident.
        this.buffer.shift();
        this.stats.dropped += 1;
      }
      this.buffer.push(enriched);
      if (this.buffer.length >= this.options.batchSize) {
        this.flush();
      }
    } catch (err) {
      this._debug('capture failed', err);
    }
  }

  log(level, message, attrs) {
    this.capture({ type: 'log', level, message: String(message), attrs });
  }

  captureError(error, context = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    this.capture({
      type: 'error',
      level: 'error',
      message: err.message,
      errorName: err.name,
      stack: err.stack,
      ...context,
    });
  }

  /** Send everything currently buffered. Resolves when the send finishes. */
  flush() {
    if (this.buffer.length === 0) return Promise.resolve();
    const batch = this.buffer.splice(0, this.options.batchSize);
    const p = this._send(batch).finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
    // Keep draining if more than one batch was waiting.
    if (this.buffer.length >= this.options.batchSize) this.flush();
    return p;
  }

  /** Flush remaining events and stop the timer. Call on process shutdown. */
  async shutdown() {
    clearInterval(this.timer);
    while (this.buffer.length > 0) {
      await this.flush();
    }
    await Promise.allSettled([...this.inFlight]);
    this.closed = true;
  }

  async _send(events) {
    const { endpoint, apiKey, maxRetries, retryBaseMs, timeoutMs } = this.options;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this._fetch(`${endpoint}/v1/ingest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-pulse-key': apiKey },
          body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          this.stats.sent += events.length;
          return;
        }
        if (!RETRYABLE_STATUS.has(res.status)) {
          // 400/401/403: retrying won't help, drop the batch.
          this._debug(`batch rejected with status ${res.status}`);
          break;
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        if (retryAfter > 0 && attempt < maxRetries) {
          await sleep(retryAfter * 1000);
          continue;
        }
      } catch (err) {
        this._debug(`send attempt ${attempt + 1} failed: ${err.message}`);
      }
      if (attempt < maxRetries) {
        // Exponential backoff with jitter.
        await sleep(retryBaseMs * 2 ** attempt * (0.5 + Math.random()));
      }
    }
    this.stats.failedBatches += 1;
    this.stats.dropped += events.length;
  }

  _debug(...args) {
    if (this.options.debug) console.warn('[pulse-sdk]', ...args);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { PulseClient };
