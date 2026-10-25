import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  BadgeCheck, Bug, Cake, Flag, GraduationCap, Heart, ImageOff, Star, LayoutDashboard, LogOut, Moon, Scale, ScrollText, Search, ScanFace, Sun, Users,
} from 'lucide-react';
import { api, ApiError, hasSession, onSessionChange, signIn, signOut } from './api';
import { Avatar, go, Num, ToastHost, useLoad, useRoute } from './components/ui';
import { Dashboard, type DashboardData } from './pages/Dashboard';
import { Cases } from './pages/Cases';
import { SelfieReviews } from './pages/SelfieReviews';
import { FlaggedMedia } from './pages/FlaggedMedia';
import { BugReports } from './pages/BugReports';
import { RatingsPage } from './pages/Ratings';
import { Birthdays } from './pages/Birthdays';
import { Colleges } from './pages/Colleges';
import { UsersPage } from './pages/Users';
import { UserDetail } from './pages/UserDetail';
import { Audit } from './pages/Audit';
import { Appeals } from './pages/Appeals';

export type Me = { id: string; name: string; email: string; role: string; permissions: string[] };

const THEME_KEY = 'iem-admin-theme';
function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* fine */ }
  }, [theme]);
  return [theme, () => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))] as const;
}

export function App() {
  const signedIn = useSyncExternalStore(onSessionChange, hasSession);
  return <ToastHost>{signedIn ? <Shell /> : <Login />}</ToastHost>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await signIn(email, password); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 429 ? 'Too many tries. Wait a few minutes.' : cause instanceof Error ? cause.message : 'Could not sign in'); }
    finally { setBusy(false); }
  };
  return <div className="login">
    <form className="card login-card card-body" style={{ padding: 28 }} onSubmit={submit}>
      <div className="brand"><div className="brand-mark"><Heart size={15} fill="currentColor" /></div>
        <div><div className="brand-name">IEM Connect</div><div className="brand-sub">Admin panel</div></div></div>
      <h1 className="page-title" style={{ fontSize: 18 }}>Sign in</h1>
      <div className="page-sub">Use your app email and password. Only staff accounts get in.</div>
      <label className="label" htmlFor="email">Email</label>
      <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
      <label className="label" htmlFor="password">Password</label>
      <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {error ? <div className="error-text" role="alert">{error}</div> : null}
      <button className="btn primary" style={{ width: '100%', height: 38, marginTop: 18 }} disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>;
}

function Shell() {
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const me = useLoad(() => api<Me>('/admin/panel/me'));
  // The sidebar's counts and the dashboard share one read, every 15 seconds.
  const board = useLoad(() => api<DashboardData>('/admin/panel/dashboard'), [], 15_000);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName);
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing && !document.querySelector('.overlay'))) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (me.error) {
    return <div className="login"><div className="card card-body" style={{ maxWidth: 420, padding: 24 }}>
      <h1 className="page-title" style={{ fontSize: 18 }}>No access</h1>
      <p className="muted">{me.error.includes('Forbidden') ? 'This account is not a staff account. Sign in with a staff account, or ask the owner for a role.' : me.error}</p>
      <button className="btn" onClick={() => void signOut()}>Sign out</button>
    </div></div>;
  }

  const queues = board.data?.queues;
  const page = route.split('?')[0];
  const nav = [
    { group: 'Overview' },
    { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
    { group: 'Review queues' },
    { path: '/reports', label: 'Reports', icon: <Flag size={17} />, count: queues?.cases, urgent: (queues?.urgentCases ?? 0) > 0 },
    { path: '/reviews/selfie', label: 'Selfie checks', icon: <ScanFace size={17} />, count: queues?.faceReviews },
    { path: '/reviews/media', label: 'Flagged media', icon: <ImageOff size={17} />, count: queues?.flaggedMedia },
    { path: '/reviews/birthdays', label: 'Birthday changes', icon: <Cake size={17} />, count: queues?.birthdays },
    { path: '/reviews/colleges', label: 'College confirmations', icon: <GraduationCap size={17} />, count: queues?.memberships },
    { path: '/appeals', label: 'Appeals', icon: <Scale size={17} />, count: queues?.appeals },
    { group: 'App feedback' },
    { path: '/bugs', label: 'Bug reports', icon: <Bug size={17} />, count: queues?.bugReports },
    { path: '/ratings', label: 'Ratings', icon: <Star size={17} /> },
    { group: 'People' },
    { path: '/users', label: 'Users', icon: <Users size={17} /> },
    { group: 'System' },
    { path: '/audit', label: 'Audit log', icon: <ScrollText size={17} /> },
  ] as const;
  const title = nav.find((item) => 'path' in item && (item.path === '/' ? page === '/' : page.startsWith(item.path)));

  return <div className="shell">
    <aside className="sidebar" aria-label="Main">
      <div className="brand"><div className="brand-mark"><Heart size={15} fill="currentColor" /></div>
        <div className="brand-text"><div className="brand-name">IEM Connect</div><div className="brand-sub">Admin</div></div></div>
      {nav.map((item, index) => 'group' in item
        ? <div key={index} className="nav-group">{item.group}</div>
        : <a key={item.path} href={`#${item.path}`} className="nav-item" aria-current={title === item ? 'page' : undefined}>
          {item.icon}<span className="label-text">{item.label}</span>
          {'count' in item && item.count ? <span className={`nav-count${'urgent' in item && item.urgent ? ' urgent' : ''}`}><Num value={item.count} /></span> : null}
        </a>)}
      <div className="sidebar-foot">
        <button className="nav-item" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}<span className="label-text">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span></button>
        <button className="nav-item" onClick={() => void signOut()}><LogOut size={17} /><span className="label-text">Sign out</span></button>
        <div className="me"><Avatar name={me.data?.name} /><div className="me-text"><div className="me-name">{me.data?.name ?? '…'}</div><div className="me-role">{me.data?.role}</div></div></div>
      </div>
    </aside>
    <div className="main">
      <header className="topbar">
        <h1>{title && 'label' in title ? title.label : page.startsWith('/users/') ? 'User' : ''}</h1>
        {board.data ? <span className="live" title="Updates every 15 seconds"><span className="live-dot" /><Num value={board.data.live.online} />&nbsp;online now</span> : null}
        <button className="search-trigger" onClick={() => setPaletteOpen(true)}><Search size={15} /><span>Search people, jump to…</span><kbd>Ctrl K</kbd></button>
      </header>
      <main className="content">
        {page === '/' ? <Dashboard board={board} />
          : page === '/reports' ? <Cases me={me.data} onChange={() => void board.reload(true)} />
          : page === '/reviews/selfie' ? <SelfieReviews onChange={() => void board.reload(true)} />
          : page === '/reviews/media' ? <FlaggedMedia onChange={() => void board.reload(true)} />
          : page === '/reviews/birthdays' ? <Birthdays onChange={() => void board.reload(true)} />
          : page === '/reviews/colleges' ? <Colleges onChange={() => void board.reload(true)} />
          : page === '/bugs' ? <BugReports onChange={() => void board.reload(true)} />
          : page === '/ratings' ? <RatingsPage />
          : page === '/users' ? <UsersPage />
          : page.startsWith('/users/') ? <UserDetail id={page.slice('/users/'.length)} me={me.data} />
          : page === '/appeals' ? <Appeals me={me.data} onChange={() => void board.reload(true)} />
          : page === '/audit' ? <Audit />
          : <div className="page"><h1 className="page-title">Not found</h1></div>}
      </main>
    </div>
    {paletteOpen ? <Palette onClose={() => setPaletteOpen(false)} /> : null}
  </div>;
}

