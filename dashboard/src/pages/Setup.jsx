import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../components/Layout.jsx';
import KeyReveal from '../components/KeyReveal.jsx';
import { api } from '../lib/api.js';

export default function Setup() {
  const { project, projectId, reloadProjects, live } = useProject();
  const navigate = useNavigate();
  const [newKey, setNewKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endpoint = window.location.origin;
  const keyHint = newKey || `${project?.apiKeyPrefix || 'pk_'}…`;

  const rotate = async () => {
    if (!window.confirm('Create a new API key? The current key stops working within a minute, so update your app right after.')) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api(`/api/projects/${projectId}/rotate-key`, { method: 'POST' });
      setNewKey(d.apiKey);
      reloadProjects();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  const remove = async () => {
    const typed = window.prompt(`This permanently deletes "${project?.name}" and all of its data. Type the project name to confirm.`);
    if (typed !== project?.name) return;
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}`, { method: 'DELETE' });
      navigate('/projects');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1>Connect your app</h1>
        <p className="muted">Three steps to start sending data from an Express app to {project?.name}.</p>
      </div>

      <section className="panel panel-body" style={{ paddingTop: 22 }}>
        <ol className="steps">
          <li>
            <h2>Install the SDK</h2>
            <p className="muted">From the <code>sdk</code> folder of the Pulse repository (or from npm, if you publish it there).</p>
            <pre className="code mono">npm install path/to/pulse/sdk</pre>
          </li>
          <li>
            <h2>Add it to your app</h2>
            <p className="muted">Put the middleware before your routes and the error handler after them.</p>
            <pre className="code mono">{`const pulse = require('pulse-sdk').init({
  apiKey: process.env.PULSE_API_KEY, // ${keyHint}
  endpoint: '${endpoint}',
  service: 'my-api',
});

app.use(pulse.middleware());
// ...your routes...
app.use(pulse.errorHandler());`}</pre>
          </li>
          <li>
            <h2>Send some traffic</h2>
            <p className="muted">
              Open a few pages of your app. Data shows up within a few seconds.{' '}
              {live.connected && live.events.length > 0 ? <strong style={{ color: 'var(--good)' }}>Receiving data now.</strong> : 'Waiting for the first event…'}
            </p>
          </li>
        </ol>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>API key</h2></div>
        <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
          {newKey ? <KeyReveal apiKey={newKey} /> : (
            <p className="muted">The current key starts with <code>{project?.apiKeyPrefix}</code>. Lost it, or think it leaked? Create a new one.</p>
          )}
          <div><button type="button" className="btn" onClick={rotate} disabled={busy}>Create new key</button></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Delete project</h2></div>
        <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
          <p className="muted">Removes the project and every event stored for it. This can't be undone.</p>
          <div><button type="button" className="btn danger" onClick={remove} disabled={busy}>Delete project</button></div>
        </div>
      </section>
      {error && <p className="error-text" role="alert">{error.message}</p>}
    </div>
  );
}
