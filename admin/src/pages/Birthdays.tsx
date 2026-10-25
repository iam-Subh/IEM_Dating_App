import { useEffect, useState } from 'react';
import { Cake, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, Empty, go, Loading, Pill, useConfirm, useKeys, useLoad, useToast } from '../components/ui';

type Request = { id: string; user: { id: string; name: string; birthday: string | null } | null; newBirthday: string; createdAt: string; idPhotoUrl: string | null };

const age = (iso: string | null) => {
  if (!iso) return null;
  const born = new Date(iso);
  const now = new Date();
  return now.getFullYear() - born.getFullYear() - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Not set');

export function Birthdays({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => api<Request[]>('/admin/birthday-requests'), [], 30_000);
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
  const decide = async (approve: boolean) => {
    if (!current || busy) return;
    const newAge = age(current.newBirthday);
    const answer = approve
      ? await ask({ title: 'Change the birthday?', text: `Their profile will show ${day(current.newBirthday)}${newAge !== null ? ` (age ${newAge})` : ''}. The ID photo is deleted.`, confirm: 'Approve', reason: { label: 'Note' } })
      : await ask({ title: 'Refuse this change?', text: 'Their birthday stays as it is. They will read your note.', confirm: 'Refuse', danger: true, reason: { label: 'What they will read', required: true, placeholder: 'The date on your ID was not readable.' } });
    if (!answer) return;
    setBusy(true);
    try {
      await api(`/admin/birthday-requests/${current.id}/decide`, { method: 'POST', body: { approve, ...(answer.reason.trim() ? { note: answer.reason.trim() } : {}) } });
      toast(approve ? 'Birthday changed' : 'Refused');
      move(1);
      await list.reload(true);
      onChange();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save', true); }
    finally { setBusy(false); }
  };
  useKeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), a: () => void decide(true), r: () => void decide(false) });

  return <div className={`split${current ? ' has-detail' : ''}`}>
    <div className="split-list">
      <div className="list-head"><Cake size={14} />Waiting, oldest first<span className="spacer" />{items.length}</div>
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title="No birthday changes waiting" /> : items.map((item) =>
        <button key={item.id} className="list-item" aria-selected={item.id === current?.id} onClick={() => setSelected(item.id)}>
          <Avatar name={item.user?.name} />
          <div className="li-main">
            <div className="li-top"><span className="person-name">{item.user?.name ?? 'Deleted account'}</span><span className="li-time">{ago(item.createdAt)}</span></div>
            <div className="person-sub" style={{ marginTop: 4 }}>{day(item.user?.birthday ?? null)} → {day(item.newBirthday)}</div>
          </div>
        </button>)}
    </div>
    <div className="split-detail">
      {current ? <>
        <div className="detail">
          <div className="detail-head">
            <Avatar large name={current.user?.name} />
            <div><h2 className="detail-title">{current.user?.name ?? 'Deleted account'}</h2><div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Asked {ago(current.createdAt)}</div></div>
            <span className="spacer" />
            {current.user ? <button className="btn" onClick={() => go(`/users/${current.user!.id}`)}><ExternalLink size={14} />Open user</button> : null}
          </div>
          <dl className="kv">
            <dt>Now</dt><dd>{day(current.user?.birthday ?? null)} {age(current.user?.birthday ?? null) !== null ? <span className="muted">· age {age(current.user?.birthday ?? null)}</span> : null}</dd>
            <dt>Asked for</dt><dd><strong>{day(current.newBirthday)}</strong> {(() => { const value = age(current.newBirthday); return value === null ? null : value < 18 ? <Pill tone="danger">Under 18</Pill> : <span className="muted">· age {value}</span>; })()}</dd>
          </dl>
          <div className="section-title">ID photo</div>
          {current.idPhotoUrl ? <a href={current.idPhotoUrl} target="_blank" rel="noreferrer"><img src={current.idPhotoUrl} alt="ID" style={{ maxWidth: '100%', maxHeight: 460, borderRadius: 10, border: '1px solid var(--line)' }} /></a>
            : <p className="muted">No ID photo was sent.</p>}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Check the name and date of birth match. The photo link works for 5 minutes; reload to see it again.</p>
        </div>
        <div className="actionbar">
          <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>Approve <kbd>A</kbd></button>
          <button className="btn danger" disabled={busy} onClick={() => void decide(false)}>Refuse <kbd>R</kbd></button>
          <span className="hint"><kbd>J</kbd><kbd>K</kbd> next / previous</span>
        </div>
      </> : !list.loading ? <Empty title="Choose a request" /> : null}
    </div>
    {dialog}
  </div>;
}
