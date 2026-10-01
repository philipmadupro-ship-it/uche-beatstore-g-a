import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { selectIn } from '@/lib/db/chunked-in';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { contactGroups, sentByType, type RoleGroup } from '@/lib/contacts/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.roles');

interface ContactRow { id: string; name: string; email: string | null; avatar_url?: string | null; category: string | null; secondary_category?: string | null }
interface SendRow { contact_id: string; track_ids: string[] | null; share_token: string | null; sent_at: string | null }

/**
 * GET /api/contacts/roles?group=producer|label — the summary strip on the
 * Producers and Labels & A&R tabs of /contacts (lib/contacts/roles): for
 * each contact in that role (main or extra), what you have sent them by
 * type — loops, toplines, beats, songs, packs (a send whose share is a
 * project) — when you last sent, and the tracks they are credited on,
 * by type. A fixed set of batch queries; owner-filtered throughout.
 */
export async function GET(req: NextRequest) {
  const group = req.nextUrl.searchParams.get('group') as RoleGroup | null;
  if (group !== 'producer' && group !== 'label') return NextResponse.json({ error: 'group must be producer or label' }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ contacts: [] });
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    // secondary_category is mig 134; read it separately so its absence costs nothing.
    const { data, error } = await admin.from('contacts').select('id, name, email, avatar_url, category').eq('user_id', userId).limit(5000);
    if (error) throw error;
    let contacts = (data ?? []) as ContactRow[];
    const extra = await admin.from('contacts').select('id, secondary_category').eq('user_id', userId).not('secondary_category', 'is', null).limit(5000);
    if (!extra.error) {
      const byId = new Map(((extra.data ?? []) as Array<{ id: string; secondary_category: string | null }>).map((r) => [r.id, r.secondary_category]));
      contacts = contacts.map((c) => ({ ...c, secondary_category: byId.get(c.id) ?? null }));
    } else if (!isMissingSchema(extra.error)) throw extra.error;

    const inGroup = contacts.filter((c) => contactGroups(c).includes(group));
    if (inGroup.length === 0) return NextResponse.json({ contacts: [] });
    const ids = inGroup.map((c) => c.id);

    const [sends, credits] = await Promise.all([
      selectIn<SendRow>((chunk) => admin.from('beat_sends').select('contact_id, track_ids, share_token, sent_at').in('contact_id', chunk).order('sent_at', { ascending: false }).limit(2000), ids),
      selectIn<{ contact_id: string; track_id: string }>((chunk) => admin.from('track_collaborators').select('contact_id, track_id').in('contact_id', chunk), ids)
        .catch((e: unknown) => { if (isMissingSchema(e)) return []; throw e; }),
    ]);
    const trackIds = [...new Set([...sends.flatMap((s) => s.track_ids ?? []), ...credits.map((c) => c.track_id)])];
    const tokens = [...new Set(sends.map((s) => s.share_token).filter((t): t is string => !!t))];
    const [tracks, packTokens] = await Promise.all([
      trackIds.length ? selectIn<{ id: string; type: string | null }>((chunk) => admin.from('tracks').select('id, type').in('id', chunk).eq('user_id', userId), trackIds) : Promise.resolve([]),
      tokens.length ? selectIn<{ token: string }>((chunk) => admin.from('project_shares').select('token').in('token', chunk), tokens) : Promise.resolve([]),
    ]);
    const typeOf = new Map(tracks.map((t) => [t.id, t.type]));
    const packs = new Set(packTokens.map((p) => p.token));

    const out = inGroup.map((c) => {
      const mine = sends.filter((s) => s.contact_id === c.id);
      const credited = credits.filter((k) => k.contact_id === c.id && typeOf.has(k.track_id));
      return {
        contact: { id: c.id, name: c.name, email: c.email, avatar_url: c.avatar_url ?? null, category: c.category, secondary_category: c.secondary_category ?? null },
        sent: sentByType(mine.map((s) => ({ track_ids: s.track_ids, kind: s.share_token && packs.has(s.share_token) ? 'project' : null })), typeOf),
        lastSentAt: mine[0]?.sent_at ?? null,
        credited: {
          total: new Set(credited.map((k) => k.track_id)).size,
          loops: new Set(credited.filter((k) => typeOf.get(k.track_id) === 'loop').map((k) => k.track_id)).size,
        },
      };
    }).sort((a, b) => String(b.lastSentAt ?? '').localeCompare(String(a.lastSentAt ?? '')) || a.contact.name.localeCompare(b.contact.name));

    return NextResponse.json({ contacts: out });
  } catch (err) {
    log.error('roles summary failed', { group, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
