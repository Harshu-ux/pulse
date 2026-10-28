'use strict';

const { z } = require('zod');

const MAX_ATTRS_BYTES = 4096;
const FUTURE_SKEW_MS = 5 * 60 * 1000; // tolerate clocks up to 5 minutes fast

const eventSchema = z
  .object({
    type: z.enum(['request', 'error', 'log']),
    timestamp: z.string().datetime({ offset: true }).optional(),
    service: z.string().trim().min(1).max(100).default('default'),
    environment: z.string().trim().max(50).default('production'),
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    message: z.string().max(2000).optional(),
    method: z.string().max(10).optional(),
    route: z.string().max(300).optional(),
    status: z.number().int().min(0).max(999).optional(),
    durationMs: z.number().min(0).max(10_000_000).optional(),
    errorName: z.string().max(200).optional(),
    stack: z.string().max(8000).optional(),
    attrs: z
      .record(z.unknown())
      .refine((a) => Buffer.byteLength(JSON.stringify(a)) <= MAX_ATTRS_BYTES, {
        message: `attrs must be at most ${MAX_ATTRS_BYTES} bytes`,
      })
      .optional(),
  })
  .superRefine((e, ctx) => {
    if (e.type === 'request' && (e.status === undefined || e.durationMs === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'request events need status and durationMs' });
    }
  });

/**
 * Validates a batch. Bad events are rejected individually so one malformed
 * event doesn't throw away a whole batch of good data.
 */
function validateEvents(rawEvents, { retentionDays, now = Date.now() }) {
  const accepted = [];
  const rejected = [];
  const oldest = now - retentionDays * 24 * 60 * 60 * 1000;

  rawEvents.forEach((raw, index) => {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ index, reason: parsed.error.issues[0].message });
      return;
    }
    const event = parsed.data;
    const ts = event.timestamp ? Date.parse(event.timestamp) : now;
    if (ts > now + FUTURE_SKEW_MS || ts < oldest) {
      rejected.push({ index, reason: 'timestamp outside accepted window' });
      return;
    }
    event.timestamp = new Date(ts).toISOString();
    accepted.push(event);
  });

  return { accepted, rejected };
}

module.exports = { eventSchema, validateEvents };
