'use client';

/**
 * /store/projects/[id]
 *
 * Pre-purchase project detail page. VisionOS-glass aesthetic, same
 * shell as /store/projects/access/[token] for visual continuity
 * between "I'm browsing" and "I just bought it." Big bundle-price
 * CTA in the hero replaces the access page's Follow/Play-all pair.
 */

import { useEffect, useMemo, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2, Layers, Play, Pause, Music, ShoppingCart,
  Mail, Globe, AtSign, Link2, Headphones, Clock,
} from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { slugify } from '@/lib/slug';
import type { Track } from '@/lib/types';

interface ProjectTrack {
  id: string;
  title: string;
  type: string;
  audio_url: string | null;
  peaks_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  lease_price_usd: number | null;
  exclusive_price_usd: number | null;
  free_download_enabled: boolean | null;
}

interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  price_usd: number | null;
  store_featured: boolean;
  created_at: string;
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
function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function StoreProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tracks, setTracks] = useState<ProjectTrack[]>([]);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<'overview' | 'tracks' | 'producer'>('overview');

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/projects/${id}`);
        if (res.status === 404) { setNotFound(true); return; }
        const data = await res.json();
        if (data.error) { setNotFound(true); return; }
        setProject(data.project);
        setTracks(data.tracks ?? []);
        setCreator(data.creator ?? null);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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

  const handleBuy = () => {
    if (!project) return;
    router.push(`/store/checkout?project_id=${project.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#5a5142]" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex flex-col items-center justify-center gap-4 text-[#5a5142]">
        <Layers size={36} />
        <p className="text-[14px]">Project not found or not listed.</p>
        <Link href="/store" className="text-[12px] underline hover:text-[#E8DCC8]">← Back to store</Link>
      </div>
    );
  }

  const buyable = project.price_usd != null && Number(project.price_usd) > 0;

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] px-4 md:px-6 pt-8 md:pt-12 pb-24">
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

          {/* Hero */}
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
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-white/55 flex-wrap">
                <Headphones size={13} className="text-white/40" />
                <span>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'} Total</span>
                {totalDuration > 0 && (
                  <>
                    <span className="text-white/30">·</span>
                    <span>{fmtTotal(totalDuration)}</span>
                  </>
                )}
              </div>

              {/* Bundle price + Buy / Play row */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {buyable && (
                  <button
                    onClick={handleBuy}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full text-black text-[12px] font-bold tracking-wide transition-transform hover:scale-[1.02] active:scale-[0.98]"
                    style={{ backgroundColor: accent }}
                  >
                    <ShoppingCart size={13} />
                    Buy bundle — {fmtPrice(project.price_usd)}
                  </button>
                )}
                <button
                  onClick={playAll}
                  disabled={tracks.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/[0.08] border border-white/[0.10] text-white text-[12px] hover:bg-white/[0.14] transition-colors disabled:opacity-40"
                >
                  {anyOurTrackPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}
                  Preview
                </button>
                {!buyable && (
                  <span className="text-[11px] font-mono text-white/45">
                    Bundle price not set by the producer.
                  </span>
                )}
              </div>
            </div>

            <div className="relative w-full md:w-[280px] aspect-[16/10] md:aspect-square rounded-2xl overflow-hidden bg-[#0a0907] shrink-0">
              {project.cover_url ? (
                <img src={project.cover_url} alt={project.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
                  <Layers size={56} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
          </div>

          {tab === 'overview' && (
            <>
              {project.description && (
                <div className="px-6 md:px-10 py-6 border-b border-white/[0.05]">
                  <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40 mb-2">About this project</p>
                  <p className="text-[13px] text-[#a08a6a] leading-relaxed whitespace-pre-line max-w-3xl">
                    {project.description}
                  </p>
                </div>
              )}
              <TrackList
                tracks={tracks}
                accent={accent}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                playTrack={playTrack}
                togglePlay={togglePlay}
                setQueue={setQueue}
                heading="Tracks in this bundle"
                limit={5}
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
          Buy the bundle to unlock WAV downloads + producer-direct access.
        </p>
      </div>
    </div>
  );
}

/* ─── Track list (pre-purchase: preview-only, no downloads) ───── */

function TrackList({
  tracks, accent, currentTrack, isPlaying, playTrack, togglePlay, setQueue,
  heading, limit,
}: {
  tracks: ProjectTrack[];
  accent: string;
  currentTrack: Track | null;
  isPlaying: boolean;
  playTrack: (t: Track) => void;
  togglePlay: () => void;
  setQueue: (q: Track[]) => void;
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
        {list.map((t) => {
          const isCur = currentTrack?.id === t.id;
          const isCurPlaying = isCur && isPlaying;
          const isHov = hovered === t.id;

          return (
            <li
              key={t.id}
              onMouseEnter={() => setHovered(t.id)}
              onMouseLeave={() => setHovered((v) => (v === t.id ? null : v))}
              className={`grid grid-cols-[44px_minmax(0,1fr)_auto] md:grid-cols-[44px_minmax(0,1.4fr)_minmax(0,1fr)_70px] gap-3 items-center px-4 md:px-6 py-2.5 rounded-2xl transition-colors ${isCur ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}
            >
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

              <div className="min-w-0">
                <p
                  className="text-[14px] truncate"
                  style={isCur ? { color: accent, fontWeight: 600 } : { color: '#E8DCC8' }}
                >
                  {t.title}
                </p>
                <p className="text-[11px] text-white/45 truncate">
                  {t.type}{t.free_download_enabled ? ' · free download' : ''}
                </p>
              </div>

              <div className="hidden md:flex items-center gap-4 text-[11px] text-white/55 min-w-0">
                <span className="flex items-center gap-1 text-white/40 shrink-0">
                  <Headphones size={11} />
                  {t.bpm ? `${t.bpm} BPM` : '—'}
                </span>
                {t.key && (
                  <span className="text-white/40 shrink-0">
                    {t.key}{t.scale === 'minor' ? 'm' : ''}
                  </span>
                )}
              </div>

              <div className="hidden md:flex items-center gap-1 justify-end text-[11px] font-mono text-white/45 tabular-nums">
                <Clock size={11} />
                {fmt(t.duration_seconds)}
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
