import { NextRequest, NextResponse } from 'next/server';
import { requireProducer } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { ErasureRequestSchema } from '@/lib/contracts';
import { normalizeEmail, buildErasurePlan } from '@/lib/privacy/erase';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.privacy.erase');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Buyer data-erasure (GDPR / CCPA "right to be forgotten").
 *
 * Producer-initiated: the buyer emails the producer (the data controller),
 * who triggers this from Settings. Only a verified producer may call it
 * (`requireProducer`): buyers sign in through the same Supabase auth, and
 * several buyer tables are keyed on email alone.
 *
 * What happens to each table is `buildErasurePlan` in `lib/privacy/erase`:
 * business records (sales, offers, delivery emails, the CRM contact,
 * comments) are anonymised so the accounting survives; rows that exist only
 * because of the person (favourites, history, playlists, follows, drop
 * subscriptions, free downloads, abandoned carts) are deleted.
 *
 * Steps run in order and stop at the first error, reporting what was already
 * done. Every step is idempotent, so re-running after a failure is safe.
 */
export async function POST(req: NextRequest) {
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ErasureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const counts: Record<string, number> = {};

  for (const step of buildErasurePlan(email)) {
    try {
      const base = step.action === 'delete'
        ? admin.from(step.table).delete()
        : admin.from(step.table).update(step.patch ?? {});
      let query = base.eq(step.emailColumn, email);
      if (step.scope) query = query.eq(step.scope, userId);
      if (step.where) {
        query = step.where.op === 'eq'
          ? query.eq(step.where.column, step.where.value)
          : query.neq(step.where.column, step.where.value);
      }
      const { data, error } = await query.select();
      if (error) throw error;
      counts[step.key] = (counts[step.key] ?? 0) + (data?.length ?? 0);
    } catch (err) {
      // Never log the raw email: that is the PII being erased.
      log.error('erasure step failed', { sellerUserId: userId, table: step.table, error: errorMessage(err) });
      return NextResponse.json(
        { error: `Erasure stopped at ${step.table}: ${errorMessage(err)}. Re-run to finish; completed steps are safe to repeat.`, partial: counts },
        { status: 500 },
      );
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log.info('buyer data erased', { sellerUserId: userId, total, counts });
  return NextResponse.json({ erased: true, total, ...counts });
}
