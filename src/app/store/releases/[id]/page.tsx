'use client';

/**
 * /store/releases/[id] (LABEL-42)
 *
 * A listed release: cover, the "Released" badge, and the tracklist, playable
 * in the store's player bar. Same shell as the project-bundle page
 * (GlassPage) so browsing stays one visual language. Nothing here is for sale
 * — releases are listened to, not licensed (selling label music is out of
 * scope) — so there is no cart, price or checkout, and the tracks carry
 * only a same-origin stream. How long a visitor hears (a preview clip or the
 * whole recording) is the producer's per-release choice, decided by the
 * server's audio route, not by this page.
 */

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Disc3, Loader2, Music, Pause, Play } from 'lucide-react';
import { usePlayer } from '@/hooks/usePlayer';
import { GlassPage } from '@/components/store/GlassPage';
import { releaseYear } from '@/components/store/ReleasesStrip';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import type { Track } from '@/lib/types';

interface ReleaseTrack {
  id: string;
  title: string;
  audio_url: string;
  cover_url: string | null;
  duration_seconds: number | null;
  explicit: boolean;
  position: number;
}

interface ReleaseDetail {
  release: {
    id: string;
    title: string;
    type: string;
    artist: string | null;
    label_name: string | null;
    primary_genre: string | null;
    release_date: string | null;
    already_out: boolean;
    cover_url: string | null;
    track_count: number;
    playback: 'preview' | 'full';
  };
  tracks: ReleaseTrack[];
}

const fmt = (secs: number | null) => {
  if (!secs) return '—';
  return `${Math.floor(secs / 60)}:${Math.floor(secs % 60).toString().padStart(2, '0')}`;
};

export default function StoreReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentTrack, isPlaying, setTrack, togglePlay, setQueue } = usePlayer();
  const [hovered, setHovered] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['storeRelease', id],
    queryFn: async () => {
      const res = await fetch(`/api/store/releases/${id}`);
      if (!res.ok) throw new Error('Not found');
      return (await res.json()) as ReleaseDetail;
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-white/40" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center gap-4 text-white/40">
        <Disc3 size={36} />
        <p className="text-[13px]">This release is not on the store.</p>
        <Link href="/store" className="text-[11px] underline hover:text-white">← Back to store</Link>
      </div>
    );
  }

  const { release, tracks } = data;
  const queue = tracks as unknown as Track[];
  const playing = (t: ReleaseTrack) => currentTrack?.id === t.id;
  const playAll = () => {
    if (tracks.length === 0) return;
    if (currentTrack && tracks.some((t) => t.id === currentTrack.id)) {
      togglePlay();
      return;
    }
    setQueue(queue);
    setTrack(queue[0]);
  };
  const anyPlaying = isPlaying && !!currentTrack && tracks.some((t) => t.id === currentTrack.id);
  const meta = [release.artist, release.label_name, release.primary_genre, releaseYear(release.release_date)].filter(Boolean);

  return (
    <GlassPage coverUrl={release.cover_url} accentColor="#FFFFFF" back={{ href: '/store', label: 'Back to store' }}>
      <GlassPage.Hero
        eyebrow={release.type}
        title={release.title}
        producer={null}
        meta={
          <>
            <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-white/55" data-testid="released-badge">
              Released
            </span>
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-2">
                <span className="text-white/30">·</span>
                {m}
              </span>
            ))}
            <span className="text-white/30">·</span>
            <span>{release.track_count} {release.track_count === 1 ? 'song' : 'songs'}</span>
          </>
        }
        actions={
          <>
            <button
              onClick={playAll}
              disabled={tracks.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-[11px] text-white transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
              data-testid="release-play-all"
            >
              {anyPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}
              {release.playback === 'full' ? 'Play' : 'Preview'}
            </button>
            {release.playback === 'preview' && (
              <span className="text-[11px] font-mono text-white/45">Previews of each song.</span>
            )}
          </>
        }
        coverImage={release.cover_url}
        coverFallback={<Disc3 size={56} />}
      />

      <div className="px-2 md:px-4 pt-4 pb-2">
        <ul data-testid="release-tracklist">
          {tracks.map((t) => {
            const cur = playing(t);
            const curPlaying = cur && isPlaying;
            return (
              <li
                key={t.id}
                onMouseEnter={() => setHovered(t.id)}
                onMouseLeave={() => setHovered((v) => (v === t.id ? null : v))}
                className={`grid grid-cols-[44px_minmax(0,1fr)_auto] gap-3 items-center px-4 md:px-6 py-2.5 rounded-2xl transition-colors ${cur ? 'bg-white/[0.05]' : 'hover:bg-white/[0.04]'}`}
              >
                <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#090907] border border-white/[0.06] shrink-0">
                  <ArtworkFallback src={t.cover_url} seed={t.id} kind="track" sizes="40px" className="object-cover">
                    <Music size={14} aria-hidden="true" />
                  </ArtworkFallback>
                  {(hovered === t.id || cur) && (
                    <button
                      onClick={() => {
                        if (cur) { togglePlay(); return; }
                        setQueue(queue);
                        setTrack(t as unknown as Track);
                      }}
                      aria-label={curPlaying ? `Pause ${t.title}` : `Play ${t.title}`}
                      className="absolute inset-0 flex items-center justify-center bg-black/55 text-white"
                    >
                      {curPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
                    </button>
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-[13px] truncate ${cur ? 'font-semibold text-white' : 'text-white/80'}`}>{t.title}</p>
                  {t.explicit && <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">Explicit</p>}
                </div>
                <span className="text-[11px] font-mono tabular-nums text-white/45">{fmt(t.duration_seconds)}</span>
              </li>
            );
          })}
        </ul>
        {tracks.length === 0 && <p className="px-6 py-8 text-center text-[11px] text-white/60">No songs on this release yet.</p>}
      </div>
    </GlassPage>
  );
}
