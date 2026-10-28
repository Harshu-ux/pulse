'use strict';

const { WebSocketServer } = require('ws');
const mongoose = require('mongoose');
const { verifyToken } = require('./auth');

const HEARTBEAT_MS = 30_000;

/**
 * Pushes live updates to dashboards.
 *
 * Workers publish "new data landed" messages on a Redis pub/sub channel. Every
 * API instance subscribes and forwards each message to the browsers watching
 * that project, so this works no matter how many API instances or workers run.
 *
 * Browsers connect to /ws?token=<jwt>&project=<id>. The token is checked and
 * the project must belong to the user, same as the REST API.
 */
function attachLiveHub(server, { subscriber, config, findOwnedProject, logger = console }) {
  const wss = new WebSocketServer({ noServer: true });
  const watchers = new Map(); // projectId -> Set<WebSocket>

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();

    const user = verifyToken(url.searchParams.get('token'), config);
    const projectId = url.searchParams.get('project');
    const project =
      user && mongoose.isValidObjectId(projectId) ? await findOwnedProject(projectId, user.id).catch(() => null) : null;
    if (!project) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.projectId = String(projectId);
      ws.isAlive = true;
      if (!watchers.has(ws.projectId)) watchers.set(ws.projectId, new Set());
      watchers.get(ws.projectId).add(ws);
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.on('close', () => {
        const set = watchers.get(ws.projectId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) watchers.delete(ws.projectId);
        }
      });
      ws.send(JSON.stringify({ type: 'hello', projectId: ws.projectId }));
    });
    return undefined;
  });

  subscriber.subscribe(config.liveChannel).catch((err) => logger.error('[live] subscribe failed', err));
  subscriber.on('message', (channel, raw) => {
    if (channel !== config.liveChannel) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const set = watchers.get(String(msg.projectId));
    if (!set) return;
    const payload = JSON.stringify({ type: 'events', ...msg });
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(payload);
  });

  // Drop connections that stopped answering pings (closed laptop lids, dead proxies).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    connectionCount: () => wss.clients.size,
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

module.exports = { attachLiveHub };
