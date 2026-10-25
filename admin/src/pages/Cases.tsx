import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Flag } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, date, Empty, go, Loading, Pill, statusPill, useConfirm, useKeys, useLoad, useToast } from '../components/ui';
import type { Me } from '../App';

type Report = {
  id: string; reporterId: string; reporterName: string; reason: string | null; description: string | null;
  sourceType: string | null; status: string; createdAt: string;
  evidenceSnapshot: { content?: string; caption?: string; comment?: string; profile?: { name: string; bio: string | null; photos: string[] } } | null;
  reporterStats?: { made: number; dismissed: number };
};
type Case = {
  id: string; status: string; priority: string; createdAt: string; resolution: string | null; resolvedAt: string | null;
  subject: { id: string; name: string; email: string | null; accountStatus: string; college: string | null; photos: { photoUrl: string }[] } | null;
  reports: Report[];
  history?: { actioned: number; dismissed: number };
};

const underAge = (reason: string | null) => !!reason && /under\s*-?\s*18|underage|minor/i.test(reason);
/** The app's report reasons (apps/api/src/services/report-reasons.ts). Older apps sent free text. */
const REASON: Record<string, string> = {
  underage: 'Under 18', violence: 'Violence or offline harm', intimate_images: 'Intimate images without consent', self_harm: 'Self-harm',
  fake: 'Fake profile or not them', scam: 'Scam or selling', harassment: 'Harassment or threats', sexual: 'Sexual content',
  hate: 'Hate or discrimination', spam: 'Spam or bot', not_student: 'Not a student here', other: 'Something else',
};
const URGENT = new Set(['underage', 'violence', 'intimate_images', 'self_harm']);
export const reasonLabel = (reason: string | null) => (reason ? REASON[reason] ?? reason : 'Other');
const SOURCE: Record<string, string> = { profile: 'Profile', message: 'Message', story: 'Story', rose: 'Rose note' };

function priorityPill(item: Case) {
  if (item.reports.some((report) => underAge(report.reason))) return <Pill tone="danger" icon={<AlertTriangle size={12} />}>Under 18</Pill>;
  if (item.priority === 'urgent') return <Pill tone="danger">Urgent</Pill>;
  if (item.priority === 'high') return <Pill tone="warn">High</Pill>;
  return <Pill>Normal</Pill>;
}

