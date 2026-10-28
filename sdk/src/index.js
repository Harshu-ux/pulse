'use strict';

const { PulseClient } = require('./client');
const { requestMiddleware, errorMiddleware } = require('./express');

/**
 * Usage:
 *   const pulse = require('pulse-sdk').init({ apiKey, endpoint, service: 'shop-api' });
 *   app.use(pulse.middleware());
 *   ...routes...
 *   app.use(pulse.errorHandler());
 */
function init(options) {
  const client = new PulseClient(options);
  return {
    client,
    middleware: () => requestMiddleware(client),
    errorHandler: () => errorMiddleware(client),
    log: (level, message, attrs) => client.log(level, message, attrs),
    info: (message, attrs) => client.log('info', message, attrs),
    warn: (message, attrs) => client.log('warn', message, attrs),
    error: (message, attrs) => client.log('error', message, attrs),
    captureError: (err, ctx) => client.captureError(err, ctx),
    flush: () => client.flush(),
    shutdown: () => client.shutdown(),
    stats: () => ({ ...client.stats, buffered: client.buffer.length }),
  };
}

module.exports = { init, PulseClient };
