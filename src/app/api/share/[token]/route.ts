import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, update, deleteRow, insert, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { errorMessage } from '@/lib/errors';
import { publicError } from '@/lib/api-error';
import { createLogger } from '@/lib/log';
import { signedSharePreviewUrl } from '@/lib/share-media-token';

const log = createLogger('api.share.token');

function hashIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`${ip}:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'antigravity'}`).digest('hex').slice(0, 32);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const passwordHeader = req.headers.get('x-share-password') || '';
  try {
    if (isSupabaseConfigured()) {
      const supabaseAdmin = createServiceClient();

      const { data: share, error: shareError } = await supabaseAdmin
        .from('share_links')
        .select('*')
        .eq('token', token)
        .single();

      if (shareError || !share) {
        return NextResponse.json({ error: 'Share link not found or expired' }, { status: 404 });
      }

      if (share.revoked_at) {
        return NextResponse.json({ error: 'This link has been revoked' }, { status: 410 });
      }

      if (share.expires_at && new Date(share.expires_at) < new Date()) {
        return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
      }

      if (share.password_hash) {
        if (!passwordHeader) {
          return NextResponse.json({ requiresPassword: true }, { status: 401 });
        }
        const ok = await bcrypt.compare(passwordHeader, share.password_hash);
        if (!ok) {
          return NextResponse.json({ requiresPassword: true, error: 'Incorrect password' }, { status: 401 });
        }
      }

      const [tracksRes, stemsRes] = await Promise.all([
        supabaseAdmin
          .from('tracks')
          .select('id, title, type, audio_url, peaks_url, cover_url, duration_seconds, bpm, key, scale, lyrics')
          .in('id', share.track_ids),
        supabaseAdmin
          .from('stems')
          .select('track_id, status, vocals_url, drums_url, bass_url, other_url')
          .in('track_id', share.track_ids)
      ]);
      const tracks = tracksRes.data || [];
      const safeTracks = tracks.map((track: any) => ({
        ...track,
        audio_url: signedSharePreviewUrl(token, track.id),
      }));
      const stems = share.allow_downloads
        ? (stemsRes.data || []).map((stem: any) => ({
            track_id: stem.track_id,
            status: stem.status,
          }))
        : [];

      let creator: any = null;
      if (share.user_id) {
        const { data: profile } = await supabaseAdmin
          .from('creator_profiles')
          .select('display_name, bio, hero_image_url, credits, license_lease_price_usd, license_exclusive_price_usd, license_notes, instagram_handle, twitter_handle, spotify_url, soundcloud_url, website_url, contact_email')
          .eq('user_id', share.user_id)
          .maybeSingle();
        creator = profile || null;
      }

      await supabaseAdmin
        .from('share_links')
        .update({ plays: (share.plays || 0) + 1 })
        .eq('token', token);

      // Log a play event (one per link view; per-track events come from the player)
      try {
        await supabaseAdmin.from('share_plays').insert({
          link_token: token,
          track_id: null,
          ip_hash: hashIp(req),
          played_at: new Date().toISOString(),
        });
      } catch (err) {
        log.warn('share_plays insert failed:', { error: errorMessage(err) });
      }

      const { password_hash, ...safeShare } = share;
      return NextResponse.json({ share: safeShare, tracks: safeTracks, creator, stems });
    }

    // Local fallback
    const allLinks = getAll('share_links');
    const share = allLinks.find((s: any) => s.token === token);

    if (!share) {
      return NextResponse.json({ error: 'Share link not found or expired' }, { status: 404 });
    }

    if (share.revoked_at) {
      return NextResponse.json({ error: 'This link has been revoked' }, { status: 410 });
    }

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
    }

    if (share.password_hash) {
      if (!passwordHeader) {
        return NextResponse.json({ requiresPassword: true }, { status: 401 });
      }
      const ok = await bcrypt.compare(passwordHeader, share.password_hash);
      if (!ok) {
        return NextResponse.json({ requiresPassword: true, error: 'Incorrect password' }, { status: 401 });
      }
    }

    const allTracks = getAll('tracks');
    const trackIdSet = new Set(share.track_ids || []);
    // Preserve original ordering from share.track_ids
    const tracks = (share.track_ids || [])
      .map((id: string) => allTracks.find((t: any) => t.id === id))
      .filter(Boolean)
      .map((track: any) => ({ ...track, audio_url: signedSharePreviewUrl(token, track.id) }));

    // Fetch mock stems
    const allStems = getAll('stems' as any) || [];
    const stems = share.allow_downloads
      ? allStems
          .filter((s: any) => trackIdSet.has(s.track_id))
          .map((stem: any) => ({ track_id: stem.track_id, status: stem.status }))
      : [];

    // Fetch mock creator profile
    const allProfiles = getAll('creator_profiles' as any) || [];
    const creator = allProfiles.find((p: any) => p.user_id === 'local-user') || null;

    update('share_links', share.id, { plays: (share.plays || 0) + 1 });

    try {
      insert('share_plays', {
        link_token: token,
        track_id: null,
        ip_hash: hashIp(req),
        played_at: new Date().toISOString(),
      });
    } catch (err) {
      log.warn('share_plays insert failed:', { error: errorMessage(err) });
    }

    const { password_hash, ...safeShare } = share;
    return NextResponse.json({ share: safeShare, tracks, creator, stems });
  } catch (error) {
    log.error('share GET failed', { token, error: errorMessage(error) });
    return publicError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    if (isSupabaseConfigured()) {
      // Share tokens are public-by-design (recipients get the URL). Without an
      // auth check, any recipient could DELETE the link out from under the
      // owner. Require the caller to be authenticated AND to own the row.
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const supabase = createServiceClient();

      const { data: existing, error: lookupError } = await supabase
        .from('share_links')
        .select('id, user_id')
        .eq('token', token)
        .single();
      if (lookupError || !existing) {
        return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      }
      if (existing.user_id && existing.user_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const { error } = await supabase.from('share_links').delete().eq('token', token);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    const all = getAll('share_links');
    const link = all.find((l: any) => l.token === token);
    if (link) deleteRow('share_links', link.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return publicError(error);
  }
}

/**
 * PATCH /api/share/[token]
 *
 * Owner-only edit for the link's mutable fields. Whitelisted body —
 * passing anything outside the whitelist is silently dropped rather
 * than 400'd so the client can post a partial update without
 * tracking which keys are editable.
 *
 *   title             — display label (search/listing)
 *   allow_downloads   — toggles the download CTA on the share page
 *   expires_days      — 0 / null = clear expiry; positive int =
 *                       set expires_at to now + N days
 *   password          — null clears, string sets a new hash
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, any> = {};
    if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200) || null;
    if (typeof body.allow_downloads === 'boolean') patch.allow_downloads = body.allow_downloads;
    if (body.expires_days != null) {
      const days = Number(body.expires_days);
      patch.expires_at = days > 0
        ? new Date(Date.now() + days * 86400000).toISOString()
        : null;
    }
    if (body.password === null) {
      patch.password_hash = null;
    } else if (typeof body.password === 'string' && body.password.length > 0) {
      patch.password_hash = await bcrypt.hash(body.password, 10);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 });
    }

    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const supabase = createServiceClient();
      const { data: existing } = await supabase
        .from('share_links')
        .select('id, user_id')
        .eq('token', token)
        .single();
      if (!existing) {
        return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      }
      if (existing.user_id && existing.user_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const { data, error } = await supabase
        .from('share_links')
        .update(patch)
        .eq('token', token)
        .select('*')
        .single();
      if (error) throw error;
      const { password_hash: _hash, ...safe } = data;
      return NextResponse.json({ share: safe });
    }

    // Local-store fallback
    const all = getAll('share_links');
    const link = all.find((l: any) => l.token === token);
    if (!link) return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    const updated = update('share_links', link.id, patch);
    const { password_hash: _h, ...safe } = updated as any;
    return NextResponse.json({ share: safe });
  } catch (error) {
    log.error('share PATCH failed', { token, error: errorMessage(error) });
    return publicError(error);
  }
}
