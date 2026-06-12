'use client';

/**
 * /store/projects/access/[token]
 *
 * Post-purchase delivery for project bundles, redesigned in the
 * Apple Vision Pro music-app aesthetic (glassmorphism card, top tab
 * nav, integrated cover panel, track rows with tag chip + heart +
 * actions menu). Keeps the project's antigravity palette — warm
 * dark glass on `#090907`, accent `#E7D7BE`.
 *
 * The 24-byte hex token in the URL is the access code; the email's
 * link is the secret.
 */

import { useEffect, useMemo, useState, use, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Loader2, Layers, Play, Pause, Music, Download, Lock, Mail,
  Heart, MoreHorizontal, Headphones, Clock,
  Plus, Check, Copy,
} from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { useWishlist } from '@/hooks/useWishlist';
import { toast } from '@/hooks/useToast';
import { GlassPage } from '@/components/store/GlassPage';
import { ProducerProfile } from '@/components/store/ProducerProfile';
import { ShareCardButton } from '@/components/store/ShareCardButton';
import { normalizeThemeColor } from '@/lib/theme/colors';
import type { Track } from '@/lib/types';

interface AccessTrack {
  id: string;
  title: string;
  type: string;
  audio_url: string | null;
  wav_url: string | null;
  peaks_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  tags?: { tag: string; category: string | null }[];
}

interface AccessProject {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  price_usd: number | null;
}

interface AccessCreator {
  display_name?: string | null;
  hero_image_url?: string | null;
  bio?: string | null;
  contact_email?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  website_url?: string | null;
  accent_color?: string | null;
}

