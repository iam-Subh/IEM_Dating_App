import { useEffect, useState } from 'react';
import { Bug, ExternalLink, EyeOff } from 'lucide-react';
import { api } from '../api';
import { ago, date, Empty, go, Loading, Pill, useConfirm, useKeys, useLoad, useToast } from '../components/ui';

type Row = {
  id: string; reference: string; area: string; description: string; status: string; source: string; createdAt: string;
  files: number; user: { id: string; name: string } | null; diagnostics: Diagnostics | null;
};
type Diagnostics = { appVersion?: string; device?: string | null; osVersion?: string; platform?: string; screen?: string | null; recentErrors?: { at: string; message: string }[] };
type Detail = Row & {
  userId: string; fixedInVersion: string | null; staffNote: string | null; closedAt: string | null; earlierReports: number; duplicateOfReference: string | null;
  attachments: { id: string; kind: 'photo' | 'video'; sizeBytes: number | null; sensitive: boolean; url: string | null }[];
  user: { id: string; name: string; email: string | null } | null;
};

const AREA: Record<string, string> = { chat: 'Chat', photos: 'Photos & video', matches: 'Matches', explore: 'Explore', stories: 'Stories', login: 'Login', notifications: 'Notifications', other: 'Something else' };
const STATUS: Record<string, { label: string; tone: 'info' | 'warn' | 'ok' | undefined }> = {
  received: { label: 'New', tone: 'info' }, investigating: { label: 'Looking into it', tone: 'warn' },
  fixed: { label: 'Fixed', tone: 'ok' }, closed: { label: 'Closed', tone: undefined }, duplicate: { label: 'Duplicate', tone: undefined },
};
const SOURCE: Record<string, string> = { form: 'Settings', shake: 'Shake', error: 'Error screen', rating: 'Low rating' };
const TABS = [{ id: 'open', label: 'Open' }, { id: 'fixed', label: 'Fixed' }, { id: 'closed', label: 'Closed' }] as const;

/**
 * Bug and "not working" reports from the app (docs/FEEDBACK.md). Each change
 * of status is sent to the person as a notification, with your note.
 * Closing (or marking a duplicate) deletes the report's files.
 */
