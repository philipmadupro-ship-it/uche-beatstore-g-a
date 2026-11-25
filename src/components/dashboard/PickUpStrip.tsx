'use client';

/**
 * "Pick up where you left off" — a short strip of what the producer was last
 * working with. Presentational: lib/dashboard/continue.ts decides the items.
 * Tracks play (the strip hands the page a callback); projects and playlists link.
 */

import Link from 'next/link';
import { FolderOpen, ListMusic, Music } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { PlayGlyph } from '@/components/player/TransportIcons';
import type { Track } from '@/lib/types';
import type { ContinueCollection, ContinueItem } from '@/lib/dashboard/continue';

type StripTrack = Track;
type StripItem = ContinueItem<Track>;

const TILE = 'group relative block w-[112px] shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:w-[132px]';
const COVER = 'relative mb-2 aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] transition-colors group-hover:border-white/20';

export function PickUpStrip({
  items,
  onPlayTrack,
  moreProjects,
  morePlaylists,
}: {
  items: StripItem[];
  onPlayTrack: (track: StripTrack) => void;
  /** Show an "All projects" / "All playlists" link even if the strip holds some. */
  moreProjects?: boolean;
  morePlaylists?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Pick up where you left off" data-testid="pick-up-strip">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Pick up where you left off</h2>
        <div className="flex items-center gap-3 font-mono text-[10px] text-white/50">
          {moreProjects ? <Link href="/projects" className="transition-colors hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">All projects →</Link> : null}
          {morePlaylists ? <Link href="/playlists" className="transition-colors hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">All playlists →</Link> : null}
        </div>
      </div>
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 scrollbar-hide">
        {items.map((item) => {
          if (item.kind === 'track') {
            const t = item.track;
            return (
              <button key={`t-${item.id}`} type="button" onClick={() => onPlayTrack(t)} className={`${TILE} text-left`} aria-label={`Play ${t.title}`}>
                <div className={COVER}>
                  <ArtworkFallback src={t.cover_url} seed={t.id} alt="" kind="track" className="object-cover"><Music size={24} aria-hidden /></ArtworkFallback>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <PlayGlyph size={15} className="ml-0.5 text-white" />
                  </div>
                </div>
                <p className="truncate text-[11px] font-medium text-white">{t.title}</p>
                <p className="mt-0.5 font-mono text-[9px] text-white/50">Last played</p>
              </button>
            );
          }
          const c: ContinueCollection & { cover_url?: string | null } = item.kind === 'project' ? item.project : item.playlist;
          const isProject = item.kind === 'project';
          return (
            <Link key={`${item.kind}-${item.id}`} href={isProject ? `/projects/${item.id}` : `/playlists/${item.id}`} className={TILE}>
              <div className={COVER}>
                <ArtworkFallback src={c.cover_url ?? null} seed={item.id} alt="" kind={isProject ? 'project' : 'playlist'} className="object-cover">
                  {isProject ? <FolderOpen size={24} aria-hidden /> : <ListMusic size={24} aria-hidden />}
                </ArtworkFallback>
              </div>
              <p className="truncate text-[11px] font-medium text-white">{c.name}</p>
              <p className="mt-0.5 font-mono text-[9px] text-white/50">{isProject ? 'Project' : 'Playlist'} · {c.track_count ?? 0} tracks</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
