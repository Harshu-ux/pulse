import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Fetches a URL and keeps it fresh.
 *  - refetches when `url` changes, aborting the stale request
 *  - optional `refreshMs` polling (paused while the tab is hidden)
 *  - keeps showing the previous data while a refresh is in flight, so charts
 *    don't flash empty every few seconds
 */
export function useApi(url, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const controller = useRef(null);

  const load = useCallback(async () => {
    if (!url) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(url, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setState({ data, error: null, loading: false });
    } catch (error) {
      if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
    }
  }, [url]);

  useEffect(() => {
    setState((s) => ({ ...s, data: null, error: null }));
    load();
    return () => controller.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  return { ...state, reload: load };
}
