import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { z } from 'zod';

const log = createLogger('api.licenses');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LicenseBodySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  price_usd: z.number().nonnegative(),
  is_free: z.boolean().optional(),
  file_types: z.array(z.string()).min(1).max(6).optional(),
  stems_included: z.boolean().optional(),
  is_exclusive: z.boolean().optional(),
  streaming_limit: z.number().int().positive().optional().nullable(),
  distribution_limit: z.number().int().positive().optional().nullable(),
  commercial_rights: z.boolean().optional(),
  sync_rights: z.boolean().optional(),
  broadcast_rights: z.boolean().optional(),
  credit_required: z.boolean().optional(),
  sort_order: z.number().int().optional(),
}).strict();

/**
 * GET /api/licenses
 * Returns all license tiers for the authenticated producer,
 * ordered by sort_order asc.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from('licenses')
      .select('*')
      .eq('user_id', auth.userId)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ licenses: data ?? [] });
  } catch (err) {
    log.error('list failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * POST /api/licenses
 * Creates a new license tier for the authenticated producer.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = LicenseBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }

    const admin = createServiceClient();

    // Auto-assign sort_order as max + 1 if not specified
    let sortOrder = parsed.data.sort_order;
    if (sortOrder == null) {
      const { data: existing } = await admin
        .from('licenses')
        .select('sort_order')
        .eq('user_id', auth.userId)
        .order('sort_order', { ascending: false })
        .limit(1);
      sortOrder = ((existing?.[0]?.sort_order as number) ?? -1) + 1;
    }

    const { data, error } = await admin
      .from('licenses')
      .insert({
        user_id: auth.userId,
        ...parsed.data,
        sort_order: sortOrder,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ license: data }, { status: 201 });
  } catch (err) {
    log.error('create failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
