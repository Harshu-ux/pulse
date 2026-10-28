import { useSearchParams } from 'react-router-dom';
import { RANGES } from '../lib/format.js';

/** Time range lives in the URL (?range=6h) so links and reloads keep it. */
export default function RangePicker() {
  const [params, setParams] = useSearchParams();
  const current = params.get('range') || '1h';
  return (
    <div className="segmented" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          aria-pressed={current === r.key}
          title={`Show ${r.words}`}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('range', r.key);
            setParams(next, { replace: true });
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
