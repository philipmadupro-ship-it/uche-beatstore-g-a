'use client';

/**
 * /store/projects/access/[token]
 *
 * Post-purchase delivery for project bundles, redesigned in the
 * Apple Vision Pro music-app aesthetic (glassmorphism card, top tab
 * nav, integrated cover panel, track rows with tag chip + heart +
 * actions menu). Keeps the project's antigravity palette — warm
 * dark glass on `#0a0907`, accent `#D4BFA0`.
 *
 * The 24-byte hex token in the URL is the access code; the email's
 * link is the secret.
 */

import { useEffect, useMemo, useState, use, useRef } from 'react';
import Link from 'next/link';
import {
  Loader2, Layers, Play, Pause, Music, Download, Lock, Mail,
  Globe, AtSign, Link2, Heart, MoreHorizontal, Headphones, Clock,
  Plus, Check, Copy,
} from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { useWishlist } from '@/hooks/useWishlist';
import { toast } from '@/hooks/useToast';
import { slugify } from '@/lib/slug';
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
      className="absolute right-0 top-9 z-30 w-44 rounded-xl bg-[#14110d]/95 backdrop-blur-xl border border-white/[0.10] shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-1.5"
    >
      {track.wav_url && (
        <a
          href={track.wav_url}
          download
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] transition-colors"
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
          className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] transition-colors"
        >
          <Download size={12} className="text-white/60" />
          Download MP3
        </a>
      )}
      <div className="my-1 mx-2 border-t border-white/[0.06]" />
      <button
        onClick={() => { onCopy(); onClose(); }}
        className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#E8DCC8] hover:bg-white/[0.06] transition-colors w-full text-left"
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

  const [project, setProject] = useState<AccessProject | null>(null);
  const [tracks, setTracks] = useState<AccessTrack[]>([]);
  const [creator, setCreator] = useState<AccessCreator | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [tab, setTab] = useState<'overview' | 'tracks' | 'producer'>('overview');
  const [following, setFollowing] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();
  const { has: isWishlisted, toggle: toggleWishlist } = useWishlist();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/projects/access/${token}`);
        if (res.status === 404) { setInvalid(true); return; }
        const data = await res.json();
        if (data.error) { setInvalid(true); return; }
        setProject(data.project);
        setTracks(data.tracks ?? []);
        setCreator(data.creator ?? null);
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

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

  const accent = creator?.accent_color || '#D4BFA0';
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
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#5a5142]" />
      </div>
    );
  }

  if (invalid || !project) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center gap-4 text-[#5a5142] px-6">
        <Lock size={36} />
        <p className="text-[14px] text-center max-w-sm">
          This access link is invalid or has expired. Check the email it came from for the latest code.
        </p>
        {creator?.contact_email && (
          <a href={`mailto:${creator.contact_email}`} className="text-[11px] underline hover:text-[#E8DCC8]">
            Contact the producer
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] px-4 md:px-6 pt-8 md:pt-12 pb-24">
      {/* Cover-tint backdrop (sits behind everything) */}
      {project.cover_url && (
        <>
          <div
            className="fixed inset-0 -z-10 bg-cover bg-center blur-3xl opacity-20 scale-110"
            style={{ backgroundImage: `url(${project.cover_url})` }}
            aria-hidden
          />
          <div
            className="fixed inset-0 -z-10"
            style={{
              background: `linear-gradient(180deg, ${accent}1a 0%, rgba(10,9,7,0.85) 50%, #0a0907 100%)`,
            }}
            aria-hidden
          />
        </>
      )}

      <div className="max-w-5xl mx-auto">
        {/* ── Glass card ─────────────────────────────────────── */}
        <div className="rounded-[28px] border border-white/[0.08] bg-[#14110d]/70 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] overflow-hidden">

          {/* Top tab nav */}
          <div className="flex items-center justify-center pt-5 pb-3 border-b border-white/[0.05]">
            <div className="flex items-center gap-7">
              {([
                ['overview', 'Overview'],
                ['tracks', 'Tracks'],
                ['producer', 'Producer'],
              ] as const).map(([k, label]) => {
                const active = tab === k;
                return (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`relative text-[13px] tracking-wide transition-colors ${active ? 'text-white' : 'text-white/45 hover:text-white/75'}`}
                  >
                    {label}
                    {active && (
                      <span
                        className="absolute -bottom-[10px] left-0 right-0 h-px"
                        style={{ backgroundColor: accent }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hero strip */}
          <div className="relative flex flex-col md:flex-row gap-6 px-6 md:px-10 py-8 md:py-10 border-b border-white/[0.05]">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/45">
                Project bundle
              </p>
              <h1 className="mt-1.5 text-3xl md:text-5xl font-semibold text-white leading-[1.05] tracking-tight font-heading break-words">
                {project.name}
              </h1>
              {creator?.display_name && (
                <div className="mt-3 min-w-0">
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="inline-block max-w-full text-[15px] md:text-[16px] text-white/90 font-medium hover:text-white transition-colors break-all"
                  >
                    {creator.display_name}
                  </Link>
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-white/55">
                <Headphones size={13} className="text-white/40" />
                <span>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'} Total</span>
                {totalDuration > 0 && (
                  <>
                    <span className="text-white/30">·</span>
                    <span>{fmtTotal(totalDuration)}</span>
                  </>
                )}
              </div>

              {/* Pill buttons row */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
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
              </div>
            </div>

            {/* Producer / cover panel — integrated into the card on the right */}
            <div className="relative w-full md:w-[280px] aspect-[16/10] md:aspect-square rounded-2xl overflow-hidden bg-[#0a0907] shrink-0">
              {creator?.hero_image_url ? (
                <img src={creator.hero_image_url} alt="" className="w-full h-full object-cover" />
              ) : project.cover_url ? (
                <img src={project.cover_url} alt={project.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
                  <Layers size={56} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
          </div>

          {/* Description — always visible (no longer gated by tab) so
              buyers see what they bought on first load. Same warm-sand
              styling as the pre-purchase /store/projects/[id] page. */}
          {project.description && (
            <div className="px-6 md:px-10 py-6 border-b border-white/[0.05]">
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-2">About this project</p>
              <p className="text-[13px] text-[#a08a6a] leading-relaxed whitespace-pre-line max-w-3xl">
                {project.description}
              </p>
            </div>
          )}

          {/* Body — switches per tab */}
          {tab === 'overview' && (
            <>
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
            </>
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
            <div className="px-6 md:px-10 py-8">
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-3">
                About the producer
              </p>
              {creator?.display_name ? (
                <>
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="text-[20px] font-semibold text-white hover:text-[#D4BFA0] transition-colors"
                  >
                    {creator.display_name}
                  </Link>
                  {creator.bio && (
                    <p className="mt-3 text-[13px] text-white/65 leading-relaxed max-w-2xl whitespace-pre-line">
                      {creator.bio}
                    </p>
                  )}
                  <div className="mt-5 flex items-center gap-2 flex-wrap">
                    {creator.instagram_handle && (
                      <a href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`}
                         target="_blank" rel="noopener noreferrer"
                         className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.10] transition-colors"
                         title="Instagram">
                        <AtSign size={14} />
                      </a>
                    )}
                    {creator.twitter_handle && (
                      <a href={`https://x.com/${creator.twitter_handle.replace(/^@/, '')}`}
                         target="_blank" rel="noopener noreferrer"
                         className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.10] transition-colors"
                         title="X / Twitter">
                        <Link2 size={14} />
                      </a>
                    )}
                    {creator.website_url && (
                      <a href={creator.website_url} target="_blank" rel="noopener noreferrer"
                         className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.10] transition-colors"
                         title="Website">
                        <Globe size={14} />
                      </a>
                    )}
                    {creator.contact_email && (
                      <a href={`mailto:${creator.contact_email}`}
                         className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.10] transition-colors"
                         title="Email">
                        <Mail size={14} />
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-white/50">Producer details unavailable.</p>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-[10px] font-mono text-white/25 text-center">
          Keep this link private — anyone holding it can download these files.
        </p>
      </div>
    </div>
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
        <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
        <p className="text-[12px] text-[#6a5d4a]">No tracks in this project yet.</p>
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
              <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#0a0907] border border-white/[0.06] shrink-0">
                {t.cover_url
                  ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>}
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
                  style={isCur ? { color: accent, fontWeight: 600 } : { color: '#E8DCC8' }}
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
                style={wishlisted ? { color: '#c8a84b' } : { color: 'rgba(255,255,255,0.45)' }}
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
