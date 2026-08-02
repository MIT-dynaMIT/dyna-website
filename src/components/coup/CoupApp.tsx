import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, clearAuth, getStoredUser, storeAuth } from './api';
import type { CoupUser } from './api';
import './coup.css';

import EditorPage from './pages/EditorPage';
import ScrimPage from './pages/ScrimPage';
import PlayPage from './pages/PlayPage';
import MatchesPage from './pages/MatchesPage';
import ReplayPage from './pages/ReplayPage';
import AdminPage from './pages/AdminPage';

// ------------------------------------------------------------ toast
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------ login
function LoginPage({ onLogin }: { onLogin: (u: CoupUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ token: string; user: CoupUser }>('/login', { username, password });
      storeAuth(r.token, r.user);
      onLogin(r.user);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="coup-login">
      <h1>🎭 dyna<span className="gold">COUP</span></h1>
      <div className="tag">Five lives. One rival. Call the coup.</div>
      <form onSubmit={submit}>
        <label htmlFor="cu">Username</label>
        <input id="cu" type="text" autoComplete="username" value={username}
          onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="cp">Password</label>
        <input id="cp" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <button className="primary" disabled={busy || !username || !password}>
          {busy ? 'Entering the court…' : 'Enter the court'}
        </button>
        <div className="coup-error">{err}</div>
      </form>
      <div className="coup-note">Logins are handed out by your mentors — no signups here.</div>
    </div>
  );
}

// ------------------------------------------------------------ shell
export default function CoupApp() {
  const [user, setUser] = useState<CoupUser | null>(getStoredUser());
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const location = useLocation();

  // the game world is dark — paint the page itself so overscroll never flashes white
  useEffect(() => {
    const prev = document.documentElement.style.background;
    document.documentElement.style.background = '#12161b';
    return () => { document.documentElement.style.background = prev; };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  const logout = () => { clearAuth(); setUser(null); };

  if (!user) {
    return (
      <div className="coup-root">
        <LoginPage onLogin={setUser} />
      </div>
    );
  }

  const tabs = [
    { name: 'Bot Editor', to: '/coup/editor' },
    { name: 'Scrimmage', to: '/coup/scrim' },
    { name: 'Play a Table', to: '/coup/play' },
    { name: 'Match History', to: '/coup/matches' },
    ...(user.isAdmin ? [{ name: 'Organizer', to: '/coup/admin' }] : []),
  ];

  return (
    <ToastCtx.Provider value={showToast}>
      <div className="coup-root">
        <div className="coup-shell">
          <header className="coup-top">
            <Link to="/coup" className="coup-logo">🎭 dyna<span className="gold">COUP</span></Link>
            <nav className="coup-nav">
              {tabs.map((t) => (
                <Link key={t.to} to={t.to}
                  className={location.pathname.startsWith(t.to) ? 'active' : ''}>
                  {t.name}
                </Link>
              ))}
            </nav>
            <div className="spacer" />
            <Link to="/" className="coup-sitelink">← dynaMIT</Link>
            <span className="coup-whoami">{user.displayName}</span>
            <button className="ghost small" onClick={logout}>Log out</button>
          </header>
          <Routes>
            <Route index element={<Navigate to="editor" replace />} />
            <Route path="editor" element={<EditorPage user={user} />} />
            <Route path="scrim" element={<ScrimPage user={user} />} />
            <Route path="play" element={<PlayPage user={user} />} />
            <Route path="matches" element={<MatchesPage />} />
            <Route path="matches/:id" element={<ReplayPage />} />
            <Route path="admin" element={user.isAdmin ? <AdminPage /> : <Navigate to="/coup" replace />} />
            <Route path="*" element={<Navigate to="editor" replace />} />
          </Routes>
        </div>
        <div className={`coup-toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </ToastCtx.Provider>
  );
}
