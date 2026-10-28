'use strict';

/**
 * "ShopX": a fake online shop instrumented with pulse-sdk. It sends traffic to
 * itself so the Pulse dashboard always has live data to show. Every few
 * minutes it simulates an incident (checkout starts failing and slowing down)
 * so alerts and error graphs have something to catch.
 */
const express = require('express');
const pulseSdk = require('pulse-sdk');

const PORT = Number(process.env.PORT || 5000);
const REQUESTS_PER_SECOND = Number(process.env.DEMO_RPS || 2);
const INCIDENT_EVERY_MS = Number(process.env.DEMO_INCIDENT_EVERY_MS || 5 * 60_000);
const INCIDENT_LENGTH_MS = Number(process.env.DEMO_INCIDENT_LENGTH_MS || 60_000);

if (!process.env.PULSE_API_KEY) {
  console.error('Set PULSE_API_KEY: create a project in the Pulse dashboard and copy its key');
  process.exit(1);
}

const pulse = pulseSdk.init({
  apiKey: process.env.PULSE_API_KEY,
  endpoint: process.env.PULSE_ENDPOINT || 'http://localhost:4000',
  service: 'shopx-api',
  environment: 'production',
  debug: true,
});

const startedAt = Date.now();
const inIncident = () => (Date.now() - startedAt) % INCIDENT_EVERY_MS > INCIDENT_EVERY_MS - INCIDENT_LENGTH_MS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Roughly log-normal latency: mostly fast, with a long tail like real services.
const latency = (medianMs) => medianMs * Math.exp((Math.random() - 0.5) * 1.6);

const app = express();
app.use(express.json());
app.use(pulse.middleware());

app.get('/products', async (req, res) => {
  await sleep(latency(40));
  res.json([{ id: 1, name: 'Mechanical keyboard' }, { id: 2, name: 'USB-C hub' }]);
});

app.get('/products/:id', async (req, res) => {
  await sleep(latency(25));
  if (Number(req.params.id) > 900) return res.status(404).json({ error: 'not found' });
  return res.json({ id: Number(req.params.id), price: 1999 });
});

app.get('/search', async (req, res) => {
  // Search is the slow endpoint: something for the latency charts to flag.
  await sleep(latency(180));
  res.json({ results: [] });
});

app.post('/cart', async (req, res) => {
  await sleep(latency(35));
  res.status(201).json({ ok: true });
});

app.post('/checkout', async (req, res, next) => {
  const incident = inIncident();
  await sleep(latency(incident ? 900 : 120));
  const failRate = incident ? 0.35 : 0.01;
  if (Math.random() < failRate) {
    return next(new Error('payment gateway timeout'));
  }
  pulse.info('order placed', { amount: Math.round(Math.random() * 5000) });
  return res.json({ orderId: Math.floor(Math.random() * 1e6) });
});

app.use(pulse.errorHandler());
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: 'something went wrong' }));

const traffic = [
  { weight: 35, method: 'GET', path: () => '/products' },
  { weight: 30, method: 'GET', path: () => `/products/${Math.floor(Math.random() * 1000)}` },
  { weight: 15, method: 'GET', path: () => '/search?q=keyboard' },
  { weight: 12, method: 'POST', path: () => '/cart' },
  { weight: 8, method: 'POST', path: () => '/checkout' },
];
const totalWeight = traffic.reduce((s, t) => s + t.weight, 0);

function pickRoute() {
  let n = Math.random() * totalWeight;
  for (const t of traffic) {
    n -= t.weight;
    if (n <= 0) return t;
  }
  return traffic[0];
}

function generateTraffic() {
  const intervalMs = 1000 / REQUESTS_PER_SECOND;
  setInterval(() => {
    const t = pickRoute();
    fetch(`http://localhost:${PORT}${t.path()}`, { method: t.method }).catch(() => {});
  }, intervalMs);
}

const server = app.listen(PORT, () => {
  console.log(`ShopX demo running on :${PORT}, sending ~${REQUESTS_PER_SECOND} req/s of traffic`);
  generateTraffic();
  setInterval(() => console.log('[demo] sdk stats', pulse.stats(), inIncident() ? '(incident in progress)' : ''), 10_000);
});

async function shutdown() {
  server.close();
  await pulse.shutdown();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