export function Cases({ me, onChange }: { me: Me | null; onChange: () => void }) {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const list = useLoad(() => api<Case[]>(`/admin/panel/cases?status=${tab}`), [tab], 30_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const items = list.data ?? [];
  const current = items.find((item) => item.id === selected) ?? items[0] ?? null;
  useEffect(() => { if (current && current.id !== selected) setSelected(current.id); }, [current, selected]);
  const move = (step: number) => {
    const index = items.findIndex((item) => item.id === current?.id);
    const next = items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (next) setSelected(next.id);
  };
  const canBan = !!me?.permissions.includes('users.ban');

  const decide = async (kind: 'dismiss' | 'hide' | 'warn' | 'ban') => {
    if (!current || busy || tab !== 'open') return;
    const name = current.subject?.name ?? 'this person';
    const hidden = current.subject?.accountStatus === 'restricted';
    const answer = kind === 'dismiss'
      ? await ask({ title: 'Dismiss these reports?', text: hidden ? `Nothing wrong was found. ${name}'s profile is shown again and the reporters hear it was reviewed.` : `Nothing wrong was found. The reporters hear it was reviewed.`, confirm: hidden ? 'Dismiss and restore' : 'Dismiss', reason: { label: 'Note for the record' } })
      : kind === 'hide'
        ? await ask({ title: `Keep ${name} hidden?`, text: 'They are signed out and hidden from everyone until restored from their user page. The reporters hear action was taken.', confirm: 'Resolve and hide', reason: { label: 'Why, for the record', required: true } })
        : kind === 'warn'
          ? await ask({ title: `Warn ${name}?`, text: 'They get this message in the app and as a notification. The case closes.', confirm: 'Send warning', reason: { label: 'The warning they will read', required: true, placeholder: 'Your messages broke our community rules…' } })
          : await ask({ title: `Ban ${name}?`, text: 'Signed out for good. Their Google account, emails, college email and phone can never sign up again. This cannot be undone here.', confirm: 'Ban account', danger: true, reason: { label: 'Why, for the record', required: true } });
    if (!answer) return;
    setBusy(true);
    try {
      const note = answer.reason.trim() || undefined;
      if (kind === 'warn' && current.subject) {
        await api(`/admin/panel/users/${current.subject.id}/actions`, { method: 'POST', body: { action: 'warn', reason: note } });
      }
      await api(`/admin/panel/cases/${current.id}`, {
        method: 'PATCH',
        body: kind === 'dismiss' ? { status: 'dismissed', ...(hidden ? { accountAction: 'restore' } : {}), ...(note ? { resolution: note } : {}) }
          : kind === 'hide' ? { status: 'resolved', accountAction: 'restrict', resolution: note }
          : kind === 'warn' ? { status: 'resolved', resolution: `Warned: ${note}` }
          : { status: 'resolved', accountAction: 'ban', resolution: note },
      });
      toast(kind === 'dismiss' ? 'Dismissed' : kind === 'hide' ? 'Resolved, profile hidden' : kind === 'warn' ? 'Warning sent' : 'Account banned');
      move(1);
      await list.reload(true);
      onChange();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save', true);
    } finally { setBusy(false); }
  };

  useKeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), d: () => void decide('dismiss'), h: () => void decide('hide'), w: () => void decide('warn'), b: () => { if (canBan) void decide('ban'); } }, tab === 'open');

  return <div className={`split${current ? ' has-detail' : ''}`}>
    <div className="split-list">
      <div className="list-head">
        <div className="tabs"><button className="tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>Open</button><button className="tab" aria-selected={tab === 'closed'} onClick={() => setTab('closed')}>Closed</button></div>
        <span className="spacer" />{items.length}
      </div>
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title={tab === 'open' ? 'No open reports' : 'Nothing closed yet'} text={tab === 'open' ? 'New reports appear here, under-18 first.' : undefined} /> : items.map((item) =>
        <button key={item.id} className="list-item" aria-selected={item.id === current?.id} onClick={() => setSelected(item.id)}>
          <Avatar name={item.subject?.name} src={item.subject?.photos[0]?.photoUrl} />
          <div className="li-main">
            <div className="li-top"><span className="person-name">{item.subject?.name ?? 'Deleted account'}</span><span className="li-time">{ago(item.createdAt)}</span></div>
            <div className="row" style={{ marginTop: 4 }}>{priorityPill(item)}<span className="person-sub">{item.reports.length} {item.reports.length === 1 ? 'report' : 'reports'} · {[...new Set(item.reports.map((report) => reasonLabel(report.reason)))].slice(0, 2).join(', ')}</span></div>
          </div>
        </button>)}
    </div>
    <div className="split-detail">
      {current ? <CaseDetail item={current} open={tab === 'open'} busy={busy} canBan={canBan} decide={decide} /> : !list.loading ? <Empty title="Choose a case" /> : null}
    </div>
    {dialog}
  </div>;
}

