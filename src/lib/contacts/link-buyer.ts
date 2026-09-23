import { normalizeEmail } from '@/lib/contacts/email';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('contacts.link-buyer');

/** Minimal shape of the service-role client this helper needs. */
export interface BuyerCrmClient {
  from(table: string): {
    upsert(values: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }):
      PromiseLike<{ error: { message: string } | null }>;
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          select(cols: string): {
            maybeSingle(): PromiseLike<{ data: { id?: string } | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
}

export interface LinkBuyerParams {
  sellerUserId: string;
  email: string;
  name: string;
  notes: string;
}

/**
 * Link a paying buyer to the seller's CRM, atomically.
 *
 * Migration 096 created `contacts_user_email_uniq (user_id, email)` explicitly
 * so this could be an upsert — but the webhook kept doing SELECT-then-INSERT.
 * Once the index existed that was actively harmful: two concurrent webhook
 * deliveries for the same buyer both miss the SELECT, the second INSERT trips
 * the unique violation, and the surrounding catch swallows it — leaving the
 * contact id undefined so the purchase never reached the activity timeline.
 *
 * Two statements, both race-safe:
 *   1. ON CONFLICT DO NOTHING insert. `ignoreDuplicates` matters — a plain
 *      upsert would overwrite the name/notes/role the producer has curated on
 *      a returning buyer's contact.
 *   2. Update the pipeline status and read the id back. The row is guaranteed
 *      to exist by now, so this both advances the stage and resolves the id
 *      for callers, whether the contact was just created or already existed.
 *
 * Both status columns move together. `buyer_pipeline_status` alone is not
 * enough: the stage cell in the CRM reads `crm_status`, so before this a sale
 * never advanced the pipeline the producer actually manages. The write is
 * unconditional — a completed purchase is the strongest signal there is, and
 * it should override an earlier hand-set stage.
 *
 * Returns the contact id, or null if the link could not be made. Never throws:
 * a CRM failure must not fail paid fulfillment.
 */
export async function linkBuyerToCrm(
  admin: BuyerCrmClient,
  params: LinkBuyerParams,
): Promise<string | null> {
  const email = normalizeEmail(params.email);
  if (!email) return null;

  try {
    const { error: insertError } = await admin.from('contacts').upsert(
      {
        user_id: params.sellerUserId,
        name: params.name,
        email,
        role: 'artist',
        label: 'buyer',
        notes: params.notes,
        buyer_pipeline_status: 'purchased',
        crm_status: 'customer',
      },
      { onConflict: 'user_id,email', ignoreDuplicates: true },
    );
    // supabase-js RESOLVES with { error } instead of throwing, so this has to
    // be inspected explicitly — a catch block alone would never see it.
    if (insertError) {
      log.warn('buyer contact insert failed', { error: insertError.message });
      return null;
    }

    const { data: contact, error: updateError } = await admin
      .from('contacts')
      .update({ buyer_pipeline_status: 'purchased', crm_status: 'customer' })
      .eq('user_id', params.sellerUserId)
      .eq('email', email)
      .select('id')
      .maybeSingle();
    if (updateError) {
      log.warn('buyer contact status update failed', { error: updateError.message });
      return null;
    }
    return contact?.id ?? null;
  } catch (err) {
    log.warn('buyer CRM link threw', { error: errorMessage(err) });
    return null;
  }
}
