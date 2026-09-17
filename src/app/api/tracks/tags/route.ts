import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll } from '@/lib/db';
import { requireUser, safeSellerId } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { customVocabulary, type TagUsageRow } from '@/lib/tags/vocabulary';

const log = createLogger('api.tracks.tags');

export const dynamic = 'force-dynamic';

/**
 * GET /api/tracks/tags — the producer's own tag vocabulary.
 *
 * The Tag Workspace could only ever offer the hardcoded TAG_TAXONOMY, so a
 * custom tag was saved to its track and then had nowhere to be shown again.
 * This is the missing read: every tag actually present across the owner's
 * catalogue, deduped and counted, so the workspace can offer it back.
 *
 * Static segment, so it takes precedence over /api/tracks/[id] — no ambiguity
 * with a track literally called "tags".
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    if (isSupabaseConfigured()) {
      // Validate before interpolating into .or() (the comma footgun).
      const safeId = safeSellerId(auth.userId);
      if (!safeId) return NextResponse.json({ tags: [] });

      // track_tags is a junction with no user_id of its own, so ownership has
      // to come from the parent track. An INNER JOIN does that in one request.
      //
      // The obvious alternative — select the owned track ids, then
      // `.in('track_id', ids)` — is what this first did, and it 400s: 100 ids
      // is ~3.7KB of UUIDs in the query string and PostgREST rejects the URL.
      // `/api/store/facets` works around it by chunking, which is N requests
      // and still only moves the ceiling. The join has neither problem.
      const { data, error } = await auth.admin
        .from('track_tags')
        .select('tag, category, tracks!inner(user_id)')
        .or(`user_id.eq.${safeId},user_id.is.null`, { referencedTable: 'tracks' });
      if (error) throw new Error(error.message);

      return NextResponse.json({ tags: customVocabulary((data ?? []) as TagUsageRow[]) });
    }

    const rows = getAll('track_tags') as TagUsageRow[];
    return NextResponse.json({ tags: customVocabulary(rows) });
  } catch (err) {
    log.error('vocabulary read failed', { error: errorMessage(err) });
    // A failure here must not break tagging: the workspace still has the
    // shipped taxonomy and the track's applied tags to render.
    return NextResponse.json({ tags: [] });
  }
}
