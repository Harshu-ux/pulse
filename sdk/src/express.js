'use strict';

/**
 * Builds the route label for a request. We prefer the matched Express route
 * pattern ("/orders/:id") over the raw path ("/orders/8812") so that every
 * order lookup is grouped together on the dashboard instead of creating
 * thousands of one-off "routes".
 */
function routeLabel(req) {
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    const path = typeof req.route.path === 'string' ? req.route.path : String(req.route.path);
    return base + path || '/';
  }
  return 'unmatched';
}

function requestMiddleware(client) {
  const ignore = new Set(client.options.ignorePaths || []);

  return function pulseRequestMiddleware(req, res, next) {
    if (ignore.has(req.path)) return next();

    const start = process.hrtime.bigint();
    let recorded = false;

    const record = (aborted) => {
      if (recorded) return;
      recorded = true;
      const status = aborted ? 499 : res.statusCode;
      const isError = status >= 500;
      // Sampling only applies to healthy requests; failures are always kept.
      if (!isError && Math.random() >= client.options.sampleRate) return;

      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      client.capture({
        type: 'request',
        method: req.method,
        route: routeLabel(req),
        status,
        durationMs: Math.round(durationMs * 100) / 100,
        level: isError ? 'error' : status >= 400 ? 'warn' : 'info',
        message: `${req.method} ${routeLabel(req)} ${status}`,
      });
    };

    res.on('finish', () => record(false));
    res.on('close', () => record(!res.writableFinished));
    next();
  };
}

function errorMiddleware(client) {
  // eslint-disable-next-line no-unused-vars
  return function pulseErrorMiddleware(err, req, res, next) {
    client.captureError(err, { method: req.method, route: routeLabel(req) });
    next(err);
  };
}

module.exports = { requestMiddleware, errorMiddleware, routeLabel };
