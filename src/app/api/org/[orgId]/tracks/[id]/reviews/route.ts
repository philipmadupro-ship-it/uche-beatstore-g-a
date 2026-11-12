/**
 * /api/org/[orgId]/tracks/[id]/reviews — reviews of a song (LABEL-25, 04 W3).
 *
 *   GET  every review of the song, for anyone who may read it: the A&Rs in
 *        scope AND the song's own artist (D5: an artist sees every reviewer's
 *        rating, verdict and note). `review.comment` (which `review.write`
 *        implies, and which implies `catalog.read`; migration 149's read
 *        policy asks the same) in scope; 404 outside it, 403 for a member
 *        with no review ability (marketing, legal, engineers).
 *   PUT  MY review: `{ rating?, verdict?, note? }`, omitted keeps, null
 *        clears. One row per (song, reviewer), so two reviewers never
 *        overwrite each other. Needs `review.write` (06 §2.6): owner/admin,
 *        A&R, project manager, artist manager. A roster artist holds only
 *        `review.comment` and reads but cannot rate (403); marketing and legal
 *        have neither.
 *
 * Both answer 404 for a row that is not a song with a stage or that D4 hides
 * from the member (working material is not marketing's to see), exactly as the
 * stage route does. The PUT records `song.reviewed` `{ rating, verdict,
 * noted }` — never the note text: the feed is a summary and the note is read
 * where the review is.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgSongReviewBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { mayReview, mergeReview, summarizeReviews, validReview, type ReviewContent } from '@/lib/labelos/song-review';
import { listReviews, readMyReview, upsertMyReview } from '@/lib/labelos/song-review-store';
import { memberMayReadSongRow, readStageSong, songEventSubject } from '@/lib/labelos/song-stage-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.reviews');

type Params = { params: Promise<{ orgId: string; id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Song reviews need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'review.comment', orgId });
  if (!access.ok) return access.res;
  const org = access.object.orgId;
  try {
    const song = await readStageSong(access.admin, org, id);
    if (!song || song.type !== 'song' || !song.stage || !(await memberMayReadSongRow(access.admin, org, id, access.capabilities))) return json(404, { error: 'Not found' });
    const reviews = await listReviews(access.admin, org, id);
    return json(200, {
      reviews: reviews.map((r) => ({ ...r, mine: r.reviewerId === access.userId })),
      summary: summarizeReviews(reviews),
      canReview: mayReview(access.capabilities),
    });
  } catch (err) {
    log.error('review list failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not load the reviews' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Song reviews need Supabase.' });
  const access = await requireObjectAccess({ table: 'tracks', id, cap: 'review.write', orgId });
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgSongReviewBodySchema);
  if (!parsed.ok) return parsed.res;
  const org = access.object.orgId;

  try {
    const song = await readStageSong(access.admin, org, id);
    if (!song || song.type !== 'song' || !song.stage || !(await memberMayReadSongRow(access.admin, org, id, access.capabilities))) {
      return json(404, { error: 'Not found' });
    }
    const merged = mergeReview(await readMyReview(access.admin, org, id, access.userId), parsed.data);
    if (!validReview(merged)) return json(400, { error: 'A review needs a rating, a verdict or a note' });

    // Only what the request named: a rating and a note saved at once must not overwrite each other.
    const columns: Partial<ReviewContent> = {};
    if (parsed.data.rating !== undefined) columns.rating = merged.rating;
    if (parsed.data.verdict !== undefined) columns.verdict = merged.verdict;
    if (parsed.data.note !== undefined) columns.note = merged.note;
    await upsertMyReview(access.admin, { orgId: org, trackId: id, userId: access.userId, columns });

    // Everyday event, best effort: the review is saved either way. A summary only — no note text.
    await recordEvent(
      access.admin,
      { orgId: org, userId: access.userId },
      'song.reviewed',
      await songEventSubject(access.admin, org, id),
      { rating: merged.rating, verdict: merged.verdict, noted: merged.note !== null },
    );

    return json(200, { review: merged });
  } catch (err) {
    log.error('review write failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not save the review' });
  }
}
