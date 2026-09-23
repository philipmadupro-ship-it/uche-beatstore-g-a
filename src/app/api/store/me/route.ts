import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { normalizeEmail } from '@/lib/contacts/email';
import {
  buildBuyerLibraryShape,
  collectBuyerLibraryTrackIds,
  type BuyerLibraryFavoriteRow,
  type BuyerLibraryHistoryRow,
  type BuyerLibraryTrackJoinRow,
  type BuyerLibraryTrackSummary,
} from '@/lib/store/buyer-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.store.me');

/**
 * A signed-in buyer favoriting a track is real, self-reported intent —
 * unlike the anonymous localStorage wishlist, they had to actually create a
 * persistent account first. Before this, that engagement was invisible to
 * the producer's CRM: a contact was only ever created on a completed
 * purchase, so a warm buyer who'd favorited three tracks looked identical
 * to a stranger who'd never visited. Best-effort and silent on failure —
 * a CRM nicety must never break the buyer-facing favorite toggle.
 */
async function upsertLeadContact(
  admin: ReturnType<typeof createServiceClient>,
  email: string,
  trackId: string,
) {
  try {
    const { data: track } = await admin
      .from('tracks')
      .select('user_id')
      .eq('id', trackId)
      .maybeSingle();
    const sellerUserId = (track as { user_id?: string } | null)?.user_id;
    if (!sellerUserId) return;

    // ignoreDuplicates → INSERT ... ON CONFLICT DO NOTHING: creates a lead
    // the first time this email is seen, never touches an existing contact
    // (their name, tags, and pipeline stage are the producer's to manage).
    const { error } = await admin.from('contacts').upsert(
      {
        user_id: sellerUserId,
        email: normalizeEmail(email),
        name: email,
        label: 'lead',
        crm_status: 'prospect',
        notes: 'Created a buyer account and started favoriting tracks',
      },
      { onConflict: 'user_id,email', ignoreDuplicates: true },
    );
    if (error) log.warn('lead contact upsert failed', { email, error: error.message });
  } catch (err) {
    log.warn('lead contact upsert threw', { email, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Buyer-side profile endpoint, gated by the magic-link token (mig 060).
 *
 *   GET    /api/store/me?token=…   — listening history (last 100) +
 *                                    favourite track ids + playlists
 *                                    (with track ids per playlist)
 *
 *   POST   /api/store/me?token=…   — buyer-side mutations, dispatched
 *                                    by an `action` discriminator so
 *                                    we don't pay 4× the route-handler
 *                                    overhead for what is fundamentally
 *                                    one "buyer does a thing" surface:
 *
 *     { action: 'log_play',         track_id }
 *     { action: 'toggle_favorite',  track_id }
 *     { action: 'create_playlist',  name }
 *     { action: 'add_to_playlist',  playlist_id, track_id }
 *     { action: 'remove_from_playlist', playlist_id, track_id }
 *     { action: 'delete_playlist',  playlist_id }
 *
 * All writes go through the service-role client AFTER token verification.
 * The RLS policies on the new tables refuse public PostgREST access so
 * this route is the only path in.
 */

async function readClaims(token: string | null) {
  if (!token) return null;
  return verifyBuyerToken(token);
}

async function resolveEmail(req: NextRequest): Promise<{ email: string } | null> {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const sessionMode = searchParams.get('session') === '1';

  if (token) {
    const claims = await readClaims(token);
    return claims ? { email: claims.email } : null;
  }
  if (sessionMode) {
    const result = await requireUser();
    if (!result.ok) return null;
    const admin = createServiceClient();
    const { data: authUser } = await admin.auth.admin.getUserById(result.userId);
    const email = authUser?.user?.email;
    return email ? { email } : null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveEmail(req);
    if (!resolved) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    }
    const { email } = resolved;
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ email, history: [], favorites: [], playlists: [] });
    }
    const admin = createServiceClient();

    const [historyRes, favRes, plRes] = await Promise.all([
      admin
        .from('buyer_listening_history')
        .select('track_id, played_at')
        .eq('email', email)
        .order('played_at', { ascending: false })
        .limit(100),
      admin
        .from('buyer_favorites')
        .select('track_id, created_at')
        .eq('email', email)
        .order('created_at', { ascending: false }),
      admin
        .from('buyer_playlists')
        .select('id, name, created_at, updated_at')
        .eq('email', email)
        .order('updated_at', { ascending: false }),
    ]);

    const history = (historyRes.data ?? []) as Array<Omit<BuyerLibraryHistoryRow, 'track'>>;
    const favorites = (favRes.data ?? []) as Array<Omit<BuyerLibraryFavoriteRow, 'track'>>;
    const playlists = (plRes.data ?? []) as Array<{ id: string; name: string; created_at: string; updated_at: string }>;
    const playlistIds = playlists.map((p) => p.id);
    let playlistTracks: BuyerLibraryTrackJoinRow[] = [];
    if (playlistIds.length > 0) {
      const { data: junction } = await admin
        .from('buyer_playlist_tracks')
        .select('playlist_id, track_id, position')
        .in('playlist_id', playlistIds)
        .order('position', { ascending: true });
      playlistTracks = (junction ?? []) as BuyerLibraryTrackJoinRow[];
    }

    const trackIds = collectBuyerLibraryTrackIds({ history, favorites, playlistTracks });
    let tracks: BuyerLibraryTrackSummary[] = [];
    if (trackIds.length > 0) {
      const { data: trackRows } = await admin
        .from('tracks')
        .select('id,title,cover_url,type,bpm,key,scale,duration_seconds')
        .in('id', trackIds);
      tracks = (trackRows ?? []) as BuyerLibraryTrackSummary[];
    }

    return NextResponse.json(buildBuyerLibraryShape({
      email,
      history,
      favorites,
      playlists,
      playlistTracks,
      tracks,
    }));
  } catch (err) {
    return publicError(err);
  }
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('log_play'), track_id: z.string().uuid() }),
  z.object({ action: z.literal('toggle_favorite'), track_id: z.string().uuid() }),
  z.object({ action: z.literal('create_playlist'), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('add_to_playlist'), playlist_id: z.string().uuid(), track_id: z.string().uuid() }),
  z.object({ action: z.literal('remove_from_playlist'), playlist_id: z.string().uuid(), track_id: z.string().uuid() }),
  z.object({ action: z.literal('delete_playlist'), playlist_id: z.string().uuid() }),
]);