function fmt(secs: number | null): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtTotal(secs: number): string {
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    return `${m} min`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function topTag(t: AccessTrack): string | null {
  const order = ['genre', 'mood', 'instrument'];
  const sorted = (t.tags ?? []).slice().sort(
    (a, b) => order.indexOf(a.category ?? '') - order.indexOf(b.category ?? ''),
  );
  return sorted[0]?.tag ?? null;
}

/* ─── Row context menu ────────────────────────────────────────── */

function RowMenu({
  track, onClose, onCopy, accent,
}: { track: AccessTrack; onClose: () => void; onCopy: () => void; accent: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-9 z-30 w-44 rounded-xl bg-[#171511]/95 backdrop-blur-xl border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-1.5"
    >
      {track.wav_url && (
        <a
          href={track.wav_url}
          download
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#F7EBDD] hover:bg-white/[0.06] transition-colors"
        >
          <Download size={12} style={{ color: accent }} />
          Download WAV
        </a>
      )}
      {track.audio_url && (
        <a
          href={track.audio_url}
          download
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#F7EBDD] hover:bg-white/[0.06] transition-colors"
        >
          <Download size={12} className="text-white/60" />
          Download MP3
        </a>
      )}
      <div className="my-1 mx-2 border-t border-white/[0.06]" />
      <button
        onClick={() => { onCopy(); onClose(); }}
        className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#F7EBDD] hover:bg-white/[0.06] transition-colors w-full text-left"
      >
        <Copy size={12} className="text-white/60" />
        Copy track title
      </button>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────── */

export default function ProjectAccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [tab, setTab] = useState<'overview' | 'tracks' | 'producer'>('overview');
  const [following, setFollowing] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();
  const { has: isWishlisted, toggle: toggleWishlist } = useWishlist();

  const { data, isLoading: loading, isError } = useQuery({
    queryKey: ['accessProject', token],
    queryFn: async () => {
      const res = await fetch(`/api/store/projects/access/${token}`);
      if (res.status === 404) throw new Error('Not found');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json as {
        project: AccessProject;
        tracks: AccessTrack[];
        creator: AccessCreator | null;
      };
    },
    retry: false,
  });
  const project = data?.project ?? null;
  const tracks = data?.tracks ?? [];
  const creator = data?.creator ?? null;
  const invalid = isError || (!loading && !project);

  // localStorage-backed follow (no auth required)
  useEffect(() => {
    if (!creator?.display_name) return;
    try {
      const raw = localStorage.getItem('antigravity-followed-producers');
      const set = new Set(raw ? (JSON.parse(raw) as string[]) : []);
      setFollowing(set.has(creator.display_name));
    } catch {/* noop */}
  }, [creator?.display_name]);
  const onToggleFollow = () => {
    if (!creator?.display_name) return;
    try {
      const raw = localStorage.getItem('antigravity-followed-producers');
      const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
      const name = creator.display_name;
      if (set.has(name)) { set.delete(name); setFollowing(false); toast.info('Unfollowed', name); }
      else { set.add(name); setFollowing(true); toast.success('Following', name); }
      localStorage.setItem('antigravity-followed-producers', JSON.stringify([...set]));
    } catch { /* noop */ }
  };

  const accent = normalizeThemeColor(creator?.accent_color);
  const totalDuration = useMemo(
    () => tracks.reduce((acc, t) => acc + (t.duration_seconds ?? 0), 0),
    [tracks],
  );

  const playAll = () => {
    if (tracks.length === 0) return;
    if (currentTrack && tracks.some((t) => t.id === currentTrack.id)) {
      togglePlay();
      return;
    }
    setQueue(tracks as unknown as Track[]);
    playTrack(tracks[0] as unknown as Track);
  };
  const anyOurTrackPlaying =
    isPlaying && currentTrack && tracks.some((t) => t.id === currentTrack.id);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#9B9282]" />
      </div>
    );
  }

  if (invalid || !project) {
    return (
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center gap-4 text-[#9B9282] px-6">
        <Lock size={36} />
        <p className="text-[14px] text-center max-w-sm">
          This access link is invalid or has expired. Check the email it came from for the latest code.
        </p>
        {creator?.contact_email && (
          <a href={`mailto:${creator.contact_email}`} className="text-[11px] underline hover:text-[#F7EBDD]">
            Contact the producer
          </a>
        )}
      </div>
    );
  }

  const heroMeta = (
    <>
      <Headphones size={13} className="text-white/40" />
      <span>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'} Total</span>
      {totalDuration > 0 && (
        <>
          <span className="text-white/30">·</span>
          <span>{fmtTotal(totalDuration)}</span>
        </>
      )}
    </>
  );

  const heroActions = (
    <>
      <button
        onClick={onToggleFollow}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] transition-colors ${following ? 'text-black' : 'bg-white/[0.08] border border-white/[0.10] text-white hover:bg-white/[0.14]'}`}
        style={following ? { backgroundColor: accent } : {}}
      >
        {following ? <Check size={12} /> : <Plus size={12} />}
        {following ? 'Following' : 'Follow'}
      </button>
      <button
        onClick={playAll}
        disabled={tracks.length === 0}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/[0.08] border border-white/[0.10] text-white text-[12px] hover:bg-white/[0.14] transition-colors disabled:opacity-40"
      >
        {anyOurTrackPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}
        {anyOurTrackPlaying ? 'Pause' : 'Play all'}
      </button>
      {tracks[0] && (
        <ShareCardButton
          trackId={tracks[0].id}
          trackTitle={project?.name ?? tracks[0].title}
          kind="licensed"
          accentColor={accent}
        />
      )}
    </>
  );

  return (
    <>
      <GlassPage coverUrl={project.cover_url} accentColor={accent}>
        <GlassPage.TabNav
          tabs={[
            ['overview', 'Overview'],
            ['tracks', 'Tracks'],
            ['producer', 'Producer'],
          ] as const}
          activeTab={tab}
          onTabChange={setTab}
          accentColor={accent}
        />
        <GlassPage.Hero
          eyebrow="Project bundle"
          title={project.name}
          producer={creator}
          meta={heroMeta}
          actions={heroActions}
          coverImage={creator?.hero_image_url || project.cover_url}
          coverFallback={<Layers size={56} />}
        />

        {project.description && (
          <GlassPage.Section eyebrow="About this project">
            <p className="text-[13px] text-[#D0C3AF] leading-relaxed whitespace-pre-line max-w-3xl">
              {project.description}
            </p>
          </GlassPage.Section>
        )}

        {tab === 'overview' && (
          <TrackList
            tracks={tracks}
            accent={accent}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playTrack={playTrack}
            togglePlay={togglePlay}
            setQueue={setQueue}
            isWishlisted={isWishlisted}
            toggleWishlist={toggleWishlist}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            heading="Top tracks"
            limit={4}
          />
        )}

        {tab === 'tracks' && (
          <TrackList
            tracks={tracks}
            accent={accent}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            playTrack={playTrack}
            togglePlay={togglePlay}
            setQueue={setQueue}
            isWishlisted={isWishlisted}
            toggleWishlist={toggleWishlist}
            menuFor={menuFor}
            setMenuFor={setMenuFor}
            heading="All tracks"
          />
        )}

        {tab === 'producer' && (
          <GlassPage.Section eyebrow="About the producer" noBorder className="px-6 md:px-10 py-8">
            <ProducerProfile creator={creator} />
          </GlassPage.Section>
        )}
      </GlassPage>

      <p className="text-[10px] font-mono text-white/25 text-center -mt-20 mb-8">
        Keep this link private — anyone holding it can download these files.
      </p>
    </>
  );
}

/* ─── Track list (shared between Overview + Tracks tabs) ──────── */

function TrackList({
  tracks, accent, currentTrack, isPlaying, playTrack, togglePlay, setQueue,
  isWishlisted, toggleWishlist, menuFor, setMenuFor, heading, limit,
}: {
  tracks: AccessTrack[];
  accent: string;
  currentTrack: Track | null;
  isPlaying: boolean;
  playTrack: (t: Track) => void;
  togglePlay: () => void;
  setQueue: (q: Track[]) => void;
  isWishlisted: (id: string) => boolean;
  toggleWishlist: (id: string) => void;
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  heading: string;
  limit?: number;
}) {
  const list = limit ? tracks.slice(0, limit) : tracks;
  const [hovered, setHovered] = useState<string | null>(null);

  if (tracks.length === 0) {
    return (
      <div className="px-6 md:px-10 py-10 text-center">
        <Music size={20} className="text-[#6E685B] mx-auto mb-2" />
        <p className="text-[12px] text-[#B4AA99]">No tracks in this project yet.</p>
      </div>
    );
  }

  return (
    <div className="px-2 md:px-4 pt-4 pb-2">
      <div className="px-4 md:px-6 mb-1 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-white">{heading}</h2>
      </div>

      <ul>
        {list.map((t, i) => {
          const isCur = currentTrack?.id === t.id;
          const isCurPlaying = isCur && isPlaying;
          const isHov = hovered === t.id;
          const tag = topTag(t);
          const wishlisted = isWishlisted(t.id);

          return (
            <li
              key={t.id}
              onMouseEnter={() => setHovered(t.id)}
              onMouseLeave={() => setHovered((v) => (v === t.id ? null : v))}
              className={`relative grid grid-cols-[44px_minmax(0,1fr)_auto] md:grid-cols-[44px_minmax(0,1.4fr)_minmax(0,1fr)_70px_28px_28px] gap-3 items-center px-4 md:px-6 py-2.5 rounded-2xl transition-colors ${isCur ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}
            >
              {/* Cover with hover-play overlay */}
              <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#090907] border border-white/[0.06] shrink-0">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={14} /></div>}
                {(isHov || isCur) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isCur) { togglePlay(); return; }
                      setQueue(tracks as unknown as Track[]);
                      playTrack(t as unknown as Track);
                    }}
                    aria-label={isCurPlaying ? 'Pause' : 'Play'}
                    className="absolute inset-0 flex items-center justify-center bg-black/55 text-white"
                  >
                    {isCurPlaying
                      ? <Pause size={13} fill="currentColor" />
                      : <Play size={13} fill="currentColor" className="ml-0.5" />}
                  </button>
                )}
              </div>

              {/* Title */}
              <div className="min-w-0">
                <p
                  className="text-[14px] truncate"
                  style={isCur ? { color: accent, fontWeight: 600 } : { color: '#F7EBDD' }}
                >
                  {t.title}
                </p>
              </div>

              {/* Tag chip + listen count */}
              <div className="hidden md:flex items-center gap-4 text-[11px] text-white/55 min-w-0">
                {tag && (
                  <span className="truncate text-white/70" style={{ color: accent }}>
                    #{tag}
                  </span>
                )}
                <span className="flex items-center gap-1 text-white/40 shrink-0">
                  <Headphones size={11} />
                  {t.bpm ? `${t.bpm} BPM` : '—'}
                </span>
              </div>

              {/* Duration */}
              <div className="hidden md:flex items-center gap-1 justify-end text-[11px] font-mono text-white/45 tabular-nums">
                <Clock size={11} />
                {fmt(t.duration_seconds)}
              </div>

              {/* Heart */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleWishlist(t.id); }}
                aria-pressed={wishlisted}
                title={wishlisted ? 'Remove from favorites' : 'Add to favorites'}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                style={wishlisted ? { color: '#D6BE7A' } : { color: 'rgba(255,255,255,0.45)' }}
              >
                <Heart size={13} fill={wishlisted ? 'currentColor' : 'none'} />
              </button>

              {/* Menu */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.id ? null : t.id); }}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.06] transition-colors"
                  title="More"
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuFor === t.id && (
                  <RowMenu
                    track={t}
                    onClose={() => setMenuFor(null)}
                    onCopy={() => {
                      try { navigator.clipboard.writeText(t.title); toast.success('Copied'); } catch {/* noop */}
                    }}
                    accent={accent}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {limit && tracks.length > limit && (
        <div className="px-6 mt-2">
          <p className="text-[11px] font-mono text-white/40">
            +{tracks.length - limit} more in <span className="text-white/65">Tracks</span> tab
          </p>
        </div>
      )}
    </div>
  );
}
