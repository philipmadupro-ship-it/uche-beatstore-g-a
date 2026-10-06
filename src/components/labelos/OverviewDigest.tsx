'use client';

/**
 * "Since your last visit" on the org Overview (LABEL-20, 07 §2.1): the
 * activity digest, grouped artist → day → actor, from the events the SERVER
 * page read for this member (activity-store#loadOverviewDigest) — so what is
 * shown was already filtered to their current scope and visibility. A busy
 * stretch is paged ("Show earlier"), because leaving marks the digest seen.
 *
 * Leaving the page (navigating away or closing the tab — not merely switching
 * tabs) marks the digest seen through `asOf`, the instant it was read (less a
 * margin), never "now": an event written while the page was open stays unseen.
 * "Mark all seen" does it on demand. No toast and no per-event interruption —
 * the digest is read when the member comes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendPage, fetchActivityPage, type FeedPage } from '@/lib/labelos/activity-client';
import type { ActivityFeed } from '@/lib/labelos/activity-store';
import { ActivityDigestView } from './ActivityDigestView';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

export function OverviewDigest({
  orgId,
  orgSlug,
  viewerId,
  feed: initial,
  since,
  lastSeenAt,
}: {
  orgId: string;
  orgSlug: string;
  viewerId: string;
  feed: ActivityFeed;
  /** Where the digest starts (`sinceWindow`): the next pages keep the same lower bound. */
  since: string;
  lastSeenAt: string | null;
}) {
  const [feed, setFeed] = useState<FeedPage>(initial);
  const [cleared, setCleared] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What "seen" claims is what the server read; kept in a ref so the leave handlers stay one stable function.
  const asOf = useRef(initial.asOf);
  const sent = useRef(false);
  useEffect(() => {
    asOf.current = initial.asOf;
    sent.current = false;
  }, [initial.asOf]);

  const markSeen = useCallback(() => {
    if (sent.current) return;
    sent.current = true;
    try {
      void fetch(`/api/org/${orgId}/overview/seen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ through: asOf.current }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // A failed mark only means the digest shows once more.
    }
  }, [orgId]);

  // Mark seen when the member LEAVES (a route change, or the page going away).
  // Not on visibilitychange: switching to another tab is not having read it.
  // The timer keeps a development StrictMode mount-unmount-mount from marking
  // it seen at once.
  useEffect(() => {
    let armed = false;
    const arm = setTimeout(() => {
      armed = true;
    }, 0);
    window.addEventListener('pagehide', markSeen);
    return () => {
      clearTimeout(arm);
      window.removeEventListener('pagehide', markSeen);
      if (armed) markSeen();
    };
  }, [markSeen]);

  const showEarlier = async (before: string) => {
    setPaging(true);
    const r = await fetchActivityPage(orgId, { since, limit: '200' }, before);
    setPaging(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setFeed((prev) => appendPage(prev, r.page));
  };

  const nothing = feed.events.length === 0 && feed.restricted === 0;

  return (
    <section aria-labelledby="overview-digest-title" className="mt-10" data-testid="overview-digest">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="overview-digest-title" className={LABEL}>Since your last visit</h2>
        {!nothing && !cleared && (
          <button
            type="button"
            onClick={() => {
              setCleared(true);
              markSeen();
            }}
            className="text-[11px] text-white/50 hover:text-white"
            data-testid="digest-mark-seen"
          >
            Mark all seen
          </button>
        )}
      </div>
      {nothing || cleared ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40" data-testid="digest-empty">
          {cleared ? 'All seen.' : lastSeenAt ? 'Nothing new since your last visit.' : 'Nothing in the last 7 days.'}
        </p>
      ) : (
        <>
          <ActivityDigestView
            events={feed.events}
            names={feed.names}
            projectArtists={feed.projectArtists}
            view="overview"
            orgSlug={orgSlug}
            viewerId={viewerId}
            restricted={feed.restricted}
          />
          {error && <p className="mt-3 text-[11px] text-white/50" role="alert">{error}</p>}
          {feed.hasMore && feed.nextBefore && (
            <button
              type="button"
              disabled={paging}
              onClick={() => void showEarlier(feed.nextBefore as string)}
              className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
              data-testid="digest-more"
            >
              Show earlier
            </button>
          )}
        </>
      )}
    </section>
  );
}
