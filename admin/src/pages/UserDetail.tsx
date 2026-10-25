import { Fragment, useState } from 'react';
import { ArrowLeft, BadgeCheck, Ban, EyeOff, LogOut, MessageSquareWarning, RotateCcw, ScanFace, ShieldCheck, Timer, Trash2, UserCog } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, date, go, Loading, Pill, statusPill, useConfirm, useLoad, useToast } from '../components/ui';
import type { Me } from '../App';
import { reasonLabel } from './Cases';

type Detail = {
  id: string; name: string; email: string | null; googleEmail: string | null; accountStatus: string; role: string;
  createdAt: string; lastActiveAt: string | null; isVerified: boolean; realPersonVerifiedAt: string | null; college: string | null;
  gender: string | null; birthday: string | null; age: number | null; department: string | null; graduationYear: number | null;
  pausedAt: string | null; suspendedUntil: string | null; bio: string | null; videoPlaybackUrl: string | null; profileVideoUrl: string | null;
  photos: { id: string; photoUrl: string }[];
  studentMembership: { institutionalEmail: string; status: string; verifiedAt: string | null; expiresAt: string | null; campusConfirmed: boolean; institution: { name: string } } | null;
  face: { status: string; reason: string | null; verifiedAt: string | null; items: { url: string; kind: string; main: boolean; status: string; distance: number | null }[] } | null;
  devices: { platform: string; createdAt: string }[];
  sessions: { createdAt: string; lastUsedAt: string | null; deviceInfo: Record<string, string> | null }[];
  counts: { matches: number; reportsAgainst: number; reportsBy: number };
  reports: { id: string; reason: string | null; description: string | null; sourceType: string | null; status: string; createdAt: string; reporterName: string }[];
  cases: { id: string; status: string; priority: string; createdAt: string; resolution: string | null }[];
  audit: { id: string; action: string; adminName: string; createdAt: string; statusCode: number | null; details: { body?: { reason?: string } } }[];
};

const FACE: Record<string, [string, 'ok' | 'warn' | 'danger' | undefined]> = {
  verified: ['Verified', 'ok'], pending_review: ['In review', 'warn'], needs_fix: ['Needs fixing', 'danger'],
  failed: ['Failed', 'danger'], removed: ['Removed', undefined], none: ['Not done', undefined],
};
const ACTION_LABEL: Record<string, string> = {
  'user.warn': 'Warned', 'user.logout_all': 'Signed out everywhere', 'user.restrict': 'Hidden', 'user.restore': 'Restored',
  'user.suspend': 'Suspended', 'user.unsuspend': 'Suspension lifted', 'user.ban': 'Banned', 'user.remove_photo': 'Photo removed',
  'user.reset_selfie': 'Selfie check reset', 'user.set_role': 'Role changed', 'case.update': 'Report case updated',
};

