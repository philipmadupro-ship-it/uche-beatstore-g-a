/**
 * Is `userId` the producer? Same definition as requireProducer and
 * src/proxy.ts: the account has a creator_profiles row.
 *
 * Public routes that stream a track's stored audio use this on the track's
 * OWNER. A buyer could insert a track row of their own via PostgREST (fixed
 * in RLS by migration 119) pointing its audio at a private object; checking
 * the owner here keeps those routes safe regardless of migration state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isProducerUserId(admin: any, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await admin
    .from('creator_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}
