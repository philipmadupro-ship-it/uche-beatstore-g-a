/**
 * The reads and the one write behind the song review routes (LABEL-25). The
 * rules are `song-review.ts`; this file only touches the database. Service-role
 * client, org filter on every query: authorisation is the route's
 * (`requireObjectAccess`, then D4's row rule).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { memberIdentities, memberLabel, type IdentityAdmin } from './member-identity';
import { isReviewVerdict, type ReviewContent } from './song-review';

type ReviewRow = {
  reviewer_id: string;
  rating: number | null;
  verdict: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type SongReview = ReviewContent & {
  reviewerId: string;
  /** Name, else a neutral word: never an email (an artist reads these). */
  reviewer: string;
  updatedAt: string;
};

const COLUMNS = 'reviewer_id, rating, verdict, note, created_at, updated_at';

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

const toContent = (r: ReviewRow): ReviewContent => ({
  rating: r.rating,
  verdict: isReviewVerdict(r.verdict) ? r.verdict : null,
  note: r.note,
});

/** One reviewer's current review of a song, or null. */
export async function readMyReview(admin: AdminClient, org: string, trackId: string, userId: string): Promise<ReviewContent | null> {
  const res = await admin.from('song_reviews').select(COLUMNS).eq('org_id', org).eq('track_id', trackId).eq('reviewer_id', userId).maybeSingle();
  if (res.error) fail('review read', res.error);
  return res.data ? toContent(res.data as ReviewRow) : null;
}

/** Every review of a song, oldest first, with reviewer names. */
export async function listReviews(admin: AdminClient, org: string, trackId: string): Promise<SongReview[]> {
  const res = await admin.from('song_reviews').select(COLUMNS).eq('org_id', org).eq('track_id', trackId).order('created_at', { ascending: true });
  if (res.error) fail('review list', res.error);
  const rows = (res.data ?? []) as ReviewRow[];
  const identities = await memberIdentities(admin as unknown as IdentityAdmin, org, [...new Set(rows.map((r) => r.reviewer_id))], { withEmail: false });
  return rows.map((r) => ({ ...toContent(r), reviewerId: r.reviewer_id, reviewer: memberLabel(identities.get(r.reviewer_id)), updatedAt: r.updated_at }));
}

/** Reviews of several songs at once (the inbox rows): by song id. */
export async function reviewsForSongs(admin: AdminClient, org: string, trackIds: readonly string[]): Promise<Map<string, { reviewerId: string; rating: number | null; verdict: ReviewContent['verdict']; note: string | null }[]>> {
  const out = new Map<string, { reviewerId: string; rating: number | null; verdict: ReviewContent['verdict']; note: string | null }[]>();
  if (trackIds.length === 0) return out;
  const res = await admin.from('song_reviews').select(`track_id, ${COLUMNS}`).eq('org_id', org).in('track_id', [...trackIds]);
  if (res.error) fail('review read', res.error);
  for (const r of (res.data ?? []) as (ReviewRow & { track_id: string })[]) {
    const c = toContent(r);
    out.set(r.track_id, [...(out.get(r.track_id) ?? []), { reviewerId: r.reviewer_id, ...c }]);
  }
  return out;
}

/**
 * The upsert: one row per (song, reviewer). Only the caller's own row is ever
 * named, and only the columns the request named are written: PostgREST's merge
 * leaves the others as they are, so two saves in flight (a rating and a note)
 * cannot undo each other by each writing back a stale copy of the rest.
 */
export async function upsertMyReview(admin: AdminClient, o: { orgId: string; trackId: string; userId: string; columns: Partial<ReviewContent> }): Promise<void> {
  const res = await admin.from('song_reviews').upsert(
    {
      org_id: o.orgId,
      track_id: o.trackId,
      reviewer_id: o.userId,
      ...o.columns,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'track_id,reviewer_id' },
  );
  if (res.error) fail('review write', res.error);
}
