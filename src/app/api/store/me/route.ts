import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { verifyBuyerToken } from '@/lib/buyer-tokens';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET(req: NextRequest) {
  try {
    const token = new URL(req.url).searchParams.get('token');
    const claims = await readClaims(token);
    if (!claims) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ email: claims.email, history: [], favorites: [], playlists: [] });
    }
    const admin = createServiceClient();
    const email = claims.email;

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

    const playlists = (plRes.data ?? []) as Array<{ id: string; name: string; created_at: string; updated_at: string }>;
    const playlistIds = playlists.map((p) => p.id);
    let trackMap: Record<string, string[]> = {};
    if (playlistIds.length > 0) {
      const { data: junction } = await admin
        .from('buyer_playlist_tracks')
        .select('playlist_id, track_id, position')
        .in('playlist_id', playlistIds)
        .order('position', { ascending: true });
      for (const r of (junction ?? []) as any[]) {
        (trackMap[r.playlist_id] ??= []).push(r.track_id);
      }
    }

    return NextResponse.json({
      email,
      history: historyRes.data ?? [],
      favorites: favRes.data ?? [],
      playlists: playlists.map((p) => ({
        ...p,
        track_ids: trackMap[p.id] ?? [],
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
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
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const claims = await readClaims(token);
    if (!claims) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const admin = createServiceClient();
    const email = claims.email;

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
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
