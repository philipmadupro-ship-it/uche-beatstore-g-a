import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';

const log = createLogger('store.contract-alert');

type AlertClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { eq: (col: string, val: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> } };
    };
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/**
 * The license contract for a sale was made from terms that needed a fallback,
 * or the producer's own wording disagrees with the tier (LICENSE-04). The
 * contract still went out, and its Schedule of Terms governs; the producer
 * should hear about it. One notification per purchase (a webhook replay does
 * not repeat it), same convention as mp3-alert. Best-effort: never throws.
 */
export async function alertContractTerms(
  admin: AlertClient,
  params: { sellerUserId: string | null; purchaseId: string; reasons: string[] },
): Promise<void> {
  const { sellerUserId, purchaseId, reasons } = params;
  if (!sellerUserId || reasons.length === 0) return;
  try {
    const dedupeKey = `contract_terms_${purchaseId}`;
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', sellerUserId)
      .eq('data->>dedupe_key', dedupeKey)
      .maybeSingle();
    if (existing) return;
    const more = reasons.length > 3 ? ` · +${reasons.length - 3} more` : '';
    const { error } = await admin.from('notifications').insert({
      user_id: sellerUserId,
      kind: 'fulfillment_alert',
      title: 'A license contract needs a look',
      body: `${reasons.slice(0, 3).join(' · ')}${more}. The buyer's contract states the tier's exact terms in its Schedule of Terms, which governs.`.slice(0, 600),
      data: { dedupe_key: dedupeKey, purchase_id: purchaseId, alert_kind: 'contract_terms' },
    });
    if (error) log.warn('contract alert insert failed', { error: error.message });
  } catch (err) {
    log.warn('contract alert threw', { error: errorMessage(err) });
  }
}
