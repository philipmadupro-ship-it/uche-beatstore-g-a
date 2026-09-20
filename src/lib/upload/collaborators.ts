import { createLogger } from '@/lib/log';

import type { Collaborator } from './title-metadata';

const log = createLogger('upload.collaborators');

/**
 * The slice of the Supabase client this needs. Structural, so the helper can
 * be called with either the service-role client or a request-scoped one, and
 * tested without either.
 */
export interface CollaboratorClient {
  from(table: string): {
    insert(rows: unknown[]): PromiseLike<{ error: { message?: string } | null }>;
    delete(): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): PromiseLike<{ error: { message?: string } | null }>;
      };
    };
  };
}

/** Credits derived from the filename, as opposed to ones the producer typed. */
export const FILENAME_SOURCE = 'filename';

/**
 * Store the credits read out of a filename against a track.
 *
 * Replace-then-insert rather than upsert, for two reasons. The unique index is
 * on `(track_id, lower(name), role)` — an expression, which PostgREST cannot
 * name as an `onConflict` target. And re-deriving from the filename should
 * genuinely REPLACE what the last derivation produced, or a track renamed and
 * re-analysed accumulates the credits of every name it ever had.
 *
 * Only rows this code wrote are cleared: the delete is scoped to
 * `source = 'filename'`, so a credit the producer typed is never removed by a
 * re-parse of the file it came in as.
 *
 * Never throws. A missing table (migration 115 not yet applied) or a failed
 * write costs the credits, not the upload — losing a parsed name is a nuisance,
 * failing the upload that carried the audio is not.
 */
export async function persistTrackCollaborators(
  supabase: CollaboratorClient,
  trackId: string,
  collaborators: Collaborator[],
): Promise<number> {
  if (!trackId) return 0;

  try {
    const { error: deleteError } = await supabase
      .from('track_collaborators')
      .delete()
      .eq('track_id', trackId)
      .eq('source', FILENAME_SOURCE);
    // supabase-js resolves with `{ error }` rather than throwing, so this has
    // to be read explicitly — a bare try/catch would never see it.
    if (deleteError) throw new Error(deleteError.message ?? 'delete failed');

    if (collaborators.length === 0) return 0;

    const { error: insertError } = await supabase.from('track_collaborators').insert(
      collaborators.map((c) => ({
        track_id: trackId,
        name: c.name,
        role: c.role,
        source: FILENAME_SOURCE,
      })),
    );
    if (insertError) throw new Error(insertError.message ?? 'insert failed');

    return collaborators.length;
  } catch (err) {
    log.warn('Could not save filename credits; upload continues', {
      trackId,
      count: collaborators.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
