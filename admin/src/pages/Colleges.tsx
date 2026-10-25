import { useState } from 'react';
import { api } from '../api';
import { ago, Empty, go, Loading, useLoad, useToast } from '../components/ui';

type Membership = { userId: string; institutionalEmail: string; verifiedAt: string; institution: { code: string; name: string }; user: { name: string } };
type Institution = { code: string; name: string; emailDomain: string | null; domainShared: boolean };

/**
 * Students whose college email domain is shared by more than one college
 * (uem.edu.in: Kolkata and Jaipur): confirm the one they chose, or move them.
 */
export function Colleges({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => api<Membership[]>('/admin/memberships/unconfirmed'), [], 30_000);
  const colleges = useLoad(() => api<Institution[]>('/verification/institutions'));
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const confirm = async (row: Membership) => {
    const target = moveTo[row.userId];
    setBusy(row.userId);
    try {
      await api(`/admin/memberships/${row.userId}/confirm`, { method: 'POST', body: target && target !== row.institution.code ? { institutionCode: target } : {} });
      toast(target && target !== row.institution.code ? 'Moved and confirmed' : 'Confirmed');
      await list.reload(true);
      onChange();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save', true); }
    finally { setBusy(null); }
  };
  const items = list.data ?? [];
  return <div className="page">
    <div className="page-head"><div>
      <h2 className="page-title">College confirmations</h2>
      <div className="page-sub">Some colleges share an email domain, so the email alone can't say which college a student is at. Confirm the one they chose, or move them.</div>
    </div></div>
    <div className="card">
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title="Nothing to confirm" /> : <table className="table">
        <thead><tr><th>Student</th><th>College email</th><th>Chose</th><th>Verified</th><th>Confirm as</th><th /></tr></thead>
        <tbody>{items.map((row) => {
          const domain = row.institutionalEmail.split('@')[1];
          const options = (colleges.data ?? []).filter((college) => college.emailDomain === domain);
          return <tr key={row.userId}>
            <td><a href={`#/users/${row.userId}`} onClick={(event) => { event.preventDefault(); go(`/users/${row.userId}`); }} style={{ fontWeight: 500, textDecoration: 'none' }}>{row.user.name}</a></td>
            <td className="mono">{row.institutionalEmail}</td>
            <td>{row.institution.name}</td>
            <td className="muted">{ago(row.verifiedAt)}</td>
            <td><select className="select" style={{ height: 32, minWidth: 220 }} value={moveTo[row.userId] ?? row.institution.code} onChange={(event) => setMoveTo((value) => ({ ...value, [row.userId]: event.target.value }))}>
              {(options.length ? options : [row.institution]).map((college) => <option key={college.code} value={college.code}>{college.name}</option>)}
            </select></td>
            <td className="right"><button className="btn primary sm" disabled={busy === row.userId} onClick={() => void confirm(row)}>Confirm</button></td>
          </tr>;
        })}</tbody>
      </table>}
    </div>
  </div>;
}
