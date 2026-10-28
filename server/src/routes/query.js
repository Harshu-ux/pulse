'use strict';

const express = require('express');
const { z } = require('zod');
const queries = require('../lib/queries');

const common = {
  range: z.enum(Object.keys(queries.RANGES)).default('1h'),
  service: z.string().max(100).optional(),
};

const logsSchema = z.object({
  ...common,
  type: z.enum(['request', 'error', 'log']).optional(),
  // ?level=warn,error
  level: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(['debug', 'info', 'warn', 'error'])).optional()),
  q: z.string().trim().max(200).optional(),
  route: z.string().max(300).optional(),
  before: z.string().regex(/^[\dT:.\-Z]+_[a-f\d]{24}$/, 'invalid cursor').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Wraps a query function as a GET handler with validated query-string params. */
function handler(schema, fn) {
  return async (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    try {
      const { level, ...rest } = parsed.data;
      return res.json(await fn(String(req.project._id), { ...rest, levels: level }));
    } catch (err) {
      return next(err);
    }
  };
}

function queryRouter() {
  const router = express.Router({ mergeParams: true });
  const basic = z.object(common);
  router.get('/overview', handler(basic, queries.overview));
  router.get('/timeseries', handler(basic, queries.timeseries));
  router.get('/endpoints', handler(basic, queries.endpoints));
  router.get('/issues', handler(basic, queries.issues));
  router.get('/logs', handler(logsSchema, queries.logs));
  return router;
}

module.exports = { queryRouter };
