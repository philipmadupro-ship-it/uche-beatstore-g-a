'use client';

/**
 * /store/account/me — buyer account dashboard, session-gated.
 *
 * Reached after a Supabase magic-link OTP sign-in (from /store/account).
 * The auth session cookie persists across devices and browser restarts —
 * unlike the legacy 24h HMAC token, this is a real persistent account.
 *
 * Data sources:
 *  - /api/store/account/me — purchases (same shape as [token] route)
 *  - /api/store/me?session=1 — listening history, favorites, playlists
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, AlertCircle, Music, Layers, Download, ExternalLink,
  CreditCard, Heart, History, ListMusic, Plus, Trash2, LogOut,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from '@/hooks/useToast';
import { setPersistentBuyerSession } from '@/lib/buyer-session';
import { BuyerLibraryTile, buyerTrackTitles } from '@/components/store/BuyerLibraryTile';
import { CoverImage } from '@/components/ui/CoverImage';
import type { BuyerLibraryShape, BuyerLibraryPlaylist } from '@/lib/store/buyer-library';

interface TrackLicense {
  id: string;
  kind: 'track';
  items: Array<{ track_id: string; license_id: string; license_type: string; title?: string | null }>;
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

export default function BuyerMePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        setPersistentBuyerSession(false);
        router.replace('/store/account');
      } else {
        setUserEmail(data.user.email ?? null);
        setPersistentBuyerSession(true);
        setAuthChecked(true);
      }
    });
  }, [router]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setPersistentBuyerSession(false);
    router.push('/store');
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['buyerMePurchases'],
    queryFn: async () => {
      const res = await fetch('/api/store/account/me');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      return j as AccountData;
    },
    enabled: authChecked,
    retry: false,
  });

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-white/40" />
      </div>
    );
  }

  if (isError || (data && !data.email)) {
    const msg = (error as Error)?.message || 'Could not load your account.';
    return (
      <div className="min-h-screen bg-[#090907] text-white flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <AlertCircle size={28} className="text-red-400 mx-auto mb-3" />
          <p className="text-[14px] font-medium text-white mb-1">Couldn&apos;t open your account</p>
          <p className="text-[11px] text-white/80 mb-5">{msg}</p>
          <Link
            href="/store/account"
            className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-md bg-white text-black hover:bg-white transition-colors"
          >
            Sign in again
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-white/40" />
      </div>
    );
  }

  const totalSpent =
    data.track_licenses.reduce((s, r) => s + r.amount_usd, 0) +
    data.project_bundles.reduce((s, r) => s + r.amount_usd, 0);
  const purchaseCount = data.track_licenses.length + data.project_bundles.length;
  const isEmpty = purchaseCount === 0;

  return (
    <div className="min-h-screen bg-[#090907] text-white">
      <div className="max-w-[760px] mx-auto px-4 py-10 md:py-14">
        <div className="flex items-center justify-between mb-8">
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft size={12} />
            Back to store
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/60 hover:text-white transition-colors"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>

        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/80 mb-2">My account</p>
        <h1 className="text-[28px] sm:text-[36px] font-bold text-white leading-none tracking-tight font-heading">
          Your purchases
        </h1>
        <p className="mt-2 text-[12px] text-white/60">
          Signed in as <span className="text-white">{data.email}</span>.
        </p>

        {!isEmpty && (
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-wider text-white/40">Purchases</p>
              <p className="text-[20px] font-bold text-white tabular-nums mt-1">{purchaseCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-wider text-white/40">Total spent</p>
              <p className="text-[20px] font-bold text-white tabular-nums mt-1">{fmtMoney(totalSpent)}</p>
            </div>
          </div>
        )}

        {isEmpty ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-16 text-center">
            <Music size={28} className="text-white/40 mx-auto mb-3" />
            <p className="text-[14px] text-white font-medium mb-1">No purchases yet</p>
            <p className="text-[12px] text-white/60 max-w-md mx-auto mb-5">
              Once you license a beat or buy a project bundle, it&apos;ll show up here.
            </p>
            <Link
              href="/store"
              className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-md bg-white text-black hover:bg-white transition-colors"
            >
              Browse beats
            </Link>
          </div>
        ) : (
          <>
            {data.project_bundles.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-3 flex items-center gap-2">
                  <Layers size={11} />
                  Project bundles ({data.project_bundles.length})
                </h2>
                <ul className="space-y-2">
                  {data.project_bundles.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-[#090907] border border-white/10 shrink-0">
                        {b.project.cover_url
                          ? <CoverImage src={b.project.cover_url} alt="" className="object-cover" sizes="48px" />
                          : <div className="w-full h-full flex items-center justify-center text-white/40"><Layers size={14} /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate">{b.project.name}</p>
                        <p className="text-[10px] font-mono text-white/40 mt-0.5">
                          {fmtDate(b.created_at)} · {fmtMoney(b.amount_usd)}
                        </p>
                      </div>
                      {b.download_url && (
                        <a
                          href={b.download_url}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white text-black hover:bg-white transition-colors"
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
                <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-3 flex items-center gap-2">
                  <Music size={11} />
                  Track licenses ({data.track_licenses.length})
                </h2>
                <ul className="space-y-2">
                  {data.track_licenses.map((r) => (
                    <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-white truncate">
                            {r.items.map((i) => i.title).filter(Boolean).join(' · ')
                              || `${r.items.length} track${r.items.length === 1 ? '' : 's'}`}
                          </p>
                          <p className="text-[10px] font-mono text-white/40 mt-0.5">
                            {fmtDate(r.created_at)} · {fmtMoney(r.amount_usd)}
                            {r.items[0]?.license_type ? ` · ${r.items[0].license_type}` : ''}
                            {r.status ? ` · ${r.status}` : ''}
                          </p>
                        </div>
                        {r.download_url && (
                          <a
                            href={r.download_url}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/[0.10] text-white hover:bg-white/[0.12] transition-colors"
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

            <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5">
              <div className="flex items-start gap-3">
                <CreditCard size={16} className="text-white/80 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-[12px] font-medium text-white">Invoices &amp; payment methods</p>
                  <p className="text-[11px] text-white/60 mt-1 leading-relaxed">
                    Manage your Stripe-side payment details, download invoices, or update billing email.
                  </p>
                </div>
                <a
                  href={`https://billing.stripe.com/p/login/start?email=${encodeURIComponent(userEmail ?? data.email)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider border border-white/20 text-white hover:border-white/40 hover:bg-white/[0.04] transition-colors"
                >
                  <ExternalLink size={11} />
                  Open portal
                </a>
              </div>
            </section>
          </>
        )}

        <SessionLibrary />

        <footer className="mt-10 pt-6 border-t border-white/10">
          <p className="text-[10px] font-mono text-white/40 leading-relaxed">
            You&apos;re signed in with a persistent session — no link expiry.{' '}
            <button onClick={handleSignOut} className="text-white/60 hover:text-white underline underline-offset-2">
              Sign out
            </button>{' '}
            any time.
          </p>
        </footer>
      </div>
    </div>
  );
}

function SessionLibrary() {
  const queryClient = useQueryClient();
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['buyerMeLibrary'],
    queryFn: async () => {
      const res = await fetch('/api/store/me?session=1');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as BuyerLibraryShape;
    },
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['buyerMeLibrary'] });

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/store/me?session=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_playlist', name }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      return j.playlist as BuyerLibraryPlaylist;
    },
    onSuccess: () => { setNewPlaylistName(''); toast.success('Playlist created'); refresh(); },
    onError: (e: Error) => toast.error('Could not create', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (playlist_id: string) => {
      const res = await fetch('/api/store/me?session=1', {
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
      <section className="mt-10 pt-6 border-t border-white/10">
        <Loader2 size={16} className="animate-spin text-white/40" />
      </section>
    );
  }
  if (!data) return null;

  const recentHistory = data.history.slice(0, 12);

  return (
    <section className="mt-10 pt-8 border-t border-white/10">
      <h2 className="text-[16px] font-medium text-white mb-5">My library</h2>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 mb-5">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-3">
          <History size={11} />
          Recently played
        </p>
        {recentHistory.length === 0 ? (
          <p className="text-[12px] text-white/40">Listen to a beat on the store and it&apos;ll show up here.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {recentHistory.map((r, i) => (
              <li key={`${r.track_id}-${r.played_at}-${i}`}>
                <BuyerLibraryTile
                  track={r.track}
                  subline={new Date(r.played_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 mb-5">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-3">
          <Heart size={11} className="text-white" fill="currentColor" />
          Favorites ({data.favorites.length})
        </p>
        {data.favorites.length === 0 ? (
          <p className="text-[12px] text-white/40">Tap the heart on any beat to save it here, synced across your devices.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {data.favorites.map((f) => (
              <li key={f.track_id}>
                <BuyerLibraryTile track={f.track} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
        <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-3">
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
            className="flex-1 bg-[#090907] border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
          />
          <button
            type="button"
            onClick={() => createMut.mutate(newPlaylistName.trim())}
            disabled={!newPlaylistName.trim() || createMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-white text-black text-[11px] font-bold uppercase tracking-wider hover:bg-white transition-colors disabled:opacity-40"
          >
            {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Create
          </button>
        </div>
        {data.playlists.length === 0 ? (
          <p className="text-[12px] text-white/40">Build your own mixtapes from the producer&apos;s catalogue.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.playlists.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
                <ListMusic size={12} className="text-white/40" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-white truncate">{p.name}</p>
                  <p className="text-[10px] font-mono text-white/40">
                    {p.track_ids.length} tracks · {buyerTrackTitles(p.tracks)} · updated {new Date(p.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete playlist "${p.name}"?`)) deleteMut.mutate(p.id);
                  }}
                  title="Delete"
                  className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center text-white/40 hover:text-red-400 hover:border-red-900/40 transition-colors"
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
