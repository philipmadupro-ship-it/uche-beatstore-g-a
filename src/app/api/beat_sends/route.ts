import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getAll, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/errors';
import { selectInChunks } from '@/lib/db-in-chunks';

/**
 * GET /api/beat_sends
 *
 * beat_sends has no `user_id` column — we scope it by joining through
 * `contacts.user_id`. Without this two-step the service-role client
 * would return every user's send log. Pre-facade this used a one-off
 * supabase-js import; now goes through the shared createServiceClient.
 */
export async function GET() {
  try {
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ sends: [] });
      }

      const supabase = createServiceClient();
      const { data: ownContacts } = await supabase
        .from('contacts')
        .select('id')
        .eq('user_id', user.id);
      const ids = (ownContacts ?? []).map((c: { id: string }) => c.id);
      if (ids.length === 0) return NextResponse.json({ sends: [] });

      // Chunked, then sorted here: the id list is one entry per contact, which
      // overflows the PostgREST request URL as a CRM grows. Ordering has to
      // move client-side because it must span batches.
      const rows = await selectInChunks<{ sent_at?: string | null }>(ids, (batch) =>
        supabase.from('beat_sends').select('*').in('contact_id', batch));
      rows.sort((a, b) => String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? '')));
      return NextResponse.json({ sends: rows });
    }
    return NextResponse.json({ sends: getAll('beat_sends') });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
