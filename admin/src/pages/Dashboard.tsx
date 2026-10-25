import { Activity, Bug, Cake, Flag, GraduationCap, Heart, ImageOff, MessageCircle, Scale, ScanFace, ShieldCheck, Smartphone, Store, UserPlus, Users } from 'lucide-react';
import { ago, go, Loading, n, Num, Sparkline, type useLoad } from '../components/ui';

type Series = { day: string; count: number }[];
export type DashboardData = {
  at: string;
  live: { online: number; phones: number; android: number; ios: number; phonesToday: number; signupsToday: number };
  people: { users: number; activeToday: number; active7d: number; matchesToday: number; messagesToday: number };
  verification: { collegeVerified: number; selfieVerified: number; paused: number; restricted: number; banned: number };
  queues: { faceReviews: number; faceOldest: string | null; cases: number; urgentCases: number; caseOldest: string | null; birthdays: number; memberships: number; appeals: number; flaggedMedia?: number; bugReports?: number };
  series: { signups: Series; phones: Series; matches: Series };
};

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

export function Dashboard({ board }: { board: ReturnType<typeof useLoad<DashboardData>> }) {
  const data = board.data;
  if (!data) return <div className="page">{board.error ? <p className="error-text">{board.error}</p> : <Loading rows={8} />}</div>;
  const { live, people, verification, queues, series } = data;
  const waiting = queues.cases + queues.faceReviews + queues.birthdays + queues.memberships + (queues.appeals ?? 0) + (queues.flaggedMedia ?? 0);
  return <div className="page">
    <div className="page-head">
      <div>
        <h2 className="page-title">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}</h2>
        <div className="page-sub">{waiting ? `${waiting} ${waiting === 1 ? 'item is' : 'items are'} waiting for a decision.` : 'Nothing is waiting for a decision.'} Live numbers update every 15 seconds.</div>
      </div>
    </div>

    {/* Live: our own server's numbers, read fresh on every update. */}
    <div className="grid stats">
      <Stat live icon={<Activity size={14} />} label="Online now" value={live.online} foot="App open on screen" />
      <Stat live icon={<Smartphone size={14} />} label="Phones with the app" value={live.phones} foot={`${n(live.android)} Android · ${n(live.ios)} iPhone`} />
      <Stat live icon={<Smartphone size={14} />} label="New phones today" value={live.phonesToday} foot="First signed in today" />
      <Stat live icon={<UserPlus size={14} />} label="Sign-ups today" value={live.signupsToday} foot={`${n(people.users)} accounts in all`} />
      <div className="card stat">
        <div className="stat-label"><Store size={14} />Play Store installs</div>
        <div className="stat-value muted" style={{ fontSize: 18, marginTop: 10 }}>After publishing</div>
        <div className="stat-foot">Google updates these once a day</div>
      </div>
    </div>

    <div className="grid two" style={{ marginTop: 12 }}>
      <div className="card">
        <div className="card-head">Waiting for a decision<span className="sub">· oldest first</span></div>
        <Queue icon={<Flag size={17} />} name="Reports" age={queues.caseOldest} count={queues.cases} urgent={queues.urgentCases} path="/reports" />
        <Queue icon={<ScanFace size={17} />} name="Selfie checks" age={queues.faceOldest} count={queues.faceReviews} path="/reviews/selfie" note="Expire after 7 days" />
        <Queue icon={<ImageOff size={17} />} name="Flagged media" age={null} count={queues.flaggedMedia ?? 0} path="/reviews/media" note="Hidden until decided" />
        <Queue icon={<Cake size={17} />} name="Birthday changes" count={queues.birthdays} path="/reviews/birthdays" />
        <Queue icon={<GraduationCap size={17} />} name="College confirmations" count={queues.memberships} path="/reviews/colleges" />
        <Queue icon={<Scale size={17} />} name="Appeals" count={queues.appeals ?? 0} path="/appeals" note="Reply within 15 days" />
        <Queue icon={<Bug size={17} />} name="Bug reports" count={queues.bugReports ?? 0} path="/bugs" note="New, not yet looked at" />
      </div>
      <div className="card">
        <div className="card-head">Trust and verification</div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <Bar label="College verified" value={verification.collegeVerified} of={people.users} tone="var(--info)" />
          <Bar label="Selfie verified" value={verification.selfieVerified} of={people.users} tone="var(--ok)" />
          <div className="row wrap" style={{ gap: 18, marginTop: 4 }}>
            <Mini label="Paused" value={verification.paused} />
            <Mini label="Hidden or suspended" value={verification.restricted} />
            <Mini label="Banned" value={verification.banned} />
          </div>
        </div>
      </div>
    </div>

    <div className="grid stats" style={{ marginTop: 12 }}>
      <Stat icon={<Users size={14} />} label="Active today" value={people.activeToday} foot={`${n(people.active7d)} this week`} />
      <Stat icon={<Heart size={14} />} label="Matches today" value={people.matchesToday} />
      <Stat icon={<MessageCircle size={14} />} label="Messages today" value={people.messagesToday} />
      <Stat icon={<ShieldCheck size={14} />} label="Blue badge rate" value={pct(Math.min(verification.collegeVerified, verification.selfieVerified), people.users)} foot="Both steps done, at most" />
    </div>

    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: 12 }}>
      <Trend title="Sign-ups" series={series.signups} color="var(--accent)" />
      <Trend title="New phones" series={series.phones} color="var(--info)" />
      <Trend title="Matches" series={series.matches} color="var(--ok)" />
    </div>
    <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Updated {ago(data.at)}. Days are counted in India time.</p>
  </div>;
}