export async function POST(req: NextRequest) {
  try {
    const resolved = await resolveEmail(req);
    if (!resolved) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const admin = createServiceClient();
    const { email } = resolved;

    switch (parsed.data.action) {
      case 'log_play': {
        // Append-only history. We do NOT dedupe — repeated plays are
        // signal, not noise. Trim handled at read time via LIMIT.
        const { error } = await admin
          .from('buyer_listening_history')
          .insert({ email, track_id: parsed.data.track_id });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case 'toggle_favorite': {
        const { data: existing } = await admin
          .from('buyer_favorites')
          .select('track_id')
          .eq('email', email)
          .eq('track_id', parsed.data.track_id)
          .maybeSingle();
        if (existing) {
          const { error } = await admin
            .from('buyer_favorites')
            .delete()
            .eq('email', email)
            .eq('track_id', parsed.data.track_id);
          if (error) throw error;
          return NextResponse.json({ ok: true, favorited: false });
        }
        const { error } = await admin
          .from('buyer_favorites')
          .insert({ email, track_id: parsed.data.track_id });
        if (error) throw error;
        // Awaited, not fire-and-forget: this route runs on Vercel serverless,
        // where the function can freeze the instant the response is sent —
        // an un-awaited promise has no guarantee of ever finishing.
        await upsertLeadContact(admin, email, parsed.data.track_id);
        return NextResponse.json({ ok: true, favorited: true });
      }
      case 'create_playlist': {
        const { data, error } = await admin
          .from('buyer_playlists')
          .insert({ email, name: parsed.data.name })
          .select('id, name, created_at, updated_at')
          .single();
        if (error) throw error;
        return NextResponse.json({ playlist: { ...data, track_ids: [] } });
      }
      case 'add_to_playlist': {
        // Verify ownership (the playlist belongs to this buyer)
        const { data: own } = await admin
          .from('buyer_playlists')
          .select('id')
          .eq('id', parsed.data.playlist_id)
          .eq('email', email)
          .maybeSingle();
        if (!own) return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });

        // Position = current count
        const { data: tracksInList } = await admin
          .from('buyer_playlist_tracks')
          .select('track_id')
          .eq('playlist_id', parsed.data.playlist_id);
        const position = (tracksInList?.length ?? 0);
        const { error } = await admin
          .from('buyer_playlist_tracks')
          .upsert(
            { playlist_id: parsed.data.playlist_id, track_id: parsed.data.track_id, position },
            { onConflict: 'playlist_id,track_id' },
          );
        if (error) throw error;
        await admin
          .from('buyer_playlists')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', parsed.data.playlist_id)
          .eq('email', email);
        return NextResponse.json({ ok: true });
      }
      case 'remove_from_playlist': {
        const { data: own } = await admin
          .from('buyer_playlists')
          .select('id')
          .eq('id', parsed.data.playlist_id)
          .eq('email', email)
          .maybeSingle();
        if (!own) return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
        const { error } = await admin
          .from('buyer_playlist_tracks')
          .delete()
          .eq('playlist_id', parsed.data.playlist_id)
          .eq('track_id', parsed.data.track_id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case 'delete_playlist': {
        const { error } = await admin
          .from('buyer_playlists')
          .delete()
          .eq('id', parsed.data.playlist_id)
          .eq('email', email);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
    }
  } catch (err) {
    return publicError(err);
  }
}
