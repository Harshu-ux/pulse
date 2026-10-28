import { useState } from 'react';
import { CopyIcon } from './Icons.jsx';

/** Shows a freshly created API key once, with a copy button. */
export default function KeyReveal({ apiKey }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the key is still selectable */
    }
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="keybox">
        <code>{apiKey}</code>
        <button type="button" className="btn small" onClick={copy}><CopyIcon />{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="callout">Save this key now. For security, Pulse only stores a fingerprint of it, so it can't be shown again. If you lose it, create a new one on the setup page.</p>
    </div>
  );
}
