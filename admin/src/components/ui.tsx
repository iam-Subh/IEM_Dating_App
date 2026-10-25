import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { TextMorph } from 'torph/react';

// ---- Routing: #/path, so the panel works from any static host ------------

export function useRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
export const go = (path: string) => { window.location.hash = path; };

// ---- Data -----------------------------------------------------------------

/** Loads once, again on `reload()`, and every `everyMs` while the tab is visible. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = [], everyMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { setData(await loadRef.current()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!everyMs) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(true); }, everyMs);
    return () => clearInterval(timer);
  }, [everyMs, reload]);
  return { data, error, loading, reload, setData };
}

// ---- Words ---------------------------------------------------------------

export function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const n = (value: number | null | undefined) => (value ?? 0).toLocaleString();
/**
 * A number that rolls digit by digit to its new value when it changes (torph):
 * counts that update live - queues, people online, sign-ups - show the change.
 */
export function Num({ value, decimals, suffix }: { value: number | null | undefined; decimals?: number; suffix?: string }) {
  return <TextMorph as="span" numbers duration={450} ease="cubic-bezier(0.19, 1, 0.22, 1)" className="num-morph">
    {`${decimals === undefined ? n(value) : (value ?? 0).toFixed(decimals)}${suffix ?? ''}`}
  </TextMorph>;
}

// ---- Small pieces ---------------------------------------------------------

export function Avatar({ name, src, large = false }: { name?: string | null; src?: string | null; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = (name ?? '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  if (src && !failed) return <img className={`avatar${large ? ' lg' : ''}`} src={src} alt="" onError={() => setFailed(true)} />;
  return <div className={`avatar${large ? ' lg' : ''}`} aria-hidden>{initials}</div>;
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | undefined;
export const Pill = ({ tone, icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) =>
  <span className={`pill${tone ? ` ${tone}` : ''}`}>{icon}{children}</span>;

/** What an account's status means, in one coloured word. */
export function statusPill(status: string, suspendedUntil?: string | null) {
  if (status === 'active') return <Pill tone="ok">Active</Pill>;
  if (status === 'restricted') return <Pill tone="warn">Hidden</Pill>;
  if (status === 'suspended') return <Pill tone="warn">Suspended{suspendedUntil ? ` · until ${new Date(suspendedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</Pill>;
  if (status === 'banned') return <Pill tone="danger">Banned</Pill>;
  if (status === 'deletion_pending') return <Pill tone="info">Deleting</Pill>;
  return <Pill>{status}</Pill>;
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return <div className="empty">
    <div className="empty-icon"><Check size={22} /></div>
    <div className="empty-title">{title}</div>
    {text ? <div>{text}</div> : null}
  </div>;
}

export function Loading({ rows = 6 }: { rows?: number }) {
  return <div style={{ padding: 16, display: 'grid', gap: 10 }}>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton" style={{ height: 40 }} />)}
  </div>;
}

/** A 30-day line, drawn as SVG - no chart library. */
export function Sparkline({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  const width = 300;
  const height = 56;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 4 - (value / max) * (height - 10)).toFixed(1)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Last ${values.length} days, highest ${max}`}>
    <polyline points={`0,${height} ${points} ${width},${height}`} fill={color} opacity={0.1} stroke="none" />
    <polyline points={points} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </svg>;
}

// ---- Keyboard ---------------------------------------------------------------

/** Single-key shortcuts, ignored while typing or while a dialog is open. */
export function useKeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if (document.querySelector('.overlay')) return;
      const action = ref.current[event.key];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

// ---- Toasts -----------------------------------------------------------------

type Toast = { id: number; text: string; bad?: boolean };
const ToastContext = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, bad }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 3200);
  }, []);
  return <ToastContext.Provider value={push}>
    {children}
    <div className="toasts" role="status" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast${toast.bad ? ' bad' : ''}`}>{toast.text}</div>)}</div>
  </ToastContext.Provider>;
}

// ---- Confirm, with a reason when it matters ---------------------------------

export type ConfirmOptions = {
  title: string; text: string; confirm: string; danger?: boolean;
  reason?: { label: string; required?: boolean; placeholder?: string };
  days?: boolean;
};
export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions | null; onClose: (result: { reason: string; days: number } | null) => void }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(7);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setReason(''); setDays(7); if (options?.reason) setTimeout(() => inputRef.current?.focus(), 30); }, [options]);
  useEffect(() => {
    if (!options) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, onClose]);
  if (!options) return null;
  const ready = !options.reason?.required || reason.trim().length > 0;
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(null); }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 id="dialog-title">{options.title}</h2>
      <p>{options.text}</p>
      {options.days ? <>
        <label className="label" htmlFor="dialog-days">For how many days</label>
        <div className="tabs" id="dialog-days">{[1, 3, 7, 14, 30].map((value) => <button key={value} className="tab" aria-selected={days === value} onClick={() => setDays(value)}>{value} {value === 1 ? 'day' : 'days'}</button>)}</div>
      </> : null}
      {options.reason ? <>
        <label className="label" htmlFor="dialog-reason">{options.reason.label}{options.reason.required ? '' : ' (optional)'}</label>
        <textarea id="dialog-reason" ref={inputRef} className="textarea" value={reason} placeholder={options.reason.placeholder} maxLength={300}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready) onClose({ reason, days }); }} />
      </> : null}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={() => onClose(null)}>Cancel</button>
        <button className={`btn ${options.danger ? 'danger' : 'primary'}`} disabled={!ready} onClick={() => onClose({ reason, days })}>{options.confirm}</button>
      </div>
    </div>
  </div>;
}

/** `const ask = useConfirm(); const answer = await ask({...})` */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(value: { reason: string; days: number } | null) => void>(() => {});
  const ask = useCallback((next: ConfirmOptions) => new Promise<{ reason: string; days: number } | null>((resolve) => {
    resolver.current = resolve;
    setOptions(next);
  }), []);
  const close = useCallback((result: { reason: string; days: number } | null) => { setOptions(null); resolver.current(result); }, []);
  return { ask, dialog: <ConfirmDialog options={options} onClose={close} /> };
}
