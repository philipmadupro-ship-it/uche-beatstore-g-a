'use client';

/**
 * The artist workspace's Activity tab (LABEL-20, 07 §2.2): day → actor lines
 * from `GET /api/org/[orgId]/activity?artist=<id>`. Fetched when the tab
 * opens (the workspace payload does not carry the log) and paged backwards
 * with "Show earlier". What comes back is already limited to what this
 * member may see (visibility, scope, D4) — the tab filters nothing itself.
 */
import { useEffect, useState } from 'react';
import { appendPage, fetchActivityPage, type FeedPage } from '@/lib/labelos/activity-client';
import { ActivityDigestView } from './ActivityDigestView';

const EMPTY = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40';

export function ArtistActivityTab({ orgId, orgSlug, contactId, viewerId }: { orgId: string; orgSlug: string; contactId: string; viewerId?: string }) {
  const [feed, setFeed] = useState<FeedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchActivityPage(orgId, { artist: contactId }, null).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setError(null);
        setFeed(r.page);
      } else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, contactId]);

  const showEarlier = async (before: string) => {
    setPaging(true);
    const r = await fetchActivityPage(orgId, { artist: contactId }, before);
    setPaging(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setFeed((prev) => (prev ? appendPage(prev, r.page) : r.page));
  };

  if (error && !feed) return <p className={EMPTY} role="alert" data-testid="activity-error">{error}</p>;
  if (!feed) return <p className={EMPTY} data-testid="activity-loading">Loading…</p>;
  if (feed.events.length === 0 && feed.restricted === 0) return <p className={EMPTY} data-testid="activity-empty">No activity yet.</p>;

  return (
    <div data-testid="artist-activity">
      <ActivityDigestView events={feed.events} names={feed.names} view="artist" orgSlug={orgSlug} viewerId={viewerId} restricted={feed.restricted} />
      {error && <p className="mt-3 text-[11px] text-white/50" role="alert">{error}</p>}
      {feed.hasMore && feed.nextBefore && (
        <button
          type="button"
          disabled={paging}
          onClick={() => void showEarlier(feed.nextBefore as string)}
          className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
          data-testid="activity-more"
        >
          Show earlier
        </button>
      )}
    </div>
  );
}
