import { api } from '../api';
import { date, Empty, go, Loading, Pill, useLoad } from '../components/ui';

type Entry = { id: string; adminName: string; action: string; targetType: string | null; targetId: string | null; statusCode: number | null; createdAt: string; details: { body?: Record<string, unknown>; path?: string } };

const LABEL: Record<string, string> = {
  'user.warn': 'Warned a user', 'user.logout_all': 'Signed a user out everywhere', 'user.restrict': 'Hid a user', 'user.restore': 'Restored a user',
  'user.suspend': 'Suspended a user', 'user.unsuspend': 'Lifted a suspension', 'user.ban': 'Banned a user', 'user.remove_photo': 'Removed a photo',
  'user.reset_selfie': 'Reset a selfie check', 'user.set_role': 'Changed a role', 'case.update': 'Updated a report case',
};
const pretty = (entry: Entry) => LABEL[entry.action]
  ?? (entry.action.includes('face-reviews') ? 'Decided a selfie check' : entry.action.includes('birthday') ? 'Decided a birthday change'
    : entry.action.includes('memberships') ? 'Confirmed a college' : entry.action.includes('team-updates') ? 'Sent a team update'
    : entry.action.includes('algorithm') ? 'Changed the algorithm' : entry.action);

/** Every change made by staff, newest first (ADMIN_PANEL_PLAN.md 1). */
export function Audit() {
  const list = useLoad(() => api<Entry[]>('/admin/panel/audit?limit=200'), [], 30_000);
  return <div className="page">
    <div className="page-head"><div>
      <h2 className="page-title">Audit log</h2>
      <div className="page-sub">Every change made in this panel: who, what, on whom, and when. It can't be edited.</div>
    </div></div>
    <div className="card">
      {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty title="No actions yet" /> : <table className="table">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th className="right">Result</th></tr></thead>
        <tbody>{list.data.map((entry) => {
          const body = entry.details.body ?? {};
          const detail = [body.decision, body.reason, body.note, body.resolution, body.days ? `${body.days} days` : null, body.role].filter(Boolean).join(' · ');
          return <tr key={entry.id}>
            <td className="muted" style={{ whiteSpace: 'nowrap' }}>{date(entry.createdAt)}</td>
            <td>{entry.adminName}</td>
            <td>{pretty(entry)}{entry.targetType === 'user' && entry.targetId ? <> · <a href={`#/users/${entry.targetId}`} onClick={(event) => { event.preventDefault(); go(`/users/${entry.targetId}`); }}>open</a></> : null}</td>
            <td className="muted" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(detail)}</td>
            <td className="right">{entry.statusCode && entry.statusCode >= 400 ? <Pill tone="danger">Refused {entry.statusCode}</Pill> : <Pill tone="ok">Done</Pill>}</td>
          </tr>;
        })}</tbody>
      </table>}
    </div>
  </div>;
}
