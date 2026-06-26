import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert, getAll, createServiceClient } from '@/lib/db';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.share');
import { readBody } from '@/lib/validate';
import { ShareCreateBodySchema } from '@/lib/contracts';

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
    const parsed = await readBody(req, ShareCreateBodySchema);
    if (!parsed.ok) return parsed.res;
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
    } = parsed.data;

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
      // Resolve the current user via the cookie client, then write with the
      // service-role admin client to bypass RLS reliably (the user-scoped
      // INSERT policy isn't applied consistently across migrations).
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();

      const admin = createServiceClient();

      const { data, error } = await admin
        .from('share_links')
        .insert({ ...payload, user_id: user?.id || null })
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
    log.error('Share Link Error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
