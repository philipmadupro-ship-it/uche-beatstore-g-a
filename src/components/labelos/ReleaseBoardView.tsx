'use client';

/**
 * The release board (LABEL-33, 07 §2.5): every release the member can see as a
 * row with its gate strip, filtered by where it stands. There is no drag to a
 * stage — a stage is what the gates say, so the only thing a row does is open
 * its release. The data is one server-side read (`loadReleaseBoard`), so the
 * board makes no request of its own; the filter is a client-side view of it
 * and is kept in the URL (`?state=`), so a refresh or a link keeps it.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';
import { ReleaseGateStrip } from '@/components/labelos/ReleaseGateStrip';
import {
  BOARD_FILTERS,
  BOARD_FILTER_LABEL,
  boardStage,
  countByFilter,
  filterBoard,
  gateSummary,
  sortBoard,
  type BoardFilter,
  type BoardRelease,
} from '@/lib/labelos/release-board';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

const date = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null);

function dateLine(r: BoardRelease): string {
  if (r.state === 'delivered') return `Delivered${r.deliveredTo ? ` to ${r.deliveredTo}` : ''}${r.deliveredAt ? ` · ${date(r.deliveredAt)}` : ''}`;
  if (r.state === 'cancelled') return 'Cancelled';
  const d = r.releaseDate ?? r.targetDate;
  return d ? `${r.releaseDate ? 'Release' : 'Target'} ${date(d)}` : 'No date set';
}

export function ReleaseBoardView({
  orgSlug,
  releases,
  more,
  schemaReady,
  initialFilter,
}: {
  orgSlug: string;
  releases: BoardRelease[];
  more: number;
  schemaReady: boolean;
  initialFilter: BoardFilter;
}) {
  const [filter, setFilter] = useState<BoardFilter>(initialFilter);
  const counts = useMemo(() => countByFilter(releases), [releases]);
  const rows = useMemo(() => sortBoard(filterBoard(releases, filter)), [releases, filter]);

  const choose = (next: BoardFilter) => {
    setFilter(next);
    // The URL is the filter's memory; no navigation, no refetch.
    try {
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete('state');
      else url.searchParams.set('state', next);
      window.history.replaceState(null, '', url);
    } catch {
      /* the filter still works without it */
    }
  };

  if (!schemaReady) {
    return <EmptyState title="Releases are not set up yet" description="The release tables are not applied on this database, so there is nothing to show." />;
  }
  if (releases.length === 0) {
    return <EmptyState title="No releases yet" description="A release starts as a draft with a tracklist. When one exists for an artist you can see, it shows here with its gates." />;
  }

  return (
    <div data-testid="release-board">
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter releases">
        {BOARD_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-testid={`release-filter-${f}`}
            onClick={() => choose(f)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-[11px] transition-colors',
              filter === f ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/70 hover:border-white/20 hover:bg-white/[0.10]',
            )}
          >
            {BOARD_FILTER_LABEL[f]} <span className="ml-1 font-mono text-[10px] text-white/40">{counts[f]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/60" data-testid="release-board-empty">
          Nothing is {BOARD_FILTER_LABEL[filter].toLowerCase()} right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4 transition-colors hover:border-white/20" data-testid={`release-row-${r.id}`} data-stage={boardStage(r)}>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <Link href={`/o/${orgSlug}/releases/${r.id}`} className="text-[13px] text-white hover:underline" data-testid="release-row-link">
                    {r.title}
                  </Link>
                  <p className="mt-1 text-[11px] text-white/60">
                    {r.artistName ?? 'Artist'} · <span className="capitalize">{r.type}</span> · {r.itemCount} {r.itemCount === 1 ? 'track' : 'tracks'}
                  </p>
                </div>
                <div className="text-right">
                  <p className={LABEL} data-testid="release-row-stage">{BOARD_FILTER_LABEL[boardStage(r)]}</p>
                  <p className="mt-1 text-[11px] text-white/60">{dateLine(r)}</p>
                </div>
              </div>
              {r.gates.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <ReleaseGateStrip gates={r.gates} />
                  <span className="text-[11px] text-white/40">{gateSummary(r.gates)}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="mt-4 text-[11px] text-white/40">{more} older {more === 1 ? 'release is' : 'releases are'} not shown.</p>}
    </div>
  );
}
