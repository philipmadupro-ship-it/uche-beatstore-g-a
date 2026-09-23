import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ContactsView } from '@/components/crm/ContactsView';
import { FreeDownloadLeads } from '@/components/crm/FreeDownloadLeads';
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
        // Strict owner match, same as the beat_sends query below. These two
        // used to disagree — contacts included legacy null-owner rows while
        // beat_sends did not — so an orphan contact rendered with a lead score
        // and an empty send history. Mig 111 adopts those rows onto the owner.
        .eq('user_id', user.id)
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
      {/* Sits above the CRM: these are people who already wanted the music
          enough to hand over an address, and until now the list was invisible. */}
      <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
        <FreeDownloadLeads />
      </div>
      <ContactsView
        initialContacts={contacts}
        initialBeatSends={beatSends}
        fetchError={error}
      />
    </DashboardLayout>
  );
}