export function UserDetail({ id, me }: { id: string; me: Me | null }) {
  const detail = useLoad(() => api<Detail>(`/admin/panel/users/${id}`), [id]);
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const allowed = (permission: string) => !!me?.permissions.includes(permission);
  const user = detail.data;

  const act = async (action: string, options: Parameters<typeof ask>[0], extra: Record<string, unknown> = {}) => {
    const answer = await ask(options);
    if (!answer) return;
    setBusy(true);
    try {
      await api(`/admin/panel/users/${id}/actions`, { method: 'POST', body: { action, ...extra, ...(answer.reason.trim() ? { reason: answer.reason.trim() } : {}), ...(options.days ? { days: answer.days } : {}) } });
      toast(ACTION_LABEL[`user.${action}`] ?? 'Done');
      await detail.reload(true);
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save', true); }
    finally { setBusy(false); }
  };

  if (!user) return <div className="page">{detail.error ? <p className="error-text">{detail.error}</p> : <Loading rows={8} />}</div>;
  const self = me?.id === user.id;
  const owner = user.role === 'owner';
  const hidden = user.accountStatus === 'restricted';
  const suspended = user.accountStatus === 'suspended';
  const banned = user.accountStatus === 'banned';
  const face = FACE[user.face?.status ?? 'none'] ?? [user.face?.status ?? '—', undefined];
  const membership = user.studentMembership;
  const video = user.videoPlaybackUrl ?? user.profileVideoUrl;

  return <div className="page">
    <button className="btn ghost sm" onClick={() => (history.length > 1 ? history.back() : go('/users'))} style={{ marginBottom: 12 }}><ArrowLeft size={14} />Back</button>
    <div className="detail-head" style={{ alignItems: 'flex-start' }}>
      <Avatar large name={user.name} src={user.photos[0]?.photoUrl} />
      <div style={{ minWidth: 0 }}>
        <h2 className="detail-title" style={{ fontSize: 20 }}>{user.name}{user.age ? <span className="muted" style={{ fontWeight: 400 }}>, {user.age}</span> : null}</h2>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {statusPill(user.accountStatus, user.suspendedUntil)}
          {user.role !== 'user' ? <Pill tone="accent">{user.role}</Pill> : null}
          {user.isVerified ? <Pill tone="info" icon={<BadgeCheck size={12} />}>College verified</Pill> : <Pill>College not verified</Pill>}
          <Pill tone={face[1]} icon={<ScanFace size={12} />}>Selfie: {face[0]}</Pill>
          {user.pausedAt ? <Pill tone="warn">Paused</Pill> : null}
        </div>
        <div className="muted mono" style={{ marginTop: 8 }}>{user.id}</div>
      </div>
    </div>

    {!self && !owner ? <div className="row wrap" style={{ margin: '4px 0 22px' }}>
      {allowed('users.support') ? <>
        <button className="btn" disabled={busy} onClick={() => void act('warn', { title: `Warn ${user.name}?`, text: 'They get this message in the app and as a notification.', confirm: 'Send warning', reason: { label: 'The warning they will read', required: true } })}><MessageSquareWarning size={14} />Warn</button>
        <button className="btn" disabled={busy} onClick={() => void act('logout_all', { title: 'Sign out everywhere?', text: 'Every phone and browser is signed out. They can sign in again.', confirm: 'Sign out everywhere' })}><LogOut size={14} />Sign out everywhere</button>
      </> : null}
      {allowed('users.act') && !banned ? <>
        {hidden || suspended
          ? <button className="btn" disabled={busy} onClick={() => void act(suspended ? 'unsuspend' : 'restore', { title: `Restore ${user.name}?`, text: 'Their profile is shown again and they can sign in.', confirm: 'Restore', reason: { label: 'Note for the record' } })}><RotateCcw size={14} />Restore</button>
          : <>
            <button className="btn" disabled={busy} onClick={() => void act('restrict', { title: `Hide ${user.name}?`, text: 'Signed out and hidden from everyone until you restore them.', confirm: 'Hide', reason: { label: 'Why, for the record', required: true } })}><EyeOff size={14} />Hide</button>
            <button className="btn" disabled={busy} onClick={() => void act('suspend', { title: `Suspend ${user.name}?`, text: 'Signed out and hidden. It ends on its own: they can sign in again after the days you choose.', confirm: 'Suspend', days: true, reason: { label: 'Why, for the record', required: true } })}><Timer size={14} />Suspend</button>
          </>}
        <button className="btn" disabled={busy || !user.face || user.face.status === 'none'} onClick={() => void act('reset_selfie', { title: 'Reset the selfie check?', text: 'Their face key and results are deleted. They take the check again; the blue badge goes until they do.', confirm: 'Reset' })}><ScanFace size={14} />Reset selfie</button>
      </> : null}
      {allowed('users.ban') && !banned ? <button className="btn danger" disabled={busy} onClick={() => void act('ban', { title: `Ban ${user.name}?`, text: 'Signed out for good. Their Google account, emails, college email and phone can never sign up again.', confirm: 'Ban account', danger: true, reason: { label: 'Why, for the record', required: true } })}><Ban size={14} />Ban</button> : null}
      {allowed('roles') ? <RoleButton current={user.role} busy={busy} onPick={(role) => void act('set_role', { title: `Make ${user.name} ${role === 'user' ? 'a normal user' : `a ${role}`}?`, text: role === 'user' ? 'They lose access to this panel at once.' : `They can sign in to this panel as ${role} at once. Their app is not affected.`, confirm: 'Change role' }, { role })} /> : null}
    </div> : <p className="muted" style={{ margin: '4px 0 22px' }}>{self ? 'This is your account.' : 'The owner account is protected.'}</p>}

    <div className="grid two">
      <div className="card">
        <div className="card-head">Profile</div>
        <div className="card-body">
          <div className="media-row">
            {user.photos.map((photo, index) => {
              const check = user.face?.items.find((item) => item.url === photo.photoUrl);
              return <div key={photo.id} className={`media${check && (check.status === 'mismatch' || check.status === 'no_face') ? ' flag' : check?.status === 'unsure' ? ' warn' : ''}`} style={{ width: 120 }}>
                <a href={photo.photoUrl} target="_blank" rel="noreferrer"><img src={photo.photoUrl} alt={`Photo ${index + 1}`} style={{ width: 120, height: 160 }} /></a>
                <div className="media-cap">{index === 0 ? 'Main' : `#${index + 1}`}{check?.distance != null ? <span className="muted mono">{check.distance.toFixed(3)}</span> : null}</div>
                {allowed('users.act') && !owner ? <button className="btn sm media-x" title="Remove photo" disabled={busy} onClick={() => void act('remove_photo', { title: 'Remove this photo?', text: 'It is deleted from their profile. They are told why.', confirm: 'Remove', danger: true, reason: { label: 'What they will read', placeholder: 'This photo breaks our photo rules.' } }, { photoId: photo.id })}><Trash2 size={13} /></button> : null}
              </div>;
            })}
            {video ? <div className="media" style={{ width: 120 }}><video src={video} controls muted style={{ width: 120, height: 160 }} /><div className="media-cap">Video</div></div> : null}
            {!user.photos.length && !video ? <span className="muted">No photos.</span> : null}
          </div>
          {user.bio ? <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{user.bio}</p> : null}
        </div>
      </div>
      <div className="card">
        <div className="card-head">Account</div>
        <div className="card-body">
          <dl className="kv">
            <dt>Email</dt><dd>{user.email ?? '—'}</dd>
            {user.googleEmail ? <><dt>Google</dt><dd>{user.googleEmail}</dd></> : null}
            <dt>Birthday</dt><dd>{user.birthday ? new Date(user.birthday).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—'}</dd>
            <dt>Gender</dt><dd>{user.gender ?? '—'}</dd>
            <dt>College</dt><dd>{membership?.institution.name ?? user.college ?? '—'}{user.department ? ` · ${user.department}` : ''}{user.graduationYear ? ` · ${user.graduationYear}` : ''}</dd>
            <dt>College email</dt><dd>{membership ? <>{membership.institutionalEmail} <span className="muted">· {membership.verifiedAt ? `verified ${ago(membership.verifiedAt)}` : membership.status}{membership.expiresAt ? `, ends ${new Date(membership.expiresAt).toLocaleDateString()}` : ''}</span></> : '—'}</dd>
            <dt>Joined</dt><dd>{date(user.createdAt)}</dd>
            <dt>Last active</dt><dd>{ago(user.lastActiveAt)}</dd>
            <dt>Matches</dt><dd>{user.counts.matches}</dd>
            <dt>Reports</dt><dd>{user.counts.reportsAgainst} against · {user.counts.reportsBy} made</dd>
          </dl>
        </div>
      </div>
    </div>

    <div className="grid two" style={{ marginTop: 12 }}>
      <div className="card">
        <div className="card-head">Reports against them<span className="sub">· {user.reports.length}</span></div>
        <div className="card-body">
          {user.reports.length ? user.reports.map((report) => <div key={report.id} className="report">
            <div className="report-top"><strong>{reasonLabel(report.reason)}</strong><Pill>{report.sourceType ?? 'profile'}</Pill><span className="muted" style={{ fontSize: 12 }}>by {report.reporterName} · {ago(report.createdAt)}</span>{report.status !== 'pending' ? <Pill tone="info">{report.status}</Pill> : null}</div>
            {report.description ? <div style={{ marginTop: 6, fontSize: 13 }}>{report.description}</div> : null}
          </div>) : <span className="muted">No reports.</span>}
        </div>
      </div>
      <div className="card">
        <div className="card-head">Phones and sessions</div>
        <div className="card-body">
          <dl className="kv">
            {user.devices.map((device, index) => <Fragment key={index}><dt>{device.platform === 'ios' ? 'iPhone' : device.platform === 'android' ? 'Android' : device.platform}</dt><dd>since {date(device.createdAt)}</dd></Fragment>)}
            {!user.devices.length ? <><dt>Phones</dt><dd className="muted">None registered</dd></> : null}
          </dl>
          <div className="section-title" style={{ marginTop: 16 }}>Signed in ({user.sessions.length})</div>
          {user.sessions.map((session, index) => <div key={index} className="row" style={{ fontSize: 13, padding: '4px 0' }}>
            <ShieldCheck size={14} className="muted" />{session.deviceInfo?.deviceName ?? session.deviceInfo?.model ?? session.deviceInfo?.platform ?? 'Unknown device'}<span className="spacer" /><span className="muted">{ago(session.lastUsedAt ?? session.createdAt)}</span>
          </div>)}
          {!user.sessions.length ? <span className="muted">Not signed in anywhere.</span> : null}
        </div>
      </div>
    </div>

    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head">Staff history<span className="sub">· every action on this account</span></div>
      {user.audit.length ? <table className="table"><tbody>{user.audit.map((entry) => <tr key={entry.id}>
        <td style={{ width: 200 }}>{ACTION_LABEL[entry.action] ?? entry.action}{entry.statusCode && entry.statusCode >= 400 ? <span className="pill danger" style={{ marginLeft: 6 }}>failed</span> : null}</td>
        <td className="muted">{entry.details.body?.reason ?? ''}</td>
        <td className="muted">{entry.adminName}</td>
        <td className="muted right">{date(entry.createdAt)}</td>
      </tr>)}</tbody></table> : <div className="card-body muted">No staff actions yet.</div>}
    </div>
    {dialog}
  </div>;
}

function RoleButton({ current, busy, onPick }: { current: string; busy: boolean; onPick: (role: string) => void }) {
  const [open, setOpen] = useState(false);
  return <div style={{ position: 'relative' }}>
    <button className="btn" disabled={busy} onClick={() => setOpen((value) => !value)}><UserCog size={14} />Role: {current}</button>
    {open ? <div className="card" style={{ position: 'absolute', top: 36, left: 0, zIndex: 5, padding: 4, minWidth: 220, boxShadow: 'var(--shadow)' }}>
      {[['user', 'User', 'No panel access'], ['support', 'Support', 'Look people up, sign out, warn'], ['moderator', 'Moderator', 'Reviews, reports, hide, suspend, ban'], ['admin', 'Admin', 'Everything except roles']].map(([role, label, text]) =>
        <button key={role} className="palette-item" aria-selected={role === current} onClick={() => { setOpen(false); if (role !== current) onPick(role); }}>
          <div><div style={{ fontWeight: 500 }}>{label}</div><div className="muted" style={{ fontSize: 12 }}>{text}</div></div>
        </button>)}
    </div> : null}
  </div>;
}
