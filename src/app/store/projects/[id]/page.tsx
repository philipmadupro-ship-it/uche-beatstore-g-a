'use client';

/**
 * /store/projects/[id]
 *
 * Public project detail page. Shows the cover, description, full track
 * list, and a Buy button when the producer has set a project-level
 * price_usd. Tracks are clickable via the persistent PlayerBar (mounted
 * by the /store layout).
 */

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Play, Pause, Music, Clock, ShoppingCart, Loader2,
  Layers, AtSign, Link2, Globe, Mail,
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
  spotify_url?: string | null;
  soundcloud_url?: string | null;
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

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tracks, setTracks] = useState<ProjectTrack[]>([]);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const { currentTrack, isPlaying, setTrack: playTrack, togglePlay, setQueue } = usePlayer();
  const router = useRouter();

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

  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration_seconds ?? 0), 0);
  const playFirst = () => {
    if (!tracks.length) return;
    setQueue(tracks as unknown as Track[]);
    playTrack(tracks[0] as unknown as Track);
  };

  const handleBuy = () => {
    router.push(`/store/checkout?project_id=${project!.id}`);
  };

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      {/* Back breadcrumb */}
      <div className="max-w-6xl mx-auto px-4 md:px-10 pt-6">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] transition-colors"
        >
          <ArrowLeft size={11} />
          Back to store
        </Link>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-10 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(260px,360px)_1fr] gap-6 md:gap-14 items-start">
          {/* LEFT: cover + meta */}
          <div className="flex flex-col gap-4 md:sticky md:top-24">
            <button
              onClick={playFirst}
              disabled={!tracks.length}
              className="relative w-full aspect-square rounded-2xl overflow-hidden bg-[#14110d] border border-[#1f1a13] group shadow-[0_16px_60px_rgba(0,0,0,0.6)] disabled:opacity-90 disabled:cursor-default"
            >
              {project.cover_url ? (
                <img
                  src={project.cover_url}
                  alt={project.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2A2418] to-[#0a0907] text-[#5a5142]">
                  <Layers size={56} />
                </div>
              )}
              {tracks.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center shadow-2xl">
                    <Play size={30} className="ml-1" fill="currentColor" />
                  </div>
                </div>
              )}
            </button>

            {creator && (
              <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#5a5142] mb-2">Producer</p>
                {creator.display_name ? (
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="text-[14px] font-semibold text-[#E8DCC8] hover:text-[#D4BFA0] transition-colors"
                  >
                    {creator.display_name}
                  </Link>
                ) : (
                  <p className="text-[14px] font-semibold text-[#E8DCC8]">Producer</p>
                )}
                {creator.bio && (
                  <p className="text-[11px] text-[#6a5d4a] mt-1.5 leading-relaxed line-clamp-3">
                    {creator.bio}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  {creator.instagram_handle && (
                    <a
                      href={`https://instagram.com/${creator.instagram_handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono text-[#5a5142] hover:text-[#E8DCC8] transition-colors flex items-center gap-1"
                    >
                      <AtSign size={11} />
                      {creator.instagram_handle.replace(/^@/, '')}
                    </a>
                  )}
                  {creator.twitter_handle && (
                    <a
                      href={`https://twitter.com/${creator.twitter_handle.replace(/^@/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono text-[#5a5142] hover:text-[#E8DCC8] transition-colors flex items-center gap-1"
                    >
                      <Link2 size={11} />
                      {creator.twitter_handle.replace(/^@/, '')}
                    </a>
                  )}
                  {creator.website_url && (
                    <a
                      href={creator.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#5a5142] hover:text-[#E8DCC8] transition-colors"
                    >
                      <Globe size={14} />
                    </a>
                  )}
                  {creator.contact_email && (
                    <a
                      href={`mailto:${creator.contact_email}`}
                      className="text-[#5a5142] hover:text-[#E8DCC8] transition-colors"
                    >
                      <Mail size={14} />
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: project details */}
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-2">
                Project
              </p>
              <h1 className="text-2xl md:text-4xl font-bold text-white leading-tight tracking-tight">
                {project.name}
              </h1>
              {creator?.display_name && (
                <p className="mt-1 text-[13px] text-[#6a5d4a]">
                  prod.{' '}
                  <Link
                    href={`/store/producer/${slugify(creator.display_name)}`}
                    className="text-[#a08a6a] hover:text-[#D4BFA0] transition-colors"
                  >
                    {creator.display_name}
                  </Link>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#14110d] border border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider text-[#a08a6a]">
                  <Music size={9} />
                  {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
                </div>
                {totalDuration > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#14110d] border border-[#1f1a13] text-[10px] font-mono uppercase tracking-wider text-[#a08a6a]">
                    <Clock size={9} />
                    {fmt(totalDuration)}
                  </div>
                )}
              </div>
            </div>

            {/* Price + Buy */}
            {project.price_usd != null && Number(project.price_usd) > 0 && (
              <div className="rounded-2xl border border-[#D4BFA0]/30 bg-gradient-to-b from-[#1f1a13] to-[#14110d] p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">
                    Bundle Price
                  </p>
                  <p className="text-[32px] font-bold text-white leading-none mt-1 tabular-nums">
                    {fmtPrice(project.price_usd)}
                  </p>
                  <p className="text-[10px] text-[#6a5d4a] mt-1">
                    All tracks in this project, delivered together.
                  </p>
                </div>
                <button
                  onClick={handleBuy}
                  className="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl bg-[#D4BFA0] hover:bg-[#E8D8B8] text-black text-[12px] font-bold uppercase tracking-wider transition-colors"
                >
                  <ShoppingCart size={13} />
                  Buy bundle
                </button>
              </div>
            )}

            {/* Description */}
            {project.description && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">
                  About this project
                </p>
                <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-4">
                  <p className="text-[13px] text-[#a08a6a] leading-relaxed whitespace-pre-line">
                    {project.description}
                  </p>
                </div>
              </div>
            )}

            {/* Track list */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">
                Tracks
              </p>
              {tracks.length === 0 ? (
                <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-5 py-6 text-center">
                  <Music size={20} className="text-[#3a3328] mx-auto mb-2" />
                  <p className="text-[12px] text-[#6a5d4a]">No tracks in this project yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] overflow-hidden divide-y divide-[#1a160f]">
                  {tracks.map((t, i) => {
                    const isCur = currentTrack?.id === t.id;
                    const isCurPlaying = isCur && isPlaying;
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-[#16130e] transition-colors ${isCur ? 'bg-[#16130e]' : ''}`}
                      >
                        <button
                          onClick={() => {
                            if (isCur) { togglePlay(); return; }
                            setQueue(tracks as unknown as Track[]);
                            playTrack(t as unknown as Track);
                          }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            isCur ? 'bg-[#D4BFA0] text-black' : 'bg-white/[0.06] text-[#a08a6a] hover:bg-white/[0.12] hover:text-white'
                          }`}
                        >
                          {isCurPlaying
                            ? <Pause size={11} fill="currentColor" />
                            : <Play size={11} fill="currentColor" className="ml-0.5" />}
                        </button>
                        <span className="text-[10px] font-mono text-[#5a5142] tabular-nums w-5 text-right shrink-0">
                          {i + 1}
                        </span>
                        <div className="w-9 h-9 rounded-md shrink-0 bg-[#0a0907] overflow-hidden border border-[#1f1a13]">
                          {t.cover_url
                            ? <img src={t.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={12} /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-medium truncate ${isCur ? 'text-[#D4BFA0]' : 'text-[#E8DCC8]'}`}>
                            {t.title}
                          </p>
                          <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider">
                            {t.type}
                            {t.bpm ? ` · ${t.bpm} BPM` : ''}
                            {t.key ? ` · ${t.key}` : ''}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-[#5a5142] tabular-nums shrink-0">
                          {fmt(t.duration_seconds)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
