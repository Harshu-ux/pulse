'use strict';

/**
 * Creates the demo account and project (safe to run repeatedly), and can
 * backfill realistic history so the dashboard has charts to show right away.
 *
 *   DEMO_USER_EMAIL=demo@pulse.dev DEMO_USER_PASSWORD=... PULSE_API_KEY=... \
 *   BACKFILL_HOURS=24 npm run seed
 */
const mongoose = require('mongoose');
const config = require('../config');
const { connectMongo } = require('../lib/mongoStore');
const { hashPassword } = require('../lib/auth');
const { hashApiKey } = require('../lib/apiKeys');
const User = require('../models/User');
const Project = require('../models/Project');
const Event = require('../models/Event');

const EMAIL = process.env.DEMO_USER_EMAIL || 'demo@pulse.dev';
const PASSWORD = process.env.DEMO_USER_PASSWORD || 'demo-password';
const API_KEY = process.env.PULSE_API_KEY || 'pk_local_demo_key_change_me';
const BACKFILL_HOURS = Number(process.env.BACKFILL_HOURS || 0);
const BACKFILL_RPM = Number(process.env.BACKFILL_RPM || 120);

// Same shape of traffic as demo-app: route, share of traffic, median latency (ms), normal failure rate.
const ROUTES = [
  { method: 'GET', route: '/products', weight: 35, median: 40, fail: 0.002 },
  { method: 'GET', route: '/products/:id', weight: 30, median: 25, fail: 0.002 },
  { method: 'GET', route: '/search', weight: 15, median: 180, fail: 0.005 },
  { method: 'POST', route: '/cart', weight: 12, median: 35, fail: 0.003 },
  { method: 'POST', route: '/checkout', weight: 8, median: 120, fail: 0.01 },
];
const TOTAL_WEIGHT = ROUTES.reduce((s, r) => s + r.weight, 0);
const ERRORS = {
  '/checkout': { name: 'Error', message: 'payment gateway timeout' },
  '/search': { name: 'TypeError', message: "Cannot read properties of undefined (reading 'hits')" },
  default: { name: 'MongoServerError', message: 'connection pool cleared' },
};

function pick() {
  let n = Math.random() * TOTAL_WEIGHT;
  for (const r of ROUTES) if ((n -= r.weight) <= 0) return r;
  return ROUTES[0];
}

async function backfill(projectId) {
  const now = Date.now();
  const start = now - BACKFILL_HOURS * 3600e3;
  // Two past incidents where checkout breaks for 20 minutes.
  const incidents = [start + 0.35 * (now - start), start + 0.8 * (now - start)];
  const inIncident = (t) => incidents.some((i) => t >= i && t < i + 20 * 60e3);

  let batch = [];
  let total = 0;
  for (let minute = start; minute < now; minute += 60e3) {
    // Daily rhythm: busier in the evening, quiet at night.
    const hour = new Date(minute).getUTCHours() + 5.5; // IST
    const load = 0.55 + 0.45 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    const count = Math.round(BACKFILL_RPM * load * (0.85 + Math.random() * 0.3));

    for (let i = 0; i < count; i++) {
      const r = pick();
      const t = new Date(minute + Math.random() * 60e3);
      const incident = r.route === '/checkout' && inIncident(t.getTime());
      const failed = Math.random() < (incident ? 0.35 : r.fail);
      const notFound = !failed && r.route === '/products/:id' && Math.random() < 0.08;
      const durationMs = Math.round(r.median * (incident ? 7 : 1) * Math.exp((Math.random() - 0.5) * 1.6) * 100) / 100;
      const status = failed ? 500 : notFound ? 404 : r.method === 'POST' && r.route === '/cart' ? 201 : 200;
      const meta = { projectId, service: 'shopx-api', environment: 'production' };

      batch.push({
        timestamp: t, meta: { ...meta, type: 'request' }, method: r.method, route: r.route, status, durationMs,
        level: failed ? 'error' : notFound ? 'warn' : 'info', message: `${r.method} ${r.route} ${status}`,
      });
      if (failed) {
        const e = ERRORS[r.route] || ERRORS.default;
        batch.push({
          timestamp: t, meta: { ...meta, type: 'error' }, level: 'error', method: r.method, route: r.route,
          errorName: e.name, message: e.message,
          stack: `${e.name}: ${e.message}\n    at handler (/app/routes${r.route.replace('/:id', '')}.js:42:11)\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)`,
        });
      } else if (r.route === '/checkout') {
        batch.push({
          timestamp: t, meta: { ...meta, type: 'log' }, level: 'info', message: 'order placed',
          attrs: { amount: Math.round(Math.random() * 5000) },
        });
      }
    }
    if (batch.length >= 5000) {
      total += batch.length;
      await Event.insertMany(batch, { ordered: false, lean: true });
      batch = [];
    }
  }
  if (batch.length) {
    total += batch.length;
    await Event.insertMany(batch, { ordered: false, lean: true });
  }
  return total;
}

async function main() {
  await connectMongo(config.mongoUrl);

  let user = await User.findOne({ email: EMAIL });
  if (!user) {
    user = await User.create({ email: EMAIL, name: 'Demo User', passwordHash: await hashPassword(PASSWORD) });
    console.log(`Created demo user ${EMAIL}`);
  }

  let project = await Project.findOne({ apiKeyHash: hashApiKey(API_KEY) });
  if (!project) {
    project = await Project.create({
      name: 'ShopX',
      ownerId: user._id,
      apiKeyHash: hashApiKey(API_KEY),
      apiKeyPrefix: API_KEY.slice(0, 10),
    });
    console.log(`Created project "ShopX" (${project._id})`);

    if (BACKFILL_HOURS > 0) {
      const n = await backfill(String(project._id));
      console.log(`Backfilled ${n} events over the last ${BACKFILL_HOURS}h`);
    }
  } else {
    console.log('Demo project already exists, nothing to do.');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
