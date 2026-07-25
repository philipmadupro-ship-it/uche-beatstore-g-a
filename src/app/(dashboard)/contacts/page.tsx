import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ContactsView } from '@/components/crm/ContactsView';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { isSupabaseConfigured, getAll } from '@/lib/local-store';
import type { Contact, BeatSend } from '@/lib/types';

// Server Component — fetches contacts + beat-sends on the server so the
// page renders with content on first paint instead of flashing a spinner.
// All interactivity (search, modals, refetch on mutate) lives in
// <ContactsView>, the client island.
export const dynamic = 'force-dynamic';

async function loadInitialData(): Promise<{
  contacts: Contact[];
  beatSends: BeatSend[];
  error: string | null;
}> {
  try {
    if (!isSupabaseConfigured()) {
      return {
        contacts: getAll('contacts') as Contact[],
        beatSends: getAll('beat_sends') as BeatSend[],
        error: null,
      };
    }
    const cookieClient = await createClient();
    const { data: { user } } = await cookieClient.auth.getUser();
    if (!user) {
      // Proxy should have already redirected, but handle defensively.
      return { contacts: [], beatSends: [], error: 'Not authenticated' };
    }

    // Use the service-role admin client with an explicit user_id filter
    // (and a contacts join for beat_sends) so we don't depend on the
    // exact RLS posture. The previous version had two bugs:
    //   1. ordered `beat_sends` by `created_at` — that column doesn't
    //      exist (the schema is `sent_at`), making the query fail and
    //      the whole load() throw to the catch block, which the UI then
    //      interpreted as "the page is broken".
    //   2. relied on RLS scoping on `contacts`, which post-migration-010
    //      is strict — fine, but we may as well filter explicitly so the
    //      DB doesn't have to evaluate the policy per row.
    const admin = createServiceClient();
    // Parallelise — beat_sends is scoped via contacts!inner(user_id) so it
    // no longer needs contactIds from the first query (one round-trip each).
    const [contactsRes, sendsRes] = await Promise.all([
      admin
        .from('contacts')
        .select('*')
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .order('created_at', { ascending: false }),
      admin
        .from('beat_sends')
        .select('*, contacts!inner(user_id)')
        .eq('contacts.user_id', user.id)
        .order('sent_at', { ascending: false }),
    ]);

    if (contactsRes.error) {
      console.error('Contacts SSR contacts query failed:', contactsRes.error);
    }
    if (sendsRes.error) {
      console.error('Contacts SSR sends query failed:', sendsRes.error);
    }

    return {
      contacts: (contactsRes.data || []) as Contact[],
      beatSends: (sendsRes.data || []) as BeatSend[],
      error: contactsRes.error?.message || null,
    };
  } catch (err: unknown) {
    console.error('Contacts SSR fetch failed:', err);
    return { contacts: [], beatSends: [], error: errorMessage(err) || 'Fetch failed' };
  }
}

export default async function ContactsPage() {
  const { contacts, beatSends, error } = await loadInitialData();
  return (
    <DashboardLayout>
      <ContactsView
        initialContacts={contacts}
        initialBeatSends={beatSends}
        fetchError={error}
      />
    </DashboardLayout>
  );
}
