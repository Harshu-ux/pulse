import { useEffect, useState } from 'react';

const NAMES = ['ink', 'ink-2', 'ink-3', 'line', 'grid', 'panel', 'critical-mark', 'series-traffic', 'series-p50', 'series-p95', 'series-p99'];

function read() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(NAMES.map((n) => [n, style.getPropertyValue(`--${n}`).trim()]));
}

/**
 * Chart libraries draw with SVG attributes, which can't use CSS variables
 * reliably, so we resolve the theme tokens to real colors and re-read them
 * when the system switches between light and dark mode.
 */
export function useThemeColors() {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setColors(read());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return colors;
}
