'use client';

/**
 * `/o/<slug>/music` — every song the member can open, with the structured
 * filter bar and saved views (LABEL-37, 08 §A2). The rows are whatever
 * `GET /api/org/[orgId]/views/run` returns for THIS member: their artist
 * scope and D4 are applied before anything can match, so there is no
 * "N hidden" and no count that includes a song they cannot see.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { FilterBar } from '@/components/labelos/FilterBar';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { useFilterChoices } from '@/components/labelos/useFilterChoices';
import { useOrgFilter } from '@/components/labelos/useOrgFilter';
import { DIMENSION_LABEL, isEmptyFilter } from '@/lib/labelos/filters';
import type { SongRun } from '@/lib/labelos/filters-store';
import { songStageLabel } from '@/lib/labelos/org-workspace';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function MusicView() {
  const shell = useOrgShell();
  const orgId = shell?.org.id ?? '';
  const canRights = !!shell?.capabilities.includes('rights.read');
  const canApprovals = !!shell && (shell.capabilities.includes('release.write') || shell.capabilities.some((c) => c.startsWith('release.approve.')));
  const filter = useOrgFilter({ orgId, subject: 'songs', runWhenEmpty: true });
  const { artists, people } = useFilterChoices(orgId, canRights);
  const { run, definition } = filter;

  const songs = useMemo(() => (run.state === 'ready' && run.response.result.kind === 'songs' ? (run.response.result as SongRun) : null), [run]);
  if (!shell) return null;
  const empty = isEmptyFilter(definition);

  return (
    <div data-testid="music-view">
      <FilterBar filter={filter} artists={artists} people={people} canRights={canRights} canApprovals={canApprovals} />

      {run.state === 'loading' && <p className="text-[11px] text-white/40">Loading songs…</p>}
      {run.state === 'error' && (
        <p role="alert" className="text-[11px] text-[var(--error-text)]">
          {run.error}
        </p>
      )}

      {songs && songs.unavailable.length > 0 && (
        <EmptyState
          title="Your role cannot use this filter"
          description={`This view filters on ${songs.unavailable.map((d) => DIMENSION_LABEL[d]).join(' and ')}, which you do not have access to, so it shows nothing. Remove that filter to see songs.`}
        />
      )}

      {songs && songs.unavailable.length === 0 && songs.rows.length === 0 && (
        <EmptyState
          title={empty ? 'No songs yet' : 'No songs match'}
          description={empty ? 'Songs from the artists you work with appear here once they are uploaded.' : 'Nothing you can open matches these filters. Take one off to widen the list.'}
        />
      )}

      {songs && songs.rows.length > 0 && (
        <>
          <p className={`${LABEL} mb-3`} data-testid="music-count">
            {songs.total} {songs.total === 1 ? 'song' : 'songs'}
          </p>
          <ul className="space-y-2">
            {songs.rows.map((s) => (
              <li key={s.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4 transition-colors hover:border-white/20" data-testid={`music-row-${s.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                  <div className="min-w-0">
                    <Link href={`/o/${shell.org.slug}/songs/${s.id}`} className="text-[13px] text-white hover:underline">
                      {s.title ?? 'Untitled'}
                    </Link>
                    <p className="mt-1 text-[11px] text-white/60">
                      {[s.artist?.name, s.project?.name].filter(Boolean).join(' · ') || 'No artist yet'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={LABEL}>{songStageLabel(s.stage)}{s.released ? ' · On a release' : ''}</p>
                    <p className="mt-1 text-[11px] text-white/60">
                      {[s.bpm ? `${s.bpm} BPM` : null, s.key, day(s.createdAt)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {songs.more && (
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={filter.loadMore}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
