'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Save, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  SHARE_RECIPIENT_KINDS,
  type ShareLinkPatch,
  type ShareLinkSource,
  type ShareRecipientKind,
} from '@/lib/links/share-link';

export interface LinkSettingsTrack {
  id: string;
  title: string;
  type: string;
  cover_url: string | null;
}

export interface LinkSettingsLink {
  id: string;
  source: ShareLinkSource;
  token: string;
  kind: string;
  expires_at: string | null;
  password_protected: boolean;
  recipient_kind?: string | null;
  sales_enabled?: boolean | null;
  track_ids: string[];
  tracks: LinkSettingsTrack[];
}

interface Props<T extends LinkSettingsLink> {
  link: T;
  /** Resolves true when the server accepted the patch (the page merges the response). */
  onPatch: (link: T, patch: ShareLinkPatch) => Promise<boolean>;
  formatDate: (iso: string) => string;
}

const KIND_LABELS: Record<ShareRecipientKind, string> = {
  client: 'Client',
  producer: 'Producer',
  rapper: 'Rapper',
  friend: 'Friend',
};

const KEEP = 'keep';

function kindOf(link: LinkSettingsLink): ShareRecipientKind {
  return (SHARE_RECIPIENT_KINDS as readonly string[]).includes(link.recipient_kind ?? '')
    ? (link.recipient_kind as ShareRecipientKind)
    : 'client';
}

/**
 * Everything editable about an existing link, for both tables.
 *
 * Recipient kind, selling and the track list apply as soon as they change
 * (optimistic, rolled back with a toast if the server refuses); expiry and
 * password are the two properties that want a deliberate Save. The token never
 * changes on edit, and a saved password or expiry applies on the next request.
 * A password is never displayed — only whether one is set.
 */
