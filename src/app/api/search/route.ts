import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * GET /api/search?q=foo
 *
 * Lightweight cross-entity search for the command palette.
 * Hits tracks, projects, contacts in parallel and returns up to 5 of each.
 *
 * Scoped to the calling user — without the user_id filters the command
 * palette would surface every tenant's titles and contact emails.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 1) {
    return NextResponse.json({ tracks: [], projects: [], contacts: [] });
  }

  try {
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ tracks: [], projects: [], contacts: [] });
      }

      const sb = createServiceClient();

      const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;
      // For the .or() filter string, also strip PostgREST grammar chars
      // (comma, parens, backslash, dot) — otherwise a crafted query could
      // break the filter or inject extra OR conditions. (Results stay scoped
      // to user_id by the AND below, but we don't rely on that alone.)
      const orTerm = q.replace(/[%_]/g, '\\$&').replace(/[(),\\.]/g, ' ').trim();
      const orPattern = `%${orTerm}%`;
      const [tracksRes, projectsRes, contactsRes] = await Promise.all([
        sb.from('tracks').select('id, title, type, cover_url, audio_url')
          .ilike('title', pattern).eq('user_id', user.id).limit(5),
        sb.from('projects').select('id, name, cover_url')
          .ilike('name', pattern).eq('user_id', user.id).limit(5),
        sb.from('contacts').select('id, name, email, role, label')
          .or(`name.ilike.${orPattern},email.ilike.${orPattern}`).eq('user_id', user.id).limit(5),
      ]);

      return NextResponse.json({
        tracks: tracksRes.data || [],
        projects: projectsRes.data || [],
        contacts: contactsRes.data || [],
      });
    }

    // Local-store fallback
    const lower = q.toLowerCase();
    const matches = (s: string | null | undefined) =>
      (s || '').toLowerCase().includes(lower);

    const tracks = (getAll('tracks') as any[])
      .filter((t) => matches(t.title))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        cover_url: t.cover_url,
        audio_url: t.audio_url,
      }));

    const projects = (getAll('projects') as any[])
      .filter((p) => matches(p.name))
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, cover_url: p.cover_url }));

    const contacts = (getAll('contacts') as any[])
      .filter((c) => matches(c.name) || matches(c.email))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role, label: c.label }));

    return NextResponse.json({ tracks, projects, contacts });
  } catch (err: any) {
    console.error('Search error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
