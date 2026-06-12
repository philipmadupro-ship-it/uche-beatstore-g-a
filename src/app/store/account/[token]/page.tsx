'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, AlertCircle, Music, Layers, Download, ExternalLink,
  CreditCard, Heart, History, ListMusic, Plus, Trash2,
} from 'lucide-react';
import { setBuyerToken } from '@/lib/buyer-session';
import { toast } from '@/hooks/useToast';

interface TrackLicense {
  id: string;
  kind: 'track';
  items: Array<{ track_id: string; license_id: string; license_type: string }>;
  amount_usd: number;
  created_at: string;
  status: string | null;
  stripe_session_id: string | null;
  download_url: string | null;
}

interface ProjectBundle {
  id: string;
  kind: 'project';
  project: { name: string; cover_url: string | null };
  project_id: string;
  amount_usd: number;
  created_at: string;
  stripe_session_id: string | null;
  download_url: string | null;
}

interface AccountData {
  email: string;
  track_licenses: TrackLicense[];
  project_bundles: ProjectBundle[];
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    // Persist the token so subsequent /store visits know who the buyer
    // is (logPlay, toggleFavorite, etc. become real DB writes instead
    // of localStorage-only). 24h expiry handled inside buyer-session.
    setBuyerToken(token);

    (async () => {
      try {
        const res = await fetch(`/api/store/account/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Could not load your account.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch('/api/store/account/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      window.location.href = json.url;
    } catch (err: any) {
      setPortalError(err.message || 'Could not open Stripe portal.');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#837B6D]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#090907] text-[#F7EBDD] flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <AlertCircle size={28} className="text-red-400 mx-auto mb-3" />
          <p className="text-[14px] font-medium text-[#F7EBDD] mb-1">Couldn't open your account</p>
          <p className="text-[11px] text-[#D0C3AF] mb-5">{error || 'Unknown error.'}</p>
          <Link
            href="/store/account"
            className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-md bg-[#E7D7BE] text-black hover:bg-[#F3E6D1] transition-colors"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  const totalSpent =
    data.track_licenses.reduce((s, r) => s + r.amount_usd, 0) +
    data.project_bundles.reduce((s, r) => s + r.amount_usd, 0);
  const purchaseCount = data.track_licenses.length + data.project_bundles.length;
  const isEmpty = purchaseCount === 0;

  return (
    <div className="min-h-screen bg-[#090907] text-[#F7EBDD]">
      <div className="max-w-[760px] mx-auto px-4 py-10 md:py-14">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] hover:text-[#F7EBDD] transition-colors mb-8"
        >
          <ArrowLeft size={12} />
          Back to store
        </Link>

        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#D0C3AF] mb-2">My account</p>
        <h1 className="text-[28px] sm:text-[36px] font-bold text-white leading-none tracking-tight font-heading">
          Your purchases
        </h1>
        <p className="mt-2 text-[12px] text-[#B4AA99]">
          Signed in as <span className="text-[#F7EBDD]">{data.email}</span>.
        </p>

        {!isEmpty && (
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="rounded-xl border border-[#2B2821] bg-[#171511] px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">Purchases</p>
              <p className="text-[20px] font-bold text-white tabular-nums mt-1">{purchaseCount}</p>
            </div>
            <div className="rounded-xl border border-[#2B2821] bg-[#171511] px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282]">Total spent</p>
              <p className="text-[20px] font-bold text-white tabular-nums mt-1">{fmtMoney(totalSpent)}</p>
            </div>
          </div>
        )}

        {isEmpty ? (
          <div className="mt-10 rounded-2xl border border-[#2B2821] bg-[#171511] px-6 py-16 text-center">
            <Music size={28} className="text-[#6E685B] mx-auto mb-3" />
            <p className="text-[14px] text-[#F7EBDD] font-medium mb-1">No purchases yet</p>
            <p className="text-[12px] text-[#B4AA99] max-w-md mx-auto mb-5">
              Once you license a beat or buy a project bundle, it'll show up here. The link in this URL stays valid for 24h.
            </p>
            <Link
              href="/store"
              className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-md bg-[#E7D7BE] text-black hover:bg-[#F3E6D1] transition-colors"
            >
              Browse beats
            </Link>
          </div>
        ) : (
          <>
            {data.project_bundles.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF] mb-3 flex items-center gap-2">
                  <Layers size={11} />
                  Project bundles ({data.project_bundles.length})
                </h2>
                <ul className="space-y-2">
                  {data.project_bundles.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-3 rounded-xl border border-[#2B2821] bg-[#171511] px-3 py-3"
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-[#090907] border border-[#2B2821] shrink-0">
                        {b.project.cover_url
                          ? <img src={b.project.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Layers size={14} /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#F7EBDD] truncate">{b.project.name}</p>
                        <p className="text-[10px] font-mono text-[#9B9282] mt-0.5">
                          {fmtDate(b.created_at)} · {fmtMoney(b.amount_usd)}
                        </p>
                      </div>
                      {b.download_url && (
                        <a
                          href={b.download_url}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider bg-[#E7D7BE] text-black hover:bg-[#F3E6D1] transition-colors"
                        >
                          <Download size={11} />
                          Open
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.track_licenses.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF] mb-3 flex items-center gap-2">
                  <Music size={11} />
                  Track licenses ({data.track_licenses.length})
                </h2>
                <ul className="space-y-2">
                  {data.track_licenses.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-xl border border-[#2B2821] bg-[#171511] px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[#F7EBDD]">
                            {r.items.length} track{r.items.length === 1 ? '' : 's'} · {fmtMoney(r.amount_usd)}
                          </p>
                          <p className="text-[10px] font-mono text-[#9B9282] mt-0.5">
                            {fmtDate(r.created_at)}{r.status ? ` · ${r.status}` : ''}
                          </p>
                        </div>
                        {r.download_url && (
                          <a
                            href={r.download_url}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/[0.10] text-[#F7EBDD] hover:bg-white/[0.12] transition-colors"
                          >
                            <Download size={11} />
                            Open
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-10 rounded-2xl border border-[#2B2821] bg-[#171511] px-5 py-5">
              <div className="flex items-start gap-3">
                <CreditCard size={16} className="text-[#D0C3AF] mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-[12px] font-medium text-[#F7EBDD]">Invoices &amp; payment methods</p>
                  <p className="text-[11px] text-[#B4AA99] mt-1 leading-relaxed">
                    Manage your Stripe-side payment details, download invoices, or update billing email.
                  </p>
                  {portalError && (
                    <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded px-3 py-2 mt-3">
                      {portalError}
                    </p>
                  )}
                </div>
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider border border-[#3B372F] text-[#F7EBDD] hover:border-[#6E685B] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
                >
                  {portalLoading
                    ? <Loader2 size={11} className="animate-spin" />
                    : <ExternalLink size={11} />}
                  Open portal
                </button>
              </div>
            </section>
          </>
        )}

        {/* ── Library — listening history, favorites, custom playlists
            (migration 060). Shown for every magic-linked buyer
            regardless of purchase status. */}
        <BuyerLibrary token={token} />

        <footer className="mt-10 pt-6 border-t border-[#211F1A]">
          <p className="text-[10px] font-mono text-[#6E685B] leading-relaxed">
            This link expires 24h after you requested it. If it stops working,{' '}
            <Link href="/store/account" className="text-[#B4AA99] hover:text-[#F7EBDD] underline underline-offset-2">
              request a fresh one
            </Link>.
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ─── Buyer Library — history + favorites + playlists ─────────── */

interface LibraryHistoryRow { track_id: string; played_at: string }
interface LibraryFavRow { track_id: string; created_at: string }
interface LibraryPlaylist {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  track_ids: string[];
}
interface LibraryShape {
  email: string;
  history: LibraryHistoryRow[];
  favorites: LibraryFavRow[];
  playlists: LibraryPlaylist[];
}

function BuyerLibrary({ token }: { token: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['buyerLibrary', token],
    queryFn: async () => {
      const res = await fetch(`/api/store/me?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as LibraryShape;
    },
    retry: false,
  });

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['buyerLibrary', token] });

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/store/me?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_playlist', name }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      return j.playlist as LibraryPlaylist;
    },
    onSuccess: () => { setNewPlaylistName(''); toast.success('Playlist created'); refresh(); },
    onError: (e: Error) => toast.error('Could not create', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (playlist_id: string) => {
      const res = await fetch(`/api/store/me?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_playlist', playlist_id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => { toast.success('Playlist deleted'); refresh(); },
    onError: (e: Error) => toast.error('Could not delete', e.message),
  });

  if (isLoading) {
    return (
      <section className="mt-10 pt-6 border-t border-[#211F1A]">
        <Loader2 size={16} className="animate-spin text-[#9B9282]" />
      </section>
    );
  }
  if (!data) return null;

  const recentHistory = data.history.slice(0, 12);

  return (
    <section className="mt-10 pt-8 border-t border-[#211F1A]">
      <h2 className="text-[16px] font-medium text-[#F7EBDD] mb-5">My library</h2>

      {/* History */}
      <div className="rounded-2xl border border-[#2B2821] bg-[#171511] px-5 py-4 mb-5">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF] mb-3">
          <History size={11} />
          Recently played
        </p>
        {recentHistory.length === 0 ? (
          <p className="text-[12px] text-white/40">Listen to a beat on the store and it'll show up here.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {recentHistory.map((r, i) => (
              <li key={`${r.track_id}-${r.played_at}-${i}`}>
                <Link
                  href={`/store/${r.track_id}`}
                  className="block px-3 py-2 rounded-lg bg-white/[0.03] border border-[#2B2821] hover:bg-white/[0.06] hover:border-[#3B372F] transition-colors"
                >
                  <p className="text-[11px] text-[#F7EBDD] truncate font-mono">{r.track_id.slice(0, 8)}</p>
                  <p className="text-[9px] text-white/40 font-mono">
                    {new Date(r.played_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Favorites */}
      <div className="rounded-2xl border border-[#2B2821] bg-[#171511] px-5 py-4 mb-5">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF] mb-3">
          <Heart size={11} className="text-[#D6BE7A]" fill="currentColor" />
          Favorites ({data.favorites.length})
        </p>
        {data.favorites.length === 0 ? (
          <p className="text-[12px] text-white/40">Tap the heart on any beat to save it here, synced across your devices.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {data.favorites.map((f) => (
              <li key={f.track_id}>
                <Link
                  href={`/store/${f.track_id}`}
                  className="block px-3 py-2 rounded-lg bg-white/[0.03] border border-[#2B2821] hover:bg-white/[0.06] hover:border-[#3B372F] transition-colors"
                >
                  <p className="text-[11px] text-[#F7EBDD] truncate font-mono">{f.track_id.slice(0, 8)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Playlists */}
      <div className="rounded-2xl border border-[#2B2821] bg-[#171511] px-5 py-4">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF] mb-3">
          <ListMusic size={11} />
          My playlists ({data.playlists.length})
        </p>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            placeholder="New playlist name"
            maxLength={80}
            onKeyDown={(e) => { if (e.key === 'Enter' && newPlaylistName.trim()) createMut.mutate(newPlaylistName.trim()); }}
            className="flex-1 bg-[#090907] border border-[#2B2821] rounded-lg px-3 py-2 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
          />
          <button
            type="button"
            onClick={() => createMut.mutate(newPlaylistName.trim())}
            disabled={!newPlaylistName.trim() || createMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#E7D7BE] text-black text-[11px] font-bold uppercase tracking-wider hover:bg-[#F3E6D1] transition-colors disabled:opacity-40"
          >
            {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Create
          </button>
        </div>
        {data.playlists.length === 0 ? (
          <p className="text-[12px] text-white/40">Build your own mixtapes from the producer's catalogue.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.playlists.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-[#2B2821]"
              >
                <ListMusic size={12} className="text-[#9B9282]" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[#F7EBDD] truncate">{p.name}</p>
                  <p className="text-[10px] font-mono text-[#9B9282]">{p.track_ids.length} tracks · updated {new Date(p.updated_at).toLocaleDateString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete playlist "${p.name}"?`)) deleteMut.mutate(p.id);
                  }}
                  title="Delete"
                  className="w-7 h-7 rounded-md border border-[#2B2821] flex items-center justify-center text-[#9B9282] hover:text-red-400 hover:border-red-900/40 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