function CaseDetail({ item, open, busy, canBan, decide }: { item: Case; open: boolean; busy: boolean; canBan: boolean; decide: (kind: 'dismiss' | 'hide' | 'warn' | 'ban') => void }) {
  const subject = item.subject;
  const young = item.reports.some((report) => underAge(report.reason));
  return <>
    <div className="detail">
      <div className="detail-head">
        <Avatar large name={subject?.name} src={subject?.photos[0]?.photoUrl} />
        <div>
          <h2 className="detail-title">{subject?.name ?? 'Deleted account'}</h2>
          <div className="row wrap" style={{ marginTop: 6 }}>{priorityPill(item)}{subject ? statusPill(subject.accountStatus) : null}<span className="muted" style={{ fontSize: 13 }}>{subject?.college ?? ''}</span></div>
        </div>
        <span className="spacer" />
        {subject ? <button className="btn" onClick={() => go(`/users/${subject.id}`)}><ExternalLink size={14} />Open user</button> : null}
      </div>
      {young && open ? <div className="report" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
        <div className="row"><AlertTriangle size={16} color="var(--danger)" /><strong>Possibly under 18.</strong></div>
        <div style={{ marginTop: 4, fontSize: 13 }}>The profile was hidden the moment this was reported. Check their photos and birthday. If they are an adult, dismiss to show the profile again. If a minor was harmed or sexual content of a minor is involved, follow the child safety process (docs/SAFETY_PROCESSES.md): keep the evidence and report to the police.</div>
      </div> : null}
      {!open && item.resolution ? <div className="report"><div className="muted" style={{ fontSize: 12 }}>Closed {date(item.resolvedAt)} · {item.status}</div><div style={{ marginTop: 4 }}>{item.resolution}</div></div> : null}
      {item.history && (item.history.actioned || item.history.dismissed) ? <div className="report" style={{ borderColor: item.history.actioned ? 'var(--warn)' : undefined }}>
        <strong>History:</strong> {item.history.actioned} earlier {item.history.actioned === 1 ? 'case' : 'cases'} acted on, {item.history.dismissed} dismissed.
        {item.history.actioned >= 2 ? <span className="muted"> A repeat offender - consider a suspension or ban.</span> : null}
      </div> : null}
      {!item.reports.length ? <div className="report" style={{ borderColor: 'var(--warn)' }}>
        <strong>Opened automatically:</strong> repeated explicit uploads (three refused in a week). See their refused uploads under Flagged media and the audit log.
      </div> : null}
      <div className="section-title">{item.reports.length} {item.reports.length === 1 ? 'report' : 'reports'}</div>
      {item.reports.map((report) => <div key={report.id} className="report">
        <div className="report-top">
          <Flag size={14} className="muted" />
          <strong>{reasonLabel(report.reason)}</strong>
          {report.reason && URGENT.has(report.reason) && report.reason !== 'underage' ? <Pill tone="danger">Urgent</Pill> : null}
          <Pill>{SOURCE[report.sourceType ?? 'profile'] ?? report.sourceType}</Pill>
          <span className="muted" style={{ fontSize: 12 }}>by {report.reporterName} · {ago(report.createdAt)}</span>
          {report.reporterStats && report.reporterStats.made >= 3 && report.reporterStats.dismissed / report.reporterStats.made >= 0.6
            ? <Pill tone="warn">{report.reporterStats.dismissed} of {report.reporterStats.made} of their reports dismissed</Pill> : null}
          {report.status !== 'pending' ? <Pill tone="info">{report.status}</Pill> : null}
        </div>
        {report.description ? <div style={{ marginTop: 6 }}>{report.description}</div> : null}
        {report.evidenceSnapshot?.content || report.evidenceSnapshot?.caption || report.evidenceSnapshot?.comment
          ? <div className="evidence">{report.evidenceSnapshot.content ?? report.evidenceSnapshot.caption ?? report.evidenceSnapshot.comment}</div> : null}
        {report.evidenceSnapshot?.profile ? <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>Their profile when reported</summary>
          {report.evidenceSnapshot.profile.bio ? <div className="evidence">{report.evidenceSnapshot.profile.bio}</div> : null}
          <div className="media-row" style={{ marginTop: 8 }}>{report.evidenceSnapshot.profile.photos.slice(0, 6).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="" style={{ width: 72, height: 96, objectFit: 'cover', borderRadius: 8 }} /></a>)}</div>
        </details> : null}
      </div>)}
    </div>
    {open ? <div className="actionbar">
      <button className="btn" disabled={busy} onClick={() => decide('dismiss')}>Dismiss <kbd>D</kbd></button>
      <button className="btn" disabled={busy} onClick={() => decide('warn')}>Warn <kbd>W</kbd></button>
      <button className="btn" disabled={busy} onClick={() => decide('hide')}>Resolve and hide <kbd>H</kbd></button>
      {canBan ? <button className="btn danger" disabled={busy} onClick={() => decide('ban')}>Ban <kbd>B</kbd></button> : null}
      <span className="hint"><kbd>J</kbd><kbd>K</kbd> next / previous</span>
    </div> : null}
  </>;
}
