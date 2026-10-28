'use strict';

const mongoose = require('mongoose');
const config = require('../config');

/**
 * Events live in a MongoDB time-series collection. MongoDB groups documents
 * that share the same `meta` (project, service, type) into compressed buckets
 * by time, which makes "last hour of errors for service X" queries cheap and
 * storage much smaller than a regular collection. Old data expires
 * automatically after the retention period.
 */
const eventSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    meta: {
      projectId: { type: String, required: true },
      service: { type: String, required: true },
      environment: String,
      type: { type: String, enum: ['request', 'error', 'log'], required: true },
    },
    level: String,
    message: String,
    method: String,
    route: String,
    status: Number,
    durationMs: Number,
    errorName: String,
    stack: String,
    attrs: mongoose.Schema.Types.Mixed,
  },
  {
    versionKey: false,
    timeseries: {
      timeField: 'timestamp',
      metaField: 'meta',
      granularity: 'seconds',
    },
    expireAfterSeconds: config.retentionDays * 24 * 60 * 60,
  },
);

eventSchema.index({ 'meta.projectId': 1, 'meta.type': 1, timestamp: -1 });
eventSchema.index({ 'meta.projectId': 1, route: 1, timestamp: -1 });

module.exports = mongoose.models.Event || mongoose.model('Event', eventSchema, 'events');
