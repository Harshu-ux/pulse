import { useThemeColors } from '../hooks/useThemeColors.js';
import { count } from '../lib/format.js';

const W = 600;
const H = 44;

/**
 * The last 60 seconds of traffic as it arrives over the WebSocket: one bar per
 * second, with a red cap on seconds that had failed requests.
 */
export default function PulseStrip({ live }) {
  const c = useThemeColors();
  const { seconds, connected } = live;
  const max = Math.max(1, ...seconds.map((s) => s.requests));
  const recent = seconds.slice(-10);
  const perSec = recent.reduce((s, b) => s + b.requests, 0) / recent.length;
  const failing = seconds.slice(-30).reduce((s, b) => s + b.serverErrors, 0);
  const slot = W / seconds.length;

  return (
    <div className="panel pulse">
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Requests per second over the last minute, currently about ${Math.round(perSec)} per second`}>
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke={c.line} />
          {seconds.map((s, i) => {
            const h = s.requests ? Math.max(2, (s.requests / max) * (H - 6)) : 0;
            const errH = s.serverErrors ? Math.max(3, (s.serverErrors / max) * (H - 6)) : 0;
            return (
              <g key={s.t}>
                {h > 0 && <rect x={i * slot + 1} y={H - h} width={slot - 2} height={h} rx="1.5" fill={c['series-traffic']} />}
                {errH > 0 && <rect x={i * slot + 1} y={H - h} width={slot - 2} height={Math.min(errH, h)} rx="1.5" fill={c['critical-mark']} />}
              </g>
            );
          })}
        </svg>
        <div className="faint" style={{ fontSize: 12, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span>60 seconds ago</span>
          <span>now</span>
        </div>
      </div>
      <div className="pulse-readout" aria-live="polite">
        <strong className="num">{count(perSec)}<span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> req/s</span></strong>
        <span><i className={`live-dot${connected ? ' on' : ''}`} />{connected ? (failing ? `${failing} failed in the last 30 s` : 'Live') : 'Reconnecting…'}</span>
      </div>
    </div>
  );
}
