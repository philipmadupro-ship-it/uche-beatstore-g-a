import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { planBulkTagging, planToTagRows, type TaggableTrack } from '@/lib/audio/bulk-tagging';
import { buildDiscoveryTerms } from '@/lib/store/discovery';

const log = createLogger('api.tracks.auto-tag');

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Load the caller's tracks with the features and tags tagging needs. */
async function loadTaggableTracks(userId: string) {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from('tracks')
    .select('id, title, type, bpm, key, scale, energy, danceability, valence, '
      + 'acousticness, loudness, store_listed, track_tags(tag, category)')
    .eq('user_id', userId);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string; title: string; type?: string | null; bpm?: number | null;
    key?: string | null; scale?: string | null; energy?: number | null;
    danceability?: number | null; valence?: number | null;
    acousticness?: number | null; loudness?: number | null;
    store_listed?: boolean | null;
    track_tags?: Array<{ tag: string; category?: string | null }> | null;
  }>;

  const tracks: TaggableTrack[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    bpm: r.bpm ?? null,
    key: r.key ?? null,
    scale: r.scale ?? null,
    energy: r.energy ?? null,
    danceability: r.danceability ?? null,
    valence: r.valence ?? null,
    acousticness: r.acousticness ?? null,
    loudness: r.loudness ?? null,
    appliedTags: (r.track_tags ?? []).map((t) => t.tag),
  }));

  return { admin, rows, tracks };
}

/**
 * GET — preview what auto-tagging would do.
 *
 * Separate from the write so the producer sees the plan before anything
 * changes. Bulk-editing a whole catalogue without a preview is how people end
 * up undoing work by hand.
 */
export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    const { tracks } = await loadTaggableTracks(auth.userId);
    const plan = planBulkTagging(tracks);

    return NextResponse.json({
      totalTags: plan.totalTags,
      tracksAffected: plan.plans.length,
      skipped: plan.skipped,
      // Enough to show a few examples without shipping the whole plan.
      preview: plan.plans.slice(0, 8),
    });
  } catch (err) {
    log.error('auto-tag preview failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) || 'Preview failed' }, { status: 500 });
  }
}

/**
 * POST — apply the plan.
 *
 * Reports the discovery pages gained, not just the tags written. Tags are a
 * means; the reason to run this is that an untagged catalogue generates no
 * landing pages and therefore stays invisible to search. Reporting the tag
 * count alone would hide whether the action actually achieved anything.
 */
export async function POST() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    const { admin, rows, tracks } = await loadTaggableTracks(auth.userId);

    // Discovery pages supported BEFORE, so the gain can be reported honestly.
    const listedBefore = rows
      .filter((r) => r.store_listed)
      .map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type ?? null,
        bpm: r.bpm ?? null,
        tags: r.track_tags ?? [],
      }));
    const termsBefore = buildDiscoveryTerms(listedBefore).length;

    const plan = planBulkTagging(tracks);
    if (plan.totalTags === 0) {
      return NextResponse.json({
        applied: 0, tracksAffected: 0, skipped: plan.skipped,
        newDiscoveryPages: 0, totalDiscoveryPages: termsBefore,
      });
    }

    const tagRows = planToTagRows(plan);
    // `ignoreDuplicates` so a tag added by hand between preview and apply does
    // not fail the whole batch — the operation stays re-runnable.
    const { error } = await admin
      .from('track_tags')
      .upsert(tagRows, { onConflict: 'track_id,tag', ignoreDuplicates: true });
    if (error) throw error;

    // Recompute with the new tags folded in, without a second round-trip.
    const addedByTrack = new Map<string, Array<{ tag: string; category: string }>>();
    for (const row of tagRows) {
      const list = addedByTrack.get(row.track_id) ?? [];
      list.push({ tag: row.tag, category: row.category });
      addedByTrack.set(row.track_id, list);
    }
    const listedAfter = listedBefore.map((t) => ({
      ...t,
      tags: [...(t.tags ?? []), ...(addedByTrack.get(t.id) ?? [])],
    }));
    const termsAfter = buildDiscoveryTerms(listedAfter).length;

    log.info('auto-tagged catalogue', {
      tags: tagRows.length,
      tracks: plan.plans.length,
      discoveryPagesGained: termsAfter - termsBefore,
    });

    return NextResponse.json({
      applied: tagRows.length,
      tracksAffected: plan.plans.length,
      skipped: plan.skipped,
      newDiscoveryPages: Math.max(0, termsAfter - termsBefore),
      totalDiscoveryPages: termsAfter,
    });
  } catch (err) {
    log.error('auto-tag apply failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) || 'Auto-tag failed' }, { status: 500 });
  }
}
