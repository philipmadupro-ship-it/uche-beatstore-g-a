/**
 * Lets the buyer who owns a beat stream its PUBLIC preview after the storefront
 * stopped listing it.
 *
 * An exclusive sale delists the track it sells, and `canStreamPublicly`
 * (public-preview-access.ts) only serves listed or bundle-featured tracks — so
 * the one person who paid for the beat was the one person who could not hear it
 * in My beats. This is the second gate the preview and peaks routes consult
 * AFTER the public one says no:
 *
 *   - the caller must hold a Supabase session, and its canonical email must own
 *     the track right now (`loadBuyerOwnedTrackIds`: a refunded, disputed or
 *     revoked purchase owns nothing);
 *   - the track must still belong to the producer, as the public gate requires;
 *   - it widens WHO may stream, never WHAT: callers still pass the row through
 *     `publicPreviewSource`, so a private `r2://` master or `wav_url` is never a
 *     source, and an anonymous request for a delisted track still 404s.
 *
 * A response served on this path depends on the caller's cookie, so it must not
 * be publicly cacheable — `ownedStreamHeaders` is the one place that says so.
 */
import { requireUser, type createServiceClient } from '@/lib/auth/ownership';
import { isProducerUserId } from '@/lib/auth/producer';
import { sessionBuyerEmail } from '@/lib/store/buyer-purchases';
import { loadBuyerOwnedTrackIds } from '@/lib/store/buyer-beats';

type Admin = ReturnType<typeof createServiceClient>;

/** True when the signed-in caller has bought `trackId` and it is the producer's. */
export async function sessionOwnsTrack(
  admin: Admin,
  trackId: string,
  trackOwnerId: string | null | undefined,
): Promise<boolean> {
  // Session first: it is a cookie read, and an anonymous request ends here
  // without touching the purchase tables.
  const auth = await requireUser();
  if (!auth.ok) return false;
  if (!(await isProducerUserId(admin, trackOwnerId))) return false;
  const email = await sessionBuyerEmail(admin, auth.userId);
  if (!email) return false;
  return (await loadBuyerOwnedTrackIds(admin, email)).has(trackId);
}

/** Cache headers for a response that exists only for this caller's cookie. */
export function ownedStreamHeaders(headers: Headers): Headers {
  headers.set('cache-control', 'private, no-store');
  headers.set('vary', 'Cookie');
  // A wildcard CORS origin on a credentialed response is meaningless and
  // invites a shared cache to treat it as public.
  headers.delete('access-control-allow-origin');
  return headers;
}
