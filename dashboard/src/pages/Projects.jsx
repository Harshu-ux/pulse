import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/auth.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../lib/api.js';
import { Logo, Chevron } from '../components/Icons.jsx';
import KeyReveal from '../components/KeyReveal.jsx';
import { timeAgo } from '../lib/format.js';

export default function Projects() {
  const { user, signOut } = useAuth();
  const { data, error } = useApi('/api/projects');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [created, setCreated] = useState(null);
  const projects = data?.projects;
  const showForm = params.get('new') === '1' || (projects && projects.length === 0);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const d = await api('/api/projects', { method: 'POST', body: { name } });
      setCreated(d);
    } catch (err) {
      setCreateError(err);
    }
    setCreating(false);
  };

  return (
    <div className="main" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page">
        <div className="page-head" style={{ alignItems: 'center' }}>
          <Link to="/projects" className="brand" style={{ padding: 0 }}><Logo />Pulse</Link>
          <span className="muted" style={{ fontSize: 14 }}>
            {user?.email} · <button type="button" className="linkish" onClick={signOut}>Sign out</button>
          </span>
        </div>

        {created ? (
          <section className="panel panel-body" style={{ paddingTop: 22, display: 'grid', gap: 16 }}>
            <h1>{created.project.name} is ready</h1>
            <p className="muted">Here's the API key your app will use to send data.</p>
            <KeyReveal apiKey={created.apiKey} />
            <div><button type="button" className="btn primary" onClick={() => navigate(`/p/${created.project.id}/setup`)}>Continue to setup</button></div>
          </section>
        ) : (
          <>
            <h1>Your projects</h1>
            {error && <p className="error-text" role="alert">{error.message}</p>}
            {projects && projects.length > 0 && (
              <section className="panel project-list">
                {projects.map((p) => (
                  <Link key={p.id} to={`/p/${p.id}`} className="project-row">
                    <span style={{ display: 'grid' }}>
                      <strong style={{ fontWeight: 600 }}>{p.name}</strong>
                      <span className="faint" style={{ fontSize: 13 }}>Created {timeAgo(p.createdAt)}</span>
                    </span>
                    <Chevron />
                  </Link>
                ))}
              </section>
            )}
            {!projects && !error && <div className="skeleton" style={{ height: 120 }} />}

            {showForm ? (
              <section className="panel panel-body" style={{ paddingTop: 18 }}>
                <form onSubmit={create} style={{ display: 'grid', gap: 12 }}>
                  <h2>{projects?.length ? 'New project' : 'Create your first project'}</h2>
                  <p className="muted">One project per app or website you want to watch.</p>
                  <div className="field">
                    <label htmlFor="project-name">Project name</label>
                    <input id="project-name" className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shop backend" />
                  </div>
                  {createError && <p className="error-text" role="alert">{createError.message}</p>}
                  <div><button className="btn primary" type="submit" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create project'}</button></div>
                </form>
              </section>
            ) : (
              projects && <div><Link className="btn" to="/projects?new=1">New project</Link></div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
