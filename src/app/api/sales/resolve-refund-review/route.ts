import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.sales.resolve-refund-review');

const bodySchema = z.object({ purchase_id: z.string().uuid() });

/**
 * POST /api/sales/resolve-refund-review  body: { purchase_id }
 *
 * Clears `needs_refund_review` once the producer has manually refunded the
 * buyer (via the Stripe dashboard link on the same sales row — this repo has
 * no automated refund-issuing code, and this route doesn't call Stripe at
 * all). Purely an acknowledgement so the flag stops surfacing on /sales.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const { userId, admin } = auth;

    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, persisted: false });

    const { data: purchase } = await admin
      .from('license_purchases')
      .select('id, seller_user_id')
      .eq('id', parsed.data.purchase_id)
      .maybeSingle();

    if (!purchase || (purchase as { seller_user_id: string | null }).seller_user_id !== userId) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    const { error } = await admin
      .from('license_purchases')
      .update({ needs_refund_review: false })
      .eq('id', parsed.data.purchase_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('resolve refund review failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
