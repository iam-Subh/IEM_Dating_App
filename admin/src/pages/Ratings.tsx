import { Star } from 'lucide-react';
import { api } from '../api';
import { ago, Empty, go, Loading, n, Num, Sparkline, useLoad } from '../components/ui';

type Ratings = {
  count: number; average: number | null; counts: number[];
  weeks: { start: string; count: number; average: number | null }[];
  comments: { id: string; score: number; comment: string; appVersion: string | null; createdAt: string; user: { id: string; name: string } | null }[];
};
const FACE = ['😞', '😕', '😐', '🙂', '😍'];

/**
 * The in-app "How's IEM Connect so far?" answers, last 90 days
 * (docs/FEEDBACK.md). Private to the team - Google Play reviews are in the
 * Play Console. Low scores with a comment are worth reading first.
 */
export function RatingsPage() {
  const data = useLoad(() => api<Ratings>('/admin/panel/ratings'), [], 60_000);
  if (data.loading && !data.data) return <div className="page"><Loading /></div>;
  const ratings = data.data;
  if (!ratings || !ratings.count) return <div className="page"><Empty title="No ratings yet" text="People are asked from their seventh day, then every two months." /></div>;
  const most = Math.max(...ratings.counts, 1);
  const weekly = ratings.weeks.map((week) => week.average ?? 0);
  return <div className="page">
    <div className="grid stats">
      <div className="card stat"><div className="stat-label"><Star size={14} />Average, 90 days</div><div className="stat-value">{ratings.average === null ? '—' : <Num value={ratings.average} decimals={2} />} <span className="muted" style={{ fontSize: 14 }}>/ 5</span></div><div className="stat-foot">{n(ratings.count)} answers</div></div>
      <div className="card stat"><div className="stat-label">Happy (4-5)</div><div className="stat-value"><Num value={Math.round(((ratings.counts[3] + ratings.counts[4]) / ratings.count) * 100)} suffix="%" /></div><div className="stat-foot">{n(ratings.counts[3] + ratings.counts[4])} people</div></div>
      <div className="card stat"><div className="stat-label">Unhappy (1-2)</div><div className="stat-value"><Num value={Math.round(((ratings.counts[0] + ratings.counts[1]) / ratings.count) * 100)} suffix="%" /></div><div className="stat-foot">{n(ratings.counts[0] + ratings.counts[1])} people</div></div>
      <div className="card stat"><div className="stat-label">Weekly average, 12 weeks</div><div style={{ marginTop: 10 }}><Sparkline values={weekly} /></div></div>
    </div>

    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div className="section-title" style={{ marginTop: 0 }}>Scores</div>
      {[4, 3, 2, 1, 0].map((index) => <div key={index} className="row" style={{ gap: 12, marginBottom: 8 }}>
        <span style={{ width: 28, fontSize: 18 }}>{FACE[index]}</span>
        <div style={{ flex: 1 }}><div className="rating-bar" style={{ width: `${(ratings.counts[index] / most) * 100}%`, opacity: 0.35 + 0.13 * index }} /></div>
        <span className="mono" style={{ width: 40, textAlign: 'right' }}><Num value={ratings.counts[index]} /></span>
      </div>)}
    </div>

    <div className="section-title">Comments, newest first</div>
    {!ratings.comments.length ? <p className="muted">No comments yet.</p> : <div className="grid" style={{ gap: 8 }}>
      {ratings.comments.map((item) => <div key={item.id} className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: 20 }}>{FACE[item.score - 1]}</span>
          {item.user ? <button className="btn ghost" onClick={() => go(`/users/${item.user!.id}`)}>{item.user.name}</button> : <span className="muted">Deleted account</span>}
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>{item.appVersion ? `v${item.appVersion} · ` : ''}{ago(item.createdAt)}</span>
        </div>
        <p style={{ marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{item.comment}</p>
      </div>)}
    </div>}
  </div>;
}
