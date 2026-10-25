import { useEffect, useState } from 'react';
import { ExternalLink, ScanFace } from 'lucide-react';
import { api } from '../api';
import { ago, Avatar, Empty, go, Loading, Pill, useConfirm, useKeys, useLoad, useToast } from '../components/ui';

type MediaItem = { url: string; kind: 'photo' | 'video'; main: boolean; status: 'match' | 'unsure' | 'mismatch' | 'no_face' | 'side'; distance: number | null };
type Review = {
  id: string; userId: string; reason: string; createdAt: string;
  user: { id: string; name: string; accountStatus: string } | null;
  details: { media?: MediaItem[] };
  snapshots: string[]; photos: string[];
};

const REASON: Record<string, string> = {
  unsure: 'A photo was close to the selfie, but not close enough to be sure',
  unsure_after_change: 'A new photo was close to the selfie, but not close enough to be sure',
  repeated_failures: 'Three selfie attempts in a row failed',
  review: 'Sent to the team',
};
const EXPIRY_DAYS = 7;

/** Distance between two faces: under 0.5 the same person, 0.5-0.6 unsure, above that someone else. */
function scorePill(item: MediaItem) {
  if (item.status === 'no_face') return <Pill tone="danger">No face</Pill>;
  const score = item.distance === null ? '' : ` · ${item.distance.toFixed(3)}`;
  if (item.status === 'match') return <Pill tone="ok">Match{score}</Pill>;
  if (item.status === 'side') return <Pill tone="info">Side view{score}</Pill>;
  if (item.status === 'unsure') return <Pill tone="warn">Unsure{score}</Pill>;
  return <Pill tone="danger">Not them{score}</Pill>;
}

export function SelfieReviews({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => api<Review[]>('/admin/face-reviews'), [], 30_000);
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

  const decide = async (decision: 'approve' | 'reject' | 'retake') => {
    if (!current || busy) return;
    const name = current.user?.name ?? 'this person';
    const answer = decision === 'approve'
      ? await ask({ title: `Approve ${name}?`, text: 'Their selfie check is verified and they hear it at once. The snapshots are deleted.', confirm: 'Approve' })
      : decision === 'retake'
        ? await ask({ title: 'Ask for a new selfie?', text: 'They are asked to take the selfie check again. The snapshots are deleted.', confirm: 'Ask for retake', reason: { label: 'Tip they will read', placeholder: 'Use good light and look straight at the camera.' } })
        : await ask({ title: `Reject ${name}?`, text: 'Their face key is deleted and the check is marked failed. They will read your note.', confirm: 'Reject', danger: true, reason: { label: 'What they will read', required: true, placeholder: 'Your main photo needs to show your face.' } });
    if (!answer) return;
    setBusy(true);
    try {
      await api(`/admin/face-reviews/${current.id}/decide`, { method: 'POST', body: { decision, ...(answer.reason.trim() ? { note: answer.reason.trim() } : {}) } });
      toast(decision === 'approve' ? 'Approved' : decision === 'retake' ? 'Asked for a new selfie' : 'Rejected');
      move(1);
      await list.reload(true);
      onChange();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save', true);
    } finally { setBusy(false); }
  };
  useKeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), a: () => void decide('approve'), t: () => void decide('retake'), r: () => void decide('reject') });

  return <div className={`split${current ? ' has-detail' : ''}`}>
    <div className="split-list">
      <div className="list-head"><ScanFace size={14} />Waiting, oldest first<span className="spacer" />{items.length}</div>
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title="No selfie checks waiting" text="Unsure matches come here for a person to decide." /> : items.map((item) => {
        const left = EXPIRY_DAYS - Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 86_400_000);
        return <button key={item.id} className="list-item" aria-selected={item.id === current?.id} onClick={() => setSelected(item.id)}>
          <Avatar name={item.user?.name} src={item.photos[0]} />
          <div className="li-main">
            <div className="li-top"><span className="person-name">{item.user?.name ?? 'Deleted account'}</span><span className="li-time">{ago(item.createdAt)}</span></div>
            <div className="row" style={{ marginTop: 4 }}><Pill tone={left <= 2 ? 'danger' : 'warn'}>{left <= 0 ? 'Expires today' : `${left}d left`}</Pill><span className="person-sub">{item.reason === 'repeated_failures' ? 'Repeated failures' : 'Unsure match'}</span></div>
          </div>
        </button>;
      })}
    </div>
    <div className="split-detail">
      {current ? <>
        <div className="detail">
          <div className="detail-head">
            <Avatar large name={current.user?.name} src={current.photos[0]} />
            <div><h2 className="detail-title">{current.user?.name ?? 'Deleted account'}</h2><div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{REASON[current.reason] ?? current.reason}</div></div>
            <span className="spacer" />
            <button className="btn" onClick={() => go(`/users/${current.userId}`)}><ExternalLink size={14} />Open user</button>
          </div>
          <div className="section-title">Live selfie</div>
          {current.snapshots.length ? <div className="media-row">{current.snapshots.map((url, index) => <div key={url} className="media"><img src={url} alt={`Selfie step ${index + 1}`} /><div className="media-cap muted">Step {index + 1}</div></div>)}</div>
            : <p className="muted">No snapshots - this review came from a photo change, so compare the photos with each other.</p>}
          <div className="section-title">Profile photos and video</div>
          <div className="media-row">
            {(current.details.media?.length ? current.details.media : current.photos.map((url, index) => ({ url, kind: 'photo' as const, main: index === 0, status: 'match' as const, distance: null }))).map((item) =>
              <div key={item.url} className={`media${item.status === 'mismatch' || item.status === 'no_face' ? ' flag' : item.status === 'unsure' ? ' warn' : ''}`}>
                {item.kind === 'video' ? <video src={item.url} muted loop playsInline onMouseEnter={(event) => void event.currentTarget.play()} onMouseLeave={(event) => event.currentTarget.pause()} /> : <img src={item.url} alt="" />}
                <div className="media-cap">{scorePill(item)}{item.main ? <span className="muted">Main</span> : item.kind === 'video' ? <span className="muted">Video</span> : null}</div>
              </div>)}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Score: how far each face is from the selfie. Under 0.5 is the same person, 0.5-0.6 unsure, above 0.6 someone else. Extra photos count up to 0.6; a side view, up to 0.75.</p>
        </div>
        <div className="actionbar">
          <button className="btn primary" disabled={busy} onClick={() => void decide('approve')}>Approve <kbd>A</kbd></button>
          <button className="btn" disabled={busy} onClick={() => void decide('retake')}>Ask for retake <kbd>T</kbd></button>
          <button className="btn danger" disabled={busy} onClick={() => void decide('reject')}>Reject <kbd>R</kbd></button>
          <span className="hint"><kbd>J</kbd><kbd>K</kbd> next / previous</span>
        </div>
      </> : !list.loading ? <Empty title="Choose a review" /> : null}
    </div>
    {dialog}
  </div>;
}
