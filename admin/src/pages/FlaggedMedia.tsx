import { useEffect, useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, Empty, go, Loading, Pill, useConfirm, useKeys, useLoad, useToast } from '../components/ui';

type Flagged = {
  id: string; userId: string; kind: 'profile_photo' | 'profile_video' | 'story'; score: number | null;
  status: string; createdAt: string; note: string | null; viewUrl: string | null; video: boolean; refusedBefore: number;
  user: { id: string; name: string; accountStatus: string } | null;
};

const KIND: Record<Flagged['kind'], string> = { profile_photo: 'Profile photo', profile_video: 'Profile video', story: 'Story' };

/**
 * Borderline uploads the nudity check held back (docs/NUDITY_CHECK.md). Nobody
 * else sees them until approved; Remove deletes the file and tells the person.
 */
export function FlaggedMedia({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => api<Flagged[]>('/admin/panel/media?status=pending'), [], 30_000);
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

  const decide = async (decision: 'approve' | 'remove') => {
    if (!current || busy) return;
    const what = KIND[current.kind].toLowerCase();
    const answer = decision === 'approve'
      ? await ask({ title: `Approve this ${what}?`, text: current.kind === 'story' ? 'It is posted now, for 24 hours, and they hear it is up.' : 'It goes on their profile and they hear it was added.', confirm: 'Approve' })
      : await ask({ title: `Remove this ${what}?`, text: 'The file is deleted and they are told it was not added.', confirm: 'Remove', danger: true, reason: { label: 'What they will read (optional)', placeholder: 'It does not follow our Community Guidelines.' } });
    if (!answer) return;
    setBusy(true);
    try {
      await api(`/admin/panel/media/${current.id}/decide`, { method: 'POST', body: { decision, ...(answer.reason.trim() ? { note: answer.reason.trim() } : {}) } });
      toast(decision === 'approve' ? 'Approved' : 'Removed');
      move(1);
      await list.reload(true);
      onChange();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save', true);
    } finally { setBusy(false); }
  };
  useKeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), a: () => void decide('approve'), r: () => void decide('remove') });

  return <div className={`split${current ? ' has-detail' : ''}`}>
    <div className="split-list">
      <div className="list-head"><ImageOff size={14} />Waiting, oldest first<span className="spacer" />{items.length}</div>
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title="Nothing flagged" text="Photos, videos and Stories the nudity check isn't sure about come here." /> : items.map((item) =>
        <button key={item.id} className="list-item" aria-selected={item.id === current?.id} onClick={() => setSelected(item.id)}>
          <Avatar name={item.user?.name} />
          <div className="li-main">
            <div className="li-top"><span className="person-name">{item.user?.name ?? 'Deleted account'}</span><span className="li-time">{ago(item.createdAt)}</span></div>
            <div className="row" style={{ marginTop: 4 }}><Pill tone="warn">{KIND[item.kind]}</Pill>{item.refusedBefore ? <Pill tone="danger">{item.refusedBefore} refused</Pill> : null}</div>
          </div>
        </button>)}
    </div>
    <div className="split-detail">
      {current ? <>
        <div className="detail">
          <div className="detail-head">
            <Avatar large name={current.user?.name} />
            <div><h2 className="detail-title">{current.user?.name ?? 'Deleted account'}</h2>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{KIND[current.kind]} · score {current.score === null ? 'not checked' : current.score.toFixed(3)}</div></div>
            <span className="spacer" />
            <button className="btn" onClick={() => go(`/users/${current.userId}`)}><ExternalLink size={14} />Open user</button>
          </div>
          <div className="section-title">The upload</div>
          {current.viewUrl
            ? <div className="media-row"><div className="media flag" style={{ width: 280 }}>
              {current.video ? <video src={current.viewUrl} controls muted playsInline /> : <img src={current.viewUrl} alt="Flagged upload" />}
            </div></div>
            : <p className="muted">The file is no longer available.</p>}
          {current.refusedBefore ? <p className="muted" style={{ marginTop: 12 }}>This person has had {current.refusedBefore} {current.refusedBefore === 1 ? 'upload' : 'uploads'} refused as explicit. Three in a week opens a report case.</p> : null}
          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Score: how likely the model thinks it shows nudity, 0 to 1. From 0.9 it waits here; from 0.98 it is refused at upload. Clothed photos in warm light can score high - approve them.</p>
        </div>
        <div className="actionbar">
          <button className="btn primary" disabled={busy} onClick={() => void decide('approve')}>Approve <kbd>A</kbd></button>
          <button className="btn danger" disabled={busy} onClick={() => void decide('remove')}>Remove <kbd>R</kbd></button>
          <span className="hint"><kbd>J</kbd><kbd>K</kbd> next / previous</span>
        </div>
      </> : !list.loading ? <Empty title="Choose an item" /> : null}
    </div>
    {dialog}
  </div>;
}