function Stat({ icon, label, value, foot, live = false }: { icon: React.ReactNode; label: string; value: number | string; foot?: string; live?: boolean }) {
  return <div className={`card stat${live ? ' live-stat' : ''}`}>
    <div className="stat-label">{icon}{label}</div>
    <div className="stat-value">{typeof value === 'number' ? <Num value={value} /> : value}</div>
    {foot ? <div className="stat-foot">{foot}</div> : null}
  </div>;
}

function Queue({ icon, name, age, count, urgent = 0, path, note }: { icon: React.ReactNode; name: string; age?: string | null; count: number; urgent?: number; path: string; note?: string }) {
  return <a className="queue-tile" href={`#${path}`} onClick={(event) => { event.preventDefault(); go(path); }}>
    <span className="muted">{icon}</span>
    <div>
      <div className="q-name">{name} {urgent ? <span className="pill danger" style={{ marginLeft: 6 }}>{urgent} urgent</span> : null}</div>
      <div className="q-age">{count ? (age ? `Oldest ${ago(age)}` : 'Waiting') : 'All clear'}{note && count ? ` · ${note}` : ''}</div>
    </div>
    <span className="q-count" style={{ color: count ? 'var(--text)' : 'var(--muted)' }}><Num value={count} /></span>
  </a>;
}

function Bar({ label, value, of, tone }: { label: string; value: number; of: number; tone: string }) {
  const share = of ? Math.min(100, (value / of) * 100) : 0;
  return <div>
    <div className="row" style={{ fontSize: 13 }}><span>{label}</span><span className="spacer" /><span className="num"><Num value={value} /></span><span className="muted num" style={{ width: 44, textAlign: 'right' }}>{pct(value, of)}</span></div>
    <div style={{ height: 6, borderRadius: 3, background: 'var(--raised)', marginTop: 6, overflow: 'hidden' }}><div style={{ width: `${share}%`, height: '100%', background: tone, borderRadius: 3 }} /></div>
  </div>;
}

const Mini = ({ label, value }: { label: string; value: number }) =>
  <div><div className="muted" style={{ fontSize: 12 }}>{label}</div><div className="num" style={{ fontSize: 17, fontWeight: 600 }}><Num value={value} /></div></div>;

function Trend({ title, series, color }: { title: string; series: Series; color: string }) {
  const total = series.reduce((sum, item) => sum + item.count, 0);
  const today = series.at(-1)?.count ?? 0;
  return <div className="card">
    <div className="card-head">{title}<span className="sub">· last 30 days</span><span className="spacer" /><span className="num"><Num value={total} /></span></div>
    <div className="card-body" style={{ paddingTop: 8 }}>
      <Sparkline values={series.map((item) => item.count)} color={color} />
      <div className="row muted" style={{ fontSize: 11, marginTop: 4 }}><span>{series[0]?.day.slice(5)}</span><span className="spacer" /><span>Today: {today}</span></div>
    </div>
  </div>;
}
