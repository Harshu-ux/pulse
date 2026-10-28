'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Event = require('../models/Event');

/**
 * Supported dashboard time ranges and the chart bucket size used for each,
 * chosen so every chart has roughly 30-90 points.
 */
const RANGES = {
  '15m': { ms: 15 * 60e3, unit: 'second', binSize: 30 },
  '1h': { ms: 60 * 60e3, unit: 'minute', binSize: 1 },
  '6h': { ms: 6 * 60 * 60e3, unit: 'minute', binSize: 5 },
  '24h': { ms: 24 * 60 * 60e3, unit: 'minute', binSize: 15 },
  '7d': { ms: 7 * 24 * 60 * 60e3, unit: 'hour', binSize: 2 },
};
const UNIT_MS = { second: 1e3, minute: 60e3, hour: 3600e3 };

const PERCENTILES = { $percentile: { input: '$durationMs', p: [0.5, 0.95, 0.99], method: 'approximate' } };
const isServerError = { $cond: [{ $gte: ['$status', 500] }, 1, 0] };
const isClientError = { $cond: [{ $and: [{ $gte: ['$status', 400] }, { $lt: ['$status', 500] }] }, 1, 0] };

const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

function timeWindow(rangeKey, now = Date.now()) {
  const range = RANGES[rangeKey];
  return { range, from: new Date(now - range.ms), to: new Date(now) };
}

function baseMatch(projectId, { from, to, type, service }) {
  const match = { 'meta.projectId': String(projectId), timestamp: { $gte: from, $lt: to } };
  if (type) match['meta.type'] = type;
  if (service) match['meta.service'] = service;
  return match;
}

function shapeStats(s, minutes) {
  if (!s) return { requests: 0, rpm: 0, errors: 0, clientErrors: 0, errorRate: 0, avgMs: null, p50: null, p95: null, p99: null };
  const [p50, p95, p99] = s.pct || [];
  return {
    requests: s.requests,
    rpm: round(s.requests / minutes, 1),
    errors: s.errors,
    clientErrors: s.clientErrors,
    errorRate: round((s.errors / s.requests) * 100, 2),
    avgMs: round(s.avg),
    p50: round(p50),
    p95: round(p95),
    p99: round(p99),
  };
}

async function requestStats(projectId, from, to, service) {
  const [s] = await Event.aggregate([
    { $match: baseMatch(projectId, { from, to, type: 'request', service }) },
    {
      $group: {
        _id: null,
        requests: { $sum: 1 },
        errors: { $sum: isServerError },
        clientErrors: { $sum: isClientError },
        avg: { $avg: '$durationMs' },
        pct: PERCENTILES,
      },
    },
  ]);
  return s;
}