export function BugReports({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState<typeof TABS[number]['id']>('open');
  const [area, setArea] = useState('');
  const list = useLoad(() => api<Row[]>(`/admin/panel/bug-reports?status=${tab}${area ? `&area=${area}` : ''}`), [tab, area], 30_000);
  const [selected, setSelected] = useState<string | null>(null);
  const items = list.data ?? [];
  const current = items.find((item) => item.id === selected) ?? items[0] ?? null;
  useEffect(() => { if (current && current.id !== selected) setSelected(current.id); }, [current, selected]);
  const detail = useLoad(() => current ? api<Detail>(`/admin/panel/bug-reports/${current.id}`) : Promise.resolve(null), [current?.id]);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const move = (step: number) => {
    const index = items.findIndex((item) => item.id === current?.id);
    const next = items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (next) setSelected(next.id);
  };

  const setStatus = async (status: 'investigating' | 'fixed' | 'closed' | 'duplicate') => {
    if (!current || busy) return;
    const answer = status === 'investigating'
      ? await ask({ title: 'Mark as looking into it?', text: 'They hear that the team is working on it.', confirm: 'Mark', reason: { label: 'A note they will read', placeholder: 'Thanks - we can see the problem.' } })
      : status === 'fixed'
        ? await ask({ title: 'Mark as fixed?', text: 'They hear it is fixed. Add the version it is fixed in, if it needs an update.', confirm: 'Mark fixed', reason: { label: 'Fixed in version', placeholder: '1.0.3' } })
        : status === 'duplicate'
          ? await ask({ title: 'Same as another report?', text: 'They hear we already know about it. Its files are deleted.', confirm: 'Mark duplicate', reason: { label: 'Reference of the original report', required: true, placeholder: '#B-1001' } })
          : await ask({ title: 'Close this report?', text: 'They hear it is closed. Its files are deleted.', confirm: 'Close', danger: true, reason: { label: 'A note they will read', placeholder: 'We could not reproduce this. Tell us if it happens again.' } });
    if (!answer) return;
    const value = answer.reason.trim();
    setBusy(true);
    try {
      await api(`/admin/panel/bug-reports/${current.id}/status`, {
        method: 'POST',
        body: { status, ...(status === 'fixed' ? { fixedInVersion: value || null } : status === 'duplicate' ? { duplicateOf: value } : { note: value || null }) },
      });
      toast(status === 'fixed' ? 'Marked fixed - they were told' : status === 'closed' ? 'Closed - they were told' : status === 'duplicate' ? 'Marked duplicate' : 'They were told');
      await list.reload(true);
      await detail.reload(true);
      onChange();
    } catch (error) { toast(error instanceof Error ? error.message : 'Could not save', true); }
    finally { setBusy(false); }
  };
  const open = tab === 'open';
  useKeys({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), i: () => void setStatus('investigating'), f: () => void setStatus('fixed'), d: () => void setStatus('duplicate'), c: () => void setStatus('closed') }, open);

  const report = detail.data;
  const diagnostics = report?.diagnostics ?? null;
  return <div className={`split${current ? ' has-detail' : ''}`}>
    <div className="split-list">
      <div className="list-head">
        <div className="tabs">{TABS.map((item) => <button key={item.id} className="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
        <span className="spacer" />{items.length}
      </div>
      <div className="list-head" style={{ paddingTop: 0 }}>
        <select className="select" value={area} onChange={(event) => setArea(event.target.value)} aria-label="Area">
          <option value="">All areas</option>
          {Object.entries(AREA).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : !items.length ? <Empty title={open ? 'No open reports' : 'Nothing here'} text={open ? 'Reports from Settings, a shake or an error screen come here.' : undefined} /> : items.map((item) =>
        <button key={item.id} className="list-item" aria-selected={item.id === current?.id} onClick={() => setSelected(item.id)}>
          <div className="li-main">
            <div className="li-top"><span className="person-name">{item.reference} · {AREA[item.area] ?? item.area}</span><span className="li-time">{ago(item.createdAt)}</span></div>
            <div className="row" style={{ marginTop: 4 }}>
              <Pill tone={STATUS[item.status]?.tone}>{STATUS[item.status]?.label ?? item.status}</Pill>
              <span className="person-sub">{item.description.slice(0, 70)}</span>
            </div>
          </div>
        </button>)}
    </div>
    <div className="split-detail">
      {current ? <>
        <div className="detail">
          <div className="detail-head">
            <div className="brand-mark" style={{ width: 44, height: 44 }}><Bug size={20} /></div>
            <div>
              <h2 className="detail-title">{current.reference} · {AREA[current.area] ?? current.area}</h2>
              <div className="row wrap" style={{ marginTop: 6 }}>
                <Pill tone={STATUS[current.status]?.tone}>{STATUS[current.status]?.label ?? current.status}</Pill>
                <span className="muted">From {SOURCE[current.source] ?? current.source} · {date(current.createdAt)}</span>
              </div>
            </div>
            <span className="spacer" />
            {report?.user ? <button className="btn" onClick={() => go(`/users/${report.user!.id}`)}><ExternalLink size={14} />{report.user.name}</button> : null}
          </div>

          <div className="section-title">What happened</div>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{current.description}</p>
          {report?.earlierReports ? <p className="muted" style={{ fontSize: 12 }}>This person has sent {report.earlierReports} other {report.earlierReports === 1 ? 'report' : 'reports'}.</p> : null}
          {report?.fixedInVersion ? <p className="muted">Fixed in version {report.fixedInVersion}.</p> : null}
          {report?.duplicateOfReference ? <p className="muted">Same as {report.duplicateOfReference}.</p> : null}
          {report?.staffNote ? <p className="muted">Note sent: {report.staffNote}</p> : null}

          <div className="section-title">Screenshots and recording</div>
          {!report ? <Loading rows={1} /> : !report.attachments.length ? <p className="muted">{current.files ? 'Files deleted.' : 'None attached.'}</p> : <div className="media-row">
            {report.attachments.map((item) => {
              const hidden = item.sensitive && !revealed.has(item.id);
              return <div key={item.id} className={`media wide${item.sensitive ? ' warn' : ''}`} style={{ width: item.kind === 'video' ? 260 : 200 }}>
                {hidden ? <button className="btn" style={{ width: '100%', height: 220, flexDirection: 'column', gap: 8 }} onClick={() => setRevealed((value) => new Set(value).add(item.id))}>
                  <EyeOff size={20} />May contain nudity - click to view
                </button> : !item.url ? <p className="muted">Unavailable</p>
                  : item.kind === 'video' ? <video src={item.url} controls playsInline /> : <a href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt="Screenshot" /></a>}
                <div className="media-cap muted">{item.kind === 'video' ? 'Recording' : 'Photo'}{item.sizeBytes ? ` · ${Math.round(item.sizeBytes / 1024)} KB` : ''}</div>
              </div>;
            })}
          </div>}

          <div className="section-title">Technical details</div>
          {!diagnostics ? <p className="muted">Not included - they turned it off.</p> : <>
            <div className="kv">
              <span className="muted">App</span><span className="mono">{diagnostics.appVersion ?? '—'}</span>
              <span className="muted">Phone</span><span>{diagnostics.device ?? '—'} · {diagnostics.platform} {diagnostics.osVersion}</span>
              <span className="muted">Screen</span><span className="mono">{diagnostics.screen ?? '—'}</span>
            </div>
            {diagnostics.recentErrors?.length ? <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 10, maxHeight: 260, overflow: 'auto' }}>
              {diagnostics.recentErrors.map((error) => `${error.at.slice(11, 19)}  ${error.message}`).join('\n')}
            </pre> : <p className="muted" style={{ marginTop: 8 }}>No recent errors.</p>}
          </>}
        </div>
        {open ? <div className="actionbar">
          <button className="btn" disabled={busy || current.status === 'investigating'} onClick={() => void setStatus('investigating')}>Looking into it <kbd>I</kbd></button>
          <button className="btn primary" disabled={busy} onClick={() => void setStatus('fixed')}>Fixed <kbd>F</kbd></button>
          <button className="btn" disabled={busy} onClick={() => void setStatus('duplicate')}>Duplicate <kbd>D</kbd></button>
          <button className="btn danger" disabled={busy} onClick={() => void setStatus('closed')}>Close <kbd>C</kbd></button>
          <span className="hint"><kbd>J</kbd><kbd>K</kbd> next / previous</span>
        </div> : current.status === 'fixed' ? <div className="actionbar">
          <button className="btn" disabled={busy} onClick={() => void setStatus('closed')}>Close</button>
        </div> : null}
      </> : !list.loading ? <Empty title="Choose a report" /> : null}
    </div>
    {dialog}
  </div>;
}
