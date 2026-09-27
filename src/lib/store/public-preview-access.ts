/**
 * Which tracks the public preview + peaks routes may stream, and from what.
 *
 * The routes used to serve only `store_listed = true`. A featured project
 * bundle is public too — `/store/projects/[id]` lists its tracks and gives
 * each a Preview — but a bundle's tracks are usually not listed on their own.
 * In production 125 of 131 bundle tracks 404'd, so a buyer pressed Preview on
 * a bundle and heard nothing. A track is now previewable when it is listed OR
 * it sits in a featured bundle, and in both cases its owner must be the
 * producer. A bundle only vouches for tracks its own owner owns:
 * `project_tracks` is a plain junction, and a project must not make someone
 * else's track public.
 *
 * WHAT is streamed does not change: the public preview derivative, or a
 * non-private `audio_url`. A private `r2://` master is never a source.
 */
import { isProducerUserId } from '@/lib/auth/producer';

export interface PreviewTrackRow {
  user_id: string | null;
  store_listed: boolean | null;
  preview_url?: string | null;
  audio_url?: string | null;
}

export interface BundleRow {
  user_id: string | null;
  store_featured: boolean | null;
}

/** The source a public route may stream, or null. Never a private master. */
export function publicPreviewSource(track: Pick<PreviewTrackRow, 'preview_url' | 'audio_url'>): string | null {
  if (track.preview_url) return track.preview_url;
  if (typeof track.audio_url === 'string' && track.audio_url && !track.audio_url.startsWith('r2://')) {
    return track.audio_url;
  }
  return null;
}

/** True when one of `bundles` is featured and owned by the track's owner. */
export function featuredBundleCovers(trackOwner: string | null, bundles: BundleRow[]): boolean {
  if (!trackOwner) return false;
  return bundles.some((b) => b.store_featured === true && b.user_id === trackOwner);
}

/**
 * Full access decision for a track row the route has already loaded.
 * `admin` is the service client; the route is public, so this is the only
 * gate between an anonymous request and the audio.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canStreamPublicly(admin: any, trackId: string, track: PreviewTrackRow | null): Promise<boolean> {
  if (!track) return false;
  // Only the producer's catalogue is public, whichever way it became public.
  if (!(await isProducerUserId(admin, track.user_id))) return false;
  if (track.store_listed === true) return true;

  const { data: links, error: linkErr } = await admin
    .from('project_tracks')
    .select('project_id')
    .eq('track_id', trackId);
  if (linkErr) throw linkErr;
  const projectIds = ((links ?? []) as Array<{ project_id: string }>).map((l) => l.project_id);
  if (projectIds.length === 0) return false;

  const { data: bundles, error: bundleErr } = await admin
    .from('projects')
    .select('user_id, store_featured')
    .in('id', projectIds)
    .eq('store_featured', true);
  if (bundleErr) throw bundleErr;
  return featuredBundleCovers(track.user_id, (bundles ?? []) as BundleRow[]);
}