type Found = { id: string; name: string; email: string | null; accountStatus: string; college: string | null };

/** Ctrl K: people by name or email, and every page. */
function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Found[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (query.trim().length < 2) { setPeople([]); return; }
    const timer = setTimeout(() => { void api<Found[]>(`/admin/panel/users?q=${encodeURIComponent(query)}`).then(setPeople).catch(() => setPeople([])); }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  const pages = useMemo(() => [
    { label: 'Dashboard', path: '/' }, { label: 'Reports', path: '/reports' }, { label: 'Selfie checks', path: '/reviews/selfie' }, { label: 'Flagged media', path: '/reviews/media' },
    { label: 'Birthday changes', path: '/reviews/birthdays' }, { label: 'College confirmations', path: '/reviews/colleges' },
    { label: 'Bug reports', path: '/bugs' }, { label: 'Ratings', path: '/ratings' }, { label: 'Users', path: '/users' }, { label: 'Appeals', path: '/appeals' }, { label: 'Audit log', path: '/audit' },
  ].filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const items = [...people.map((person) => ({ key: person.id, path: `/users/${person.id}`, person })), ...pages.map((item) => ({ key: item.path, path: item.path, label: item.label }))];
  useEffect(() => { setIndex(0); }, [query, people.length]);
  const open = (path: string) => { go(path); onClose(); };
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="palette" role="dialog" aria-label="Search">
      <div className="palette-input"><Search size={17} className="muted" />
        <input ref={inputRef} value={query} placeholder="Search by name, email, college email or ID…" onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(items.length - 1, value + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
            if (event.key === 'Enter' && items[index]) open(items[index].path);
          }} />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list">
        {people.length ? <div className="palette-group">People</div> : null}
        {items.map((item, position) => <button key={item.key} className="palette-item" aria-selected={position === index} onMouseEnter={() => setIndex(position)} onClick={() => open(item.path)}>
          {'person' in item && item.person ? <>
            <Avatar name={item.person.name} />
            <div className="person" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}><div className="person-name">{item.person.name}</div><div className="person-sub">{item.person.email ?? 'No email'}{item.person.college ? ` · ${item.person.college}` : ''}</div></div>
            {item.person.accountStatus !== 'active' ? <span className="pill warn" style={{ marginLeft: 'auto' }}>{item.person.accountStatus}</span> : null}
          </> : <><BadgeCheck size={16} className="muted" />{'label' in item ? item.label : ''}</>}
        </button>)}
        {!items.length ? <div className="muted" style={{ padding: 14 }}>No matches.</div> : null}
      </div>
    </div>
  </div>;
}
