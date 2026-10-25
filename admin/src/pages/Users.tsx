import { useEffect, useState } from 'react';
import { BadgeCheck, ScanFace, Search } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, Empty, go, Loading, Pill, statusPill, useLoad } from '../components/ui';

export type UserRow = {
  id: string; name: string; email: string | null; accountStatus: string; role: string; createdAt: string;
  lastActiveAt: string | null; isVerified: boolean; realPersonVerifiedAt: string | null; college: string | null;
};

export function UsersPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 220); return () => clearTimeout(timer); }, [query]);
  const list = useLoad(() => api<UserRow[]>(`/admin/panel/users?q=${encodeURIComponent(debounced)}`), [debounced]);
  return <div className="page">
    <div className="page-head">
      <div><h2 className="page-title">Users</h2><div className="page-sub">{debounced ? `Matches for "${debounced}"` : 'Newest accounts first. Search by name, email, college email or ID.'}</div></div>
      <span className="spacer" />
      <div style={{ position: 'relative', width: 320 }}>
        <Search size={15} className="muted" style={{ position: 'absolute', left: 10, top: 10 }} />
        <input className="input" style={{ paddingLeft: 32 }} placeholder="Search people…" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      </div>
    </div>
    <div className="card">
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No one found" text="Try part of their name or email." /> : <table className="table">
        <thead><tr><th>Person</th><th>Status</th><th>Verified</th><th>College</th><th>Joined</th><th>Last active</th></tr></thead>
        <tbody>{list.data.map((user) => <tr key={user.id} className="clickable" onClick={() => go(`/users/${user.id}`)}>
          <td><div className="person"><Avatar name={user.name} /><div style={{ minWidth: 0 }}><div className="person-name">{user.name}{user.role !== 'user' ? <span className="pill accent" style={{ marginLeft: 8, textTransform: 'capitalize' }}>{user.role}</span> : null}</div><div className="person-sub">{user.email ?? 'No email'}</div></div></div></td>
          <td>{statusPill(user.accountStatus)}</td>
          <td><div className="row">
            {user.isVerified ? <Pill tone="info" icon={<BadgeCheck size={12} />}>College</Pill> : null}
            {user.realPersonVerifiedAt ? <Pill tone="ok" icon={<ScanFace size={12} />}>Selfie</Pill> : null}
            {!user.isVerified && !user.realPersonVerifiedAt ? <span className="muted">—</span> : null}
          </div></td>
          <td className="muted">{user.college ?? '—'}</td>
          <td className="muted">{ago(user.createdAt)}</td>
          <td className="muted">{ago(user.lastActiveAt)}</td>
        </tr>)}</tbody>
      </table>}
    </div>
  </div>;
}
