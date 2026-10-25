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
 *   - portal-visit timeline rows are deleted, because they carry an IP hash,
 *   - comments the ARTIST wrote in their portal (mig 128: `contact_id` set,
 *     no `user_id`) are deleted, with the timeline rows that quote them.
 *     Replies threaded under those comments go too (parent_id cascades); a
 *     producer's message that started its own thread stays.
 *   - files the contact uploaded through their portal (mig 191) are deleted,
 *     rows and stored objects, with their upload timeline rows: they are the
 *     person's own material.
 * The project links stay: they are the producer's working history, now
 * pointing at the anonymised contact.
 *
 * Tables that do not exist yet (migrations not applied) are skipped.
 */

import { isMissingSchema } from '@/lib/artists/workspace-load';
import { deleteProjectAssetObject } from '@/lib/storage/project-assets';

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
    // Replies to a deleted comment go with it (parent_id ON DELETE CASCADE).
    { key: 'portalComments', run: () => admin.from('project_comments').delete().in('contact_id', ids).is('user_id', null).select('id') },
    { key: 'portalCommentActivity', run: () => admin.from('contact_activity').delete().in('contact_id', ids).eq('user_id', userId).eq('kind', 'portal_comment').select() },
    // What the artist wrote in the message thread (mig 130), and the timeline
    // rows that quote it. The producer's own messages stay, like their replies.
    { key: 'artistMessages', run: () => admin.from('artist_messages').delete().in('contact_id', ids).eq('user_id', userId).eq('author', 'artist').select('id') },
    { key: 'artistMessageActivity', run: () => admin.from('contact_activity').delete().in('contact_id', ids).eq('user_id', userId).in('kind', ['artist_message', 'artist_request', 'artist_request_resolved']).select() },
    { key: 'portalUploads', run: () => admin.from('project_assets').delete().in('uploaded_by_contact_id', ids).eq('user_id', userId).select('id, url') },
    { key: 'portalUploadActivity', run: () => admin.from('contact_activity').delete().in('contact_id', ids).eq('user_id', userId).eq('kind', 'file_uploaded').select() },
  ];

  const counts: Record<string, number> = {};
  for (const step of steps) {
    const { data, error: stepErr } = await step.run();
    if (stepErr) {
      if (isMissingSchema(stepErr)) continue;
      throw stepErr;
    }
    counts[step.key] = data?.length ?? 0;
    if (step.key === 'portalUploads') {
      // The rows are gone; the bytes go too. A failed object delete is logged
      // by nothing here but must not stop the rest of the erasure.
      for (const row of (data ?? []) as Array<{ url?: string | null }>) {
        if (row.url) await deleteProjectAssetObject(row.url).catch(() => {});
      }
    }
  }
  return counts;
}