export function LinkSettingsForm<T extends LinkSettingsLink>({ link, onPatch, formatDate }: Props<T>) {
  const [kind, setKind] = useState<ShareRecipientKind>(kindOf(link));
  const [sales, setSales] = useState(link.sales_enabled === true);
  const [tracks, setTracks] = useState(link.tracks);
  const [expiry, setExpiry] = useState<string>(link.expires_at ? KEEP : '0');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  // The page merges each server response into `link`; follow it. Adjusting
  // state while rendering (not in an effect) is React's pattern for "reset when
  // a prop changes" and avoids a second, stale render.
  const signature = [link.recipient_kind, link.sales_enabled, link.expires_at, link.track_ids.join(',')].join('|');
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setKind(kindOf(link));
    setSales(link.sales_enabled === true);
    setTracks(link.tracks);
    setExpiry(link.expires_at ? KEEP : '0');
  }

  const isToken = link.source === 'share_links';
  const isClient = kind === 'client';

  const changeKind = async (next: ShareRecipientKind) => {
    if (next === kind) return;
    const before = { kind, sales };
    setKind(next);
    if (next !== 'client') setSales(false);
    const ok = await onPatch(link, { recipient_kind: next });
    if (!ok) { setKind(before.kind); setSales(before.sales); }
  };

  const toggleSales = async () => {
    if (!isClient) return;
    const next = !sales;
    setSales(next);
    const ok = await onPatch(link, { sales_enabled: next });
    if (!ok) setSales(!next);
  };

  const saveTracks = async (next: LinkSettingsTrack[]) => {
    if (next.length === 0) { toast.error('A link needs at least one track'); return; }
    const before = tracks;
    setTracks(next);
    setBusy(true);
    const ok = await onPatch(link, { track_ids: next.map((t) => t.id) });
    setBusy(false);
    if (!ok) setTracks(before);
  };

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= tracks.length) return;
    const next = tracks.slice();
    [next[index], next[to]] = [next[to], next[index]];
    void saveTracks(next);
  };

  const dirty = expiry !== (link.expires_at ? KEEP : '0') || clearPassword || password.length > 0;
  const save = async () => {
    const patch: ShareLinkPatch = {};
    if (expiry !== KEEP && expiry !== (link.expires_at ? KEEP : '0')) patch.expires_days = Number(expiry);
    if (clearPassword) patch.password = null;
    else if (password) patch.password = password;
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    const ok = await onPatch(link, patch);
    setSaving(false);
    if (ok) { setPassword(''); setClearPassword(false); setShowPassword(false); }
  };

  const expiryOptions = useMemo(
    () => [
      ...(link.expires_at ? [{ value: KEEP, label: `Until ${formatDate(link.expires_at)}` }] : []),
      { value: '0', label: 'Never' },
      { value: '1', label: '1 day' },
      { value: '3', label: '3 days' },
      { value: '7', label: '7 days' },
      { value: '14', label: '14 days' },
      { value: '30', label: '30 days' },
    ],
    [link.expires_at, formatDate],
  );

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid="link-settings-form">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-white/60">Recipient</label>
          <Dropdown
            aria-label="Recipient kind"
            value={kind}
            onChange={(v) => void changeKind(v as ShareRecipientKind)}
            options={SHARE_RECIPIENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
            className="w-full rounded-lg border border-white/10 bg-[#090907] px-2.5 py-2 text-[11px] text-white"
          />
        </div>
        <div>
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-white/60">Selling</span>
          <button
            type="button"
            role="switch"
            aria-checked={sales}
            aria-label="Sell from this link"
            disabled={!isClient}
            onClick={() => void toggleSales()}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[11px] transition-colors',
              sales ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]',
              'disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]',
            )}
          >
            <span>{sales ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>
      {!isClient && <p className="-mt-2 text-[10px] text-white/40">Selling is for client links only.</p>}

      <div>
        <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-white/60">Expires in</label>
        <Dropdown
          aria-label="Expiry"
          value={expiry}
          onChange={setExpiry}
          options={expiryOptions}
          className="w-full rounded-lg border border-white/10 bg-[#090907] px-2.5 py-2 text-[11px] text-white"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-white/60">
          <label htmlFor={`link-password-${link.id}`}>
            Password {link.password_protected && <span className="normal-case text-white/40">(currently set)</span>}
          </label>
          {link.password_protected && (
            <button
              type="button"
              onClick={() => setClearPassword((v) => !v)}
              className={cn('uppercase tracking-wider transition-colors', clearPassword ? 'text-red-400' : 'text-white/60 hover:text-red-400')}
            >
              {clearPassword ? 'Will clear' : 'Clear it'}
            </button>
          )}
        </div>
        <div className="relative">
          <input
            id={`link-password-${link.id}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={clearPassword}
            maxLength={200}
            placeholder={link.password_protected ? 'Type a new password to replace it' : 'No password'}
            className="w-full rounded-lg border border-white/10 bg-[#090907] py-2 pl-2.5 pr-9 text-[11px] text-white placeholder:text-white/30 focus:border-white/50 focus:outline-none disabled:opacity-40"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((v) => !v)}
            disabled={clearPassword}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center text-white/40 hover:text-white disabled:opacity-40"
          >
            {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-white/90 disabled:opacity-40"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
        Save
      </button>

      <div className="border-t border-white/[0.06] pt-4">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">Tracks</p>
        {isToken ? (
          <TrackEditor tracks={tracks} busy={busy} onMove={move} onRemove={(i) => void saveTracks(tracks.filter((_, j) => j !== i))} onAdd={(t) => void saveTracks([...tracks, t])} />
        ) : (
          <p className="text-[11px] text-white/60">
            This link points at a {link.kind}, so its tracks follow it. Edit the {link.kind} to change what is on the link.
          </p>
        )}
      </div>
    </div>
  );
}

function TrackEditor({
  tracks, busy, onMove, onRemove, onAdd,
}: {
  tracks: LinkSettingsTrack[];
  busy: boolean;
  onMove: (index: number, delta: number) => void;
  onRemove: (index: number) => void;
  onAdd: (track: LinkSettingsTrack) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; rows: LinkSettingsTrack[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!adding) return;
    let alive = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: '20', lean: '1' });
      if (query.trim()) params.set('q', query.trim());
      fetch(`/api/tracks?${params}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          if (!alive) return;
          const rows = (Array.isArray(d) ? d : d.tracks ?? []) as Array<{ id: string; title: string | null; type: string | null; cover_url?: string | null }>;
          setResult({ query, failed: false, rows: rows.map((r) => ({ id: r.id, title: r.title ?? 'Untitled', type: r.type ?? 'track', cover_url: r.cover_url ?? null })) });
        })
        .catch(() => { if (alive) setResult({ query, rows: [], failed: true }); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [adding, query]);

  const loading = result?.query !== query;
  const state = !loading && result?.failed ? 'failed' : loading ? 'loading' : 'idle';
  const results = result?.rows ?? [];

  const onLink = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);
  const shown = results.filter((r) => !onLink.has(r.id)).slice(0, 6);

  return (
    <div className="space-y-2">
      <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
        {tracks.map((t, i) => (
          <li key={t.id} className="flex items-center gap-1.5 text-[11px] text-white">
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <button type="button" aria-label={`Move ${t.title} up`} disabled={busy || i === 0} onClick={() => onMove(i, -1)} className="flex size-6 items-center justify-center text-white/40 hover:text-white disabled:opacity-30"><ArrowUp size={11} /></button>
            <button type="button" aria-label={`Move ${t.title} down`} disabled={busy || i === tracks.length - 1} onClick={() => onMove(i, 1)} className="flex size-6 items-center justify-center text-white/40 hover:text-white disabled:opacity-30"><ArrowDown size={11} /></button>
            <button type="button" aria-label={`Remove ${t.title}`} disabled={busy || tracks.length === 1} title={tracks.length === 1 ? 'A link needs at least one track' : undefined} onClick={() => onRemove(i)} className="flex size-6 items-center justify-center text-white/40 hover:text-red-400 disabled:opacity-30"><X size={11} /></button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="space-y-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your tracks"
            aria-label="Search tracks to add"
            className="w-full rounded-lg border border-white/10 bg-[#090907] px-2.5 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/50 focus:outline-none"
          />
          {state === 'failed' ? (
            <p className="text-[10px] text-red-400">Couldn’t search tracks.</p>
          ) : shown.length === 0 ? (
            <p className="text-[10px] text-white/40">{state === 'loading' ? 'Searching…' : 'No tracks to add.'}</p>
          ) : (
            <ul className="space-y-0.5">
              {shown.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAdd(r)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    <Plus size={11} className="shrink-0 text-white/40" />
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/40">{r.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { setAdding(false); setQuery(''); }} className="text-[10px] uppercase tracking-wider text-white/60 hover:text-white">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-[11px] text-white/80 hover:text-white">
          <Plus size={11} /> Add tracks
        </button>
      )}
    </div>
  );
}
