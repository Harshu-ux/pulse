import { useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/api.js';

const WINDOW_SECONDS = 60;
const MAX_EVENTS = 200;

/**
 * Subscribes to a project's live feed over WebSocket.
 * Returns:
 *  - connected: whether the socket is open
 *  - seconds: last 60 one-second buckets of { requests, serverErrors }
 *  - events: newest events first (for the log tail)
 *  - lastMessageAt: timestamp of the latest update, used to trigger refreshes
 * Reconnects with exponential backoff if the connection drops.
 */
export function useLive(projectId) {
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(() => emptyWindow());
  const [events, setEvents] = useState([]);
  const [lastMessageAt, setLastMessageAt] = useState(0);
  const buckets = useRef(new Map());

  useEffect(() => {
    if (!projectId) return undefined;
    let ws;
    let retry = 0;
    let retryTimer;
    let closed = false;
    buckets.current = new Map();
    setEvents([]);

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const qs = new URLSearchParams({ token: getToken() || '', project: projectId });
      ws = new WebSocket(`${proto}://${window.location.host}/ws?${qs}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type !== 'events') return;
        const sec = Math.floor(Date.now() / 1000);
        const b = buckets.current.get(sec) || { requests: 0, serverErrors: 0 };
        b.requests += msg.counts.request;
        b.serverErrors += msg.serverErrors;
        buckets.current.set(sec, b);
        const stamped = msg.events.map((ev, i) => ({ ...ev, id: `live-${sec}-${Math.random().toString(36).slice(2)}-${i}`, live: true }));
        setEvents((prev) => [...stamped, ...prev].slice(0, MAX_EVENTS));
        setLastMessageAt(Date.now());
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry += 1;
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retry, 5)));
      };
    };
    connect();

    // Roll the 60-second window forward once a second.
    const tickTimer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      for (const k of buckets.current.keys()) if (k <= now - WINDOW_SECONDS) buckets.current.delete(k);
      setSeconds(
        Array.from({ length: WINDOW_SECONDS }, (_, i) => {
          const s = now - WINDOW_SECONDS + 1 + i;
          return { t: s, ...(buckets.current.get(s) || { requests: 0, serverErrors: 0 }) };
        }),
      );
    }, 1000);

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(tickTimer);
      ws?.close();
    };
  }, [projectId]);

  return { connected, seconds, events, lastMessageAt };
}

function emptyWindow() {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: WINDOW_SECONDS }, (_, i) => ({ t: now - WINDOW_SECONDS + 1 + i, requests: 0, serverErrors: 0 }));
}
