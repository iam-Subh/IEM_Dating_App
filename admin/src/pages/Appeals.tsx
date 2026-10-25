import { useEffect, useState } from 'react';
import { ExternalLink, Scale } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, date, Empty, go, Loading, Pill, statusPill, useConfirm, useKeys, useLoad, useToast } from '../components/ui';
import type { Me } from '../App';

type Appeal = {
  id: string; email: string; message: string; status: string; createdAt: string; decidedAt: string | null; note: string | null;
  user: { id: string; name: string; accountStatus: string; suspendedUntil: string | null; photos: { photoUrl: string }[] } | null;
  lastCase: { status: string; resolution: string | null; resolvedAt: string | null } | null;
};

/**
 * Appeals from people who can't sign in (the public /appeal page): restore
 * the account or uphold the decision. The person hears by email, with your
 * note. Lifting a ban is owner or admin only.
 */
export function Appeals({ me, onChange }: { me: Me | null; onChange: () => void }) {
  const [tab, setTab] = useState<'pending' | 'closed'>('pending');
  const list = useLoad(() => api<Appeal[]>(`/admin/panel/appeals?status=${tab}`), [tab], 30_000);
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
  const canLiftBan = me?.role === 'owner' || me?.role === 'admin';

  const decide = async (decision: 'restore' | 'uphold') => {
    if (!current || busy || tab !== 'pending') return;
    if (decision === 'restore' && current.user?.accountStatus === 'banned' && !canLiftBan) { toast('Only the owner or an admin can lift a ban', true); return; }
    const answer = decision === 'restore'
      ? await ask({ title: `Restore ${current.user?.name ?? 'this account'}?`, text: current.user?.accountStatus === 'banned' ? 'The ban is lifted, and their identities can sign up and verify again. They can sign in at once.' : 'Their account is active again and they can sign in at once.', confirm: 'Restore', reason: { label: 'What they will read', required: true, placeholder: 'We looked again and you didn’t break our rules. Sorry for the trouble.' } })
      : await ask({ title: 'Uphold the decision?', text: 'The account stays as it is. They hear that the decision stays and how to appeal further.', confirm: 'Uphold', danger: true, reason: { label: 'What they will read', required: true, placeholder: 'Your messages broke our rules on harassment.' } });
    if (!answer) return;
    setBusy(true);
    try {
      await api(`/admin/panel/appeals/${current.id}/decide`, { method: 'POST', body: { decision, note: answer.reason.trim() } });
      toast(decision === 'restore' ? 'Restored - they were emailed' : 'Upheld - they were emailed');
      move(1);
      await list.reload(true);
      onChange();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save', true); }
    finally { setBusy(false); }
  };
  useKeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), r: () => void decide('restore'), u: () => void decide('uphold') }, tab === 'pending');

  return <div className={`split${current ? ' has-detail' : ''}`}>
    <div className="split-list">
      <div className="list-head">
        <div className="tabs"><button className="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>Waiting</button><button className="tab" aria-selected={tab === 'closed'} onClick={() => setTab('closed')}>Decided</button></div>
        <span className="spacer" />{items.length}
      </div>
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title={tab === 'pending' ? 'No appeals waiting' : 'No decided appeals'} text={tab === 'pending' ? 'People who can’t sign in can appeal at /appeal.' : undefined} /> : items.map((item) =>
        <button key={item.id} className="list-item" aria-selected={item.id === current?.id} onClick={() => setSelected(item.id)}>
          <Avatar name={item.user?.name ?? item.email} src={item.user?.photos[0]?.photoUrl} />
          <div className="li-main">
            <div className="li-top"><span className="person-name">{item.user?.name ?? item.email}</span><span className="li-time">{ago(item.createdAt)}</span></div>
            <div className="row" style={{ marginTop: 4 }}>{item.user ? statusPill(item.user.accountStatus, item.user.suspendedUntil) : <Pill>No account</Pill>}<span className="person-sub">{item.message.slice(0, 60)}</span></div>
          </div>
        </button>)}
    </div>
    <div className="split-detail">
      {current ? <>
        <div className="detail">
          <div className="detail-head">
            <Avatar large name={current.user?.name ?? current.email} src={current.user?.photos[0]?.photoUrl} />
            <div>
              <h2 className="detail-title">{current.user?.name ?? 'No account uses this email'}</h2>
              <div className="row wrap" style={{ marginTop: 6 }}>{current.user ? statusPill(current.user.accountStatus, current.user.suspendedUntil) : null}<span className="muted mono">{current.email}</span></div>
            </div>
            <span className="spacer" />
            {current.user ? <button className="btn" onClick={() => go(`/users/${current.user!.id}`)}><ExternalLink size={14} />Open user</button> : null}
          </div>
          <div className="section-title">Their appeal · {ago(current.createdAt)}</div>
          <div className="report" style={{ whiteSpace: 'pre-wrap' }}>{current.message}</div>
          {current.lastCase ? <>
            <div className="section-title">The decision they're appealing</div>
            <div className="report"><div className="muted" style={{ fontSize: 12 }}>Case {current.lastCase.status}{current.lastCase.resolvedAt ? ` · ${date(current.lastCase.resolvedAt)}` : ''}</div><div style={{ marginTop: 4 }}>{current.lastCase.resolution ?? 'No note recorded - see the staff history on their user page.'}</div></div>
          </> : null}
          {tab === 'closed' ? <>
            <div className="section-title">Decision · {current.status}</div>
            <div className="report">{current.note}<div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{date(current.decidedAt)}</div></div>
          </> : null}
        </div>
        {tab === 'pending' ? <div className="actionbar">
          <button className="btn primary" disabled={busy || !current.user} onClick={() => void decide('restore')}><Scale size={14} />Restore <kbd>R</kbd></button>
          <button className="btn danger" disabled={busy} onClick={() => void decide('uphold')}>Uphold <kbd>U</kbd></button>
          <span className="hint"><kbd>J</kbd><kbd>K</kbd> next / previous · reply within 15 days</span>
        </div> : null}
      </> : !list.loading ? <Empty title="Choose an appeal" /> : null}
    </div>
    {dialog}
  </div>;
}
