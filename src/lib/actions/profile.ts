'use server';

import { isSupabaseConfigured, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getAll, insert, update } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

type CreatorProfileRow = Record<string, unknown> & {
  id: string;
  user_id: string;
};

type CreatorProfilePayload = Record<string, unknown>;

export async function getCreatorProfile() {
  try {
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return { error: 'Not authenticated', profile: null };
      }

      const admin = createServiceClient();
      const { data: profile, error } = await admin
        .from('creator_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return { profile: profile || null };
    }

    // Local-store fallback
    const all = getAll<CreatorProfileRow>('creator_profiles');
    const profile = all.find((p) => p.user_id === 'local-user') || null;
    return { profile };
  } catch (error: unknown) {
    console.error('getCreatorProfile Server Action error:', error);
    return { error: errorMessage(error), profile: null };
  }
}

export async function updateCreatorProfile(payload: CreatorProfilePayload) {
  try {
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return { error: 'Not authenticated', profile: null };
      }

      const admin = createServiceClient();

      // A creator_profiles row is what marks an account as THE producer
      // (requireProducer, src/proxy.ts). Buyers sign in through the same
      // Supabase auth, so an unconditional upsert let any buyer mint that row
      // and pass every producer gate. Only the existing producer may write;
      // a new row is created only on first run, when no producer exists yet.
      const { data: existing } = await admin
        .from('creator_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!existing) {
        const { count } = await admin
          .from('creator_profiles')
          .select('user_id', { count: 'exact', head: true });
        if ((count ?? 0) > 0) {
          return { error: 'Producer account required', profile: null, forbidden: true };
        }
      }

      const { data: profile, error } = await admin
        .from('creator_profiles')
        .upsert({
          user_id: user.id,
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return { profile };
    }

    // Local-store fallback
    const all = getAll<CreatorProfileRow>('creator_profiles');
    let profile: CreatorProfileRow | null = all.find((p) => p.user_id === 'local-user') ?? null;
    if (profile) {
      profile = update<CreatorProfileRow>('creator_profiles', profile.id, payload) as CreatorProfileRow | null;
    } else {
      profile = insert('creator_profiles', {
        user_id: 'local-user',
        ...payload,
      });
    }

    return { profile };
  } catch (error: unknown) {
    console.error('updateCreatorProfile Server Action error:', error);
    return { error: errorMessage(error), profile: null };
  }
}
