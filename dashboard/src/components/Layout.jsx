import { createContext, useContext } from 'react';
import { NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/auth.jsx';
import { useApi } from '../hooks/useApi.js';
import { useLive } from '../hooks/useLive.js';
import { ErrorsIcon, Logo, LogsIcon, OverviewIcon, SetupIcon } from './Icons.jsx';

const ProjectContext = createContext(null);
export const useProject = () => useContext(ProjectContext);

export default function Layout() {
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const projects = useApi('/api/projects');
  const live = useLive(projectId);
  const range = params.get('range') || '1h';
  const issues = useApi(`/api/projects/${projectId}/issues?range=${range}`, { refreshMs: 30_000 });

  const list = projects.data?.projects || [];
  const project = list.find((p) => p.id === projectId);
  const qs = params.toString() ? `?${params}` : '';
  const issueCount = issues.data?.issues.length || 0;

  if (projects.data && !project) {
    return (
      <div className="auth">
        <div className="empty">
          <h2>Project not found</h2>
          <p>It may have been deleted, or it belongs to another account.</p>
          <button className="btn" type="button" onClick={() => navigate('/projects')}>Go to your projects</button>
        </div>
      </div>
    );
  }

  return (
    <ProjectContext.Provider value={{ project, projectId, live, range, reloadProjects: projects.reload }}>
      <div className="shell">
        <aside className="sidebar">
          <NavLink to="/projects" className="brand"><Logo />Pulse</NavLink>

          <div className="project-switch">
            <label htmlFor="project-select" className="faint" style={{ fontSize: 12, padding: '0 2px' }}>Project</label>
            <select
              id="project-select"
              className="select"
              value={projectId}
              onChange={(e) => (e.target.value === '__new' ? navigate('/projects?new=1') : navigate(`/p/${e.target.value}${qs}`))}
            >
              {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__new">New project…</option>
            </select>
          </div>

          <nav className="nav" aria-label="Project">
            <NavLink end to={`/p/${projectId}${qs}`}><OverviewIcon />Overview</NavLink>
            <NavLink to={`/p/${projectId}/errors${qs}`}>
              <ErrorsIcon />Errors
              {issueCount > 0 && <span className="count" aria-label={`${issueCount} issues`}>{issueCount}</span>}
            </NavLink>
            <NavLink to={`/p/${projectId}/logs${qs}`}><LogsIcon />Logs</NavLink>
            <NavLink to={`/p/${projectId}/setup`}><SetupIcon />Setup</NavLink>
          </nav>

          <div className="sidebar-foot">
            <span className="faint" title={user?.email}>{user?.name}</span>
            <button type="button" className="linkish" onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </ProjectContext.Provider>
  );
}
