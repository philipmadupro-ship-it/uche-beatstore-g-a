import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert, getAll, createServiceClient, requireUser } from '@/lib/db';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { errorMessage } from '@/lib/errors';

export async function GET() {
  try {
    if (isSupabaseConfigured()) {
      // Scope to the caller. Without this filter the service-role client
      // would happily return every other user's share links.
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ links: [] });
      }

      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return NextResponse.json({ links: data || [] });
    }
    const links = getAll('share_links').slice().reverse();
    return NextResponse.json({ links });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      track_ids,
      title,
      cover_url,
      project_id,
      kind,
      allow_downloads,
      expires_days,
      password,
      recipient_kind,
    } = body;

    if (!track_ids || !Array.isArray(track_ids) || track_ids.length === 0) {
      return NextResponse.json({ error: 'Missing track_ids' }, { status: 400 });
    }
    const uniqueTrackIds = [...new Set(track_ids)];
    if (uniqueTrackIds.some((id) => typeof id !== 'string' || id.length === 0)) {
      return NextResponse.json({ error: 'Invalid track_ids' }, { status: 400 });
    }

    const token = nanoid(12);
    let password_hash: string | null = null;
    if (password) {
      password_hash = await bcrypt.hash(password, 10);
    }

    const expires_at =
      expires_days && expires_days > 0
        ? new Date(Date.now() + expires_days * 86400000).toISOString()
        : null;

    const APP_URL = getAppUrl();

    const payload = {
      token,
      track_ids,
      title: title || 'Shared tracks',
      cover_url: cover_url || null,
      project_id: project_id || null,
      kind: kind || (track_ids.length > 1 ? 'project' : 'track'),
      allow_downloads: allow_downloads !== false,
      expires_at,
      password_hash,
      plays: 0,
      recipient_kind: recipient_kind || 'client',
    };

    if (isSupabaseConfigured()) {
      const owner = await requireUser();
      if (!owner.ok) return owner.res;

      const { data: ownedTracks, error: tracksError } = await owner.admin
        .from('tracks')
        .select('id')
        .eq('user_id', owner.userId)
        .in('id', uniqueTrackIds as string[]);
      if (tracksError) throw tracksError;

      const ownedIds = new Set((ownedTracks ?? []).map((track: any) => track.id));
      if (ownedIds.size !== uniqueTrackIds.length) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const { data, error } = await owner.admin
        .from('share_links')
        .insert({ ...payload, user_id: owner.userId })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({
        url: `${APP_URL}/share/${token}`,
        token,
        ...data,
      });
    } else {
      const data = insert('share_links', payload);
      return NextResponse.json({
        url: `${APP_URL}/share/${token}`,
        token,
        ...data,
      });
    }
  } catch (error) {
    console.error('Share Link Error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
