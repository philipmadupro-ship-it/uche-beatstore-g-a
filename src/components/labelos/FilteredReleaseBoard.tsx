'use client';

/**
 * The Releases page's filter bar and, when a filter is applied, its rows
 * (LABEL-37). With no filter the board is exactly the server-rendered one the
 * page loaded; with one, the rows come from `GET /api/org/[orgId]/views/run`
 * for THIS member (scope first, then the gates evaluated) and are drawn by the
 * same `ReleaseBoardView`.
 */
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { FilterBar } from '@/components/labelos/FilterBar';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { ReleaseBoardView } from '@/components/labelos/ReleaseBoardView';
import { useFilterChoices } from '@/components/labelos/useFilterChoices';
import { useOrgFilter } from '@/components/labelos/useOrgFilter';
import { isEmptyFilter } from '@/lib/labelos/filters';
import type { BoardFilter, BoardRelease } from '@/lib/labelos/release-board';

export function FilteredReleaseBoard({
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
  const shell = useOrgShell();
  const orgId = shell?.org.id ?? '';
  const filter = useOrgFilter({ orgId, subject: 'releases', runWhenEmpty: false });
  const { artists } = useFilterChoices(orgId, false);
  const { run, definition } = filter;
  const filtering = !isEmptyFilter(definition);

  if (!schemaReady || !shell) {
    return <ReleaseBoardView orgSlug={orgSlug} releases={releases} more={more} schemaReady={schemaReady} initialFilter={initialFilter} />;
  }

  const result = run.state === 'ready' && run.response.result.kind === 'releases' ? run.response.result : null;
  return (
    <>
      <FilterBar filter={filter} artists={artists} people={[]} canRights={false} canApprovals={false} />
      {!filtering && <ReleaseBoardView orgSlug={orgSlug} releases={releases} more={more} schemaReady={schemaReady} initialFilter={initialFilter} />}
      {filtering && run.state === 'loading' && <p className="text-[11px] text-white/40">Loading releases…</p>}
      {filtering && run.state === 'error' && (
        <p role="alert" className="text-[11px] text-[var(--error-text)]">
          {run.error}
        </p>
      )}
      {filtering && result && result.rows.length === 0 && (
        <EmptyState title="No releases match" description="Nothing you can open matches these filters. Take one off to widen the list." />
      )}
      {filtering && result && result.rows.length > 0 && (
        <>
          <ReleaseBoardView orgSlug={orgSlug} releases={result.rows} more={result.olderNotShown} schemaReady initialFilter="all" />
          {result.more && (
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={filter.loadMore}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
