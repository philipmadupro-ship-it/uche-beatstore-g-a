/**
 * Erasure for the artist workspace (migrations 122–126).
 *
 * Runs BEFORE `buildErasurePlan`: that plan anonymises the contact's email,
 * after which nothing can find the contact by the address being erased.
 *
 *   - the artist's portal is deleted (it is their access link; an erased
 *     person keeps no way in),
 *   - reactions the ARTIST wrote (`set_by = 'artist'`) are deleted; the
 *     producer's own decisions on their beats are the producer's records,
 *   - portal-visit timeline rows are deleted, because they carry an IP hash.
 * The project links stay: they are the producer's working history, now
 * pointing at the anonymised contact.
 *
 * Tables that do not exist yet (migrations not applied) are skipped.
 */

import { isMissingSchema } from '@/lib/artists/workspace-load';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export async function eraseArtistWorkspace(admin: Admin, userId: string, email: string): Promise<Record<string, number>> {
  const { data: contacts, error } = await admin.from('contacts').select('id').eq('email', email).eq('user_id', userId);
  if (error) throw error;
  const ids = ((contacts ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (ids.length === 0) return {};

  const steps: Array<{ key: string; run: () => PromiseLike<{ data: unknown[] | null; error: unknown }> }> = [
    { key: 'artistPortals', run: () => admin.from('artist_portals').delete().in('contact_id', ids).eq('user_id', userId).select() },
    { key: 'artistReactions', run: () => admin.from('contact_track_states').delete().in('contact_id', ids).eq('user_id', userId).eq('set_by', 'artist').select() },
    { key: 'portalVisits', run: () => admin.from('contact_activity').delete().in('contact_id', ids).eq('user_id', userId).eq('kind', 'portal_opened').select() },
  ];

  const counts: Record<string, number> = {};
  for (const step of steps) {
    const { data, error: stepErr } = await step.run();
    if (stepErr) {
      if (isMissingSchema(stepErr)) continue;
      throw stepErr;
    }
    counts[step.key] = data?.length ?? 0;
  }
  return counts;
}
