/**
 * The browser's side of the activity feeds (LABEL-20): fetch a page of
 * `GET /api/org/[orgId]/activity` and append it to what is already on screen.
 * Shared by the artist Activity tab and the Overview digest, which both page
 * backwards with "Show earlier". Pure of React; types only from the store.
 */
import type { ActivityFeed } from './activity-store';

export type FeedPage = Pick<ActivityFeed, 'events' | 'names' | 'projectArtists' | 'restricted' | 'hasMore' | 'nextBefore'>;
export type PageResult = { ok: true; page: FeedPage } | { ok: false; error: string };

const FAILED = 'Could not load the activity.';

/** One page. `params` is the feed's own query (`artist`, `since`, …); `before` continues a previous page. */
export async function fetchActivityPage(orgId: string, params: Record<string, string>, before: string | null): Promise<PageResult> {
  const qs = new URLSearchParams({ limit: '100', ...params });
  if (before) qs.set('before', before);
  try {
    const res = await fetch(`/api/org/${orgId}/activity?${qs}`, { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as Partial<ActivityFeed> & { error?: string };
    if (!res.ok || !Array.isArray(body.events) || !body.names) return { ok: false, error: body.error ?? FAILED };
    return {
      ok: true,
      page: {
        events: body.events,
        names: body.names,
        projectArtists: body.projectArtists ?? {},
        restricted: body.restricted ?? 0,
        hasMore: !!body.hasMore,
        nextBefore: body.nextBefore ?? null,
      },
    };
  } catch {
    return { ok: false, error: FAILED };
  }
}

/** `next` is the older page. Events are kept once (by id), names and project filings merge. */
export function appendPage(prev: FeedPage, next: FeedPage): FeedPage {
  const seen = new Set(prev.events.map((e) => e.id));
  return {
    events: [...prev.events, ...next.events.filter((e) => !seen.has(e.id))],
    names: {
      actors: { ...prev.names.actors, ...next.names.actors },
      artists: { ...prev.names.artists, ...next.names.artists },
      releases: { ...prev.names.releases, ...next.names.releases },
    },
    projectArtists: { ...prev.projectArtists, ...next.projectArtists },
    restricted: prev.restricted + next.restricted,
    hasMore: next.hasMore,
    nextBefore: next.nextBefore,
  };
}
