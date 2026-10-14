'use client';

/**
 * Released music on /store (LABEL-42): a row of tiles, one per release the
 * store owner put on the store. Self-contained — it asks `/api/store/releases`
 * itself and draws nothing at all when there are none, so a storefront with no
 * released music is exactly the page it was. It is NOT a section of the
 * layout document (the Store Editor's arrangement is untouched).
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Disc3 } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';

export interface ReleaseTile {
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
}

export const releaseYear = (iso: string | null) => (iso ? iso.slice(0, 4) : null);

export function ReleasesStrip() {
  const { data } = useQuery({
    queryKey: ['storeReleases'],
    queryFn: async () => {
      const res = await fetch('/api/store/releases');
      if (!res.ok) return [] as ReleaseTile[];
      const json = (await res.json()) as { releases?: ReleaseTile[] };
      return json.releases ?? [];
    },
    staleTime: 30_000,
  });
  const releases = data ?? [];
  if (releases.length === 0) return null;

  return (
    <section aria-label="Released music" data-testid="releases-strip" className="max-w-[1600px] mx-auto px-4 md:px-8 py-8">
      <div className="mb-4 flex items-center gap-2">
        <Disc3 size={13} className="text-white/40" aria-hidden="true" />
        <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Released</h2>
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {releases.map((r) => (
          <li key={r.id}>
            <Link
              href={`/store/releases/${r.id}`}
              className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              data-testid="release-tile"
            >
              <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0A] transition-colors group-hover:border-white/20">
                <ArtworkFallback src={r.cover_url} seed={r.id} kind="project" sizes="(min-width: 1280px) 16vw, (min-width: 768px) 25vw, 50vw" className="object-cover">
                  <Disc3 size={28} aria-hidden="true" />
                </ArtworkFallback>
              </div>
              <p className="mt-2 truncate text-[13px] text-white/80">{r.title}</p>
              <p className="truncate text-[11px] text-white/40">
                {[r.artist, releaseYear(r.release_date)].filter(Boolean).join(' · ') || r.type}
              </p>
              <span className="mt-1 inline-block rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">
                Released
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
