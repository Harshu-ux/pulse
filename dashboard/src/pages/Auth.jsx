import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/auth.jsx';
import { Logo } from '../components/Icons.jsx';

export function Login() {
  return <AuthForm mode="login" />;
}
export function Register() {
  return <AuthForm mode="register" />;
}

function AuthForm({ mode }) {
  const { signIn, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isLogin) await signIn(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate(location.state?.from || '/projects', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <span className="brand"><Logo size={30} />Pulse</span>
        <div style={{ display: 'grid', gap: 6 }}>
          <h1>{isLogin ? 'Sign in' : 'Create your account'}</h1>
          <p className="muted">{isLogin ? 'See how your apps are doing right now.' : 'Start watching your apps in a couple of minutes.'}</p>
        </div>
        {isLogin && (
          <p className="demo-hint">Trying the demo? Sign in with <b>demo@pulse.dev</b> and password <b>demo-password</b>.</p>
        )}
        <form onSubmit={submit} noValidate={false}>
          {!isLogin && (
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" className="input" autoComplete="name" required value={form.name} onChange={update('name')} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={form.email} onChange={update('email')} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password" className="input" type="password" required
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              minLength={isLogin ? undefined : 8}
              value={form.password} onChange={update('password')}
              aria-describedby={isLogin ? undefined : 'pw-hint'}
            />
            {!isLogin && <span id="pw-hint" className="faint" style={{ fontSize: 13 }}>At least 8 characters.</span>}
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center', height: 40 }}>
            {busy ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="muted" style={{ fontSize: 14 }}>
          {isLogin ? <>New to Pulse? <Link to="/register">Create an account</Link></> : <>Already have an account? <Link to="/login">Sign in</Link></>}
        </p>
      </div>
    </div>
  );
}