/** KPI tiles: totals for the range plus the previous period of the same length for comparison. */
async function overview(projectId, { range: rangeKey, service, now = Date.now() }) {
  const { range, from, to } = timeWindow(rangeKey, now);
  const prevFrom = new Date(from.getTime() - range.ms);
  const minutes = range.ms / 60e3;

  const [current, previous, errorEvents, services] = await Promise.all([
    requestStats(projectId, from, to, service),
    requestStats(projectId, prevFrom, from, service),
    Event.countDocuments(baseMatch(projectId, { from, to, type: 'error', service })),
    Event.aggregate([
      { $match: baseMatch(projectId, { from: new Date(now - RANGES['7d'].ms), to }) },
      { $group: { _id: '$meta.service' } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    range: rangeKey,
    ...shapeStats(current, minutes),
    errorEvents,
    previous: shapeStats(previous, minutes),
    services: services.map((s) => s._id),
  };
}

/** Chart data: one point per bucket, with empty buckets filled in so lines don't skip gaps. */
async function timeseries(projectId, { range: rangeKey, service, now = Date.now() }) {
  const { range, from, to } = timeWindow(rangeKey, now);
  const binMs = range.binSize * UNIT_MS[range.unit];

  const rows = await Event.aggregate([
    { $match: baseMatch(projectId, { from, to, type: 'request', service }) },
    {
      $group: {
        _id: { $dateTrunc: { date: '$timestamp', unit: range.unit, binSize: range.binSize } },
        requests: { $sum: 1 },
        errors: { $sum: isServerError },
        pct: PERCENTILES,
      },
    },
  ]);
  const byBucket = new Map(rows.map((r) => [r._id.getTime(), r]));

  const points = [];
  for (let t = Math.floor(from.getTime() / binMs) * binMs; t < to.getTime(); t += binMs) {
    const r = byBucket.get(t);
    points.push({
      t: new Date(t).toISOString(),
      requests: r ? r.requests : 0,
      errors: r ? r.errors : 0,
      errorRate: r && r.requests ? round((r.errors / r.requests) * 100, 2) : 0,
      p50: r ? round(r.pct[0]) : null,
      p95: r ? round(r.pct[1]) : null,
      p99: r ? round(r.pct[2]) : null,
    });
  }
  return { range: rangeKey, bucketMs: binMs, points };
}

/** Per-route table: traffic, error rate and latency percentiles. */
async function endpoints(projectId, { range: rangeKey, service, now = Date.now() }) {
  const { range, from, to } = timeWindow(rangeKey, now);
  const rows = await Event.aggregate([
    { $match: baseMatch(projectId, { from, to, type: 'request', service }) },
    {
      $group: {
        _id: { method: '$method', route: '$route' },
        requests: { $sum: 1 },
        errors: { $sum: isServerError },
        avg: { $avg: '$durationMs' },
        pct: PERCENTILES,
      },
    },
    { $sort: { requests: -1 } },
    { $limit: 100 },
  ]);
  return {
    endpoints: rows.map((r) => ({
      method: r._id.method,
      route: r._id.route,
      ...shapeStats({ ...r, clientErrors: 0 }, range.ms / 60e3),
    })),
  };
}

const issueId = (name, message) => crypto.createHash('sha1').update(`${name}\n${message}`).digest('hex').slice(0, 12);

/** Errors grouped into "issues" by error type + message, most recent first. */
async function issues(projectId, { range: rangeKey, service, now = Date.now() }) {
  const { from, to } = timeWindow(rangeKey, now);
  const rows = await Event.aggregate([
    { $match: baseMatch(projectId, { from, to, type: 'error', service }) },
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: { name: '$errorName', message: '$message' },
        count: { $sum: 1 },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
        routes: { $addToSet: '$route' },
        services: { $addToSet: '$meta.service' },
        stack: { $first: '$stack' },
      },
    },
    { $sort: { lastSeen: -1 } },
    { $limit: 50 },
  ]);
  return {
    issues: rows.map((r) => ({
      id: issueId(r._id.name, r._id.message),
      errorName: r._id.name || 'Error',
      message: r._id.message || '(no message)',
      count: r.count,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      routes: r.routes.filter(Boolean).slice(0, 5),
      services: r.services,
      stack: r.stack || null,
    })),
  };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Log explorer: newest first, filtered, with cursor pagination
 * ("load older" passes back the last item's timestamp + id).
 */
async function logs(projectId, { range: rangeKey, service, type, levels, q, route, before, limit = 100, now = Date.now() }) {
  const { from, to } = timeWindow(rangeKey, now);
  const match = baseMatch(projectId, { from, to, type, service });
  if (levels && levels.length) match.level = { $in: levels };
  if (route) match.route = route;
  if (q) match.message = { $regex: escapeRegex(q), $options: 'i' };
  if (before) {
    const [ts, id] = before.split('_');
    const t = new Date(ts);
    match.$or = [{ timestamp: { $lt: t } }, { timestamp: t, _id: { $lt: new mongoose.Types.ObjectId(id) } }];
  }

  const rows = await Event.find(match).sort({ timestamp: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((e) => ({
    id: String(e._id),
    timestamp: e.timestamp,
    type: e.meta.type,
    service: e.meta.service,
    level: e.level,
    message: e.message,
    method: e.method,
    route: e.route,
    status: e.status,
    durationMs: e.durationMs,
    errorName: e.errorName,
    stack: e.stack,
    attrs: e.attrs,
  }));
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? `${new Date(last.timestamp).toISOString()}_${last.id}` : null };
}

module.exports = { RANGES, overview, timeseries, endpoints, issues, logs, issueId };
