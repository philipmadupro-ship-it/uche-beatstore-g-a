import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { rateLimitDurable, clientIp } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().min(1).max(50),
  seller_user_id: z.string().uuid().optional(),
});

/**
 * POST /api/store/promo
 *
 * Validate a promo code and return its discount terms.
 * Body: { code: string, seller_user_id?: string }
 *
 * Response:
 *   { valid: true,  discount_percent, discount_amount, code }
 *   { valid: false, error: string }
 *
 * The optional seller_user_id scopes the check to a specific producer so
 * cross-seller codes don't accidentally apply to the wrong storefront.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ valid: false, error: 'Promo codes not available in offline mode' });
  }

  try {
    // Strict limit — promo validation is the enumeration surface (probe codes
    // until one returns valid). Per-IP, 10 per minute.
    if (!(await rateLimitDurable(`promo:${clientIp(req)}`, 10, 60_000))) {
      return NextResponse.json({ valid: false, error: 'Too many attempts — try again shortly.' }, { status: 429 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ valid: false, error: 'Invalid request' }, { status: 400 });
    }

    const { code, seller_user_id } = parsed.data;
    const normalized = code.trim().toUpperCase();

    const admin = createServiceClient();
    // Codes are stored canonically upper-cased (the create route normalizes),
    // and `normalized` is already upper-cased — so an exact match served by
    // the `code` primary-key index beats an unindexed ILIKE scan.
    const { data: row } = await admin
      .from('promo_codes')
      .select('*')
      .eq('code', normalized)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ valid: false, error: 'Invalid code' });
    }

    if (!row.active) {
      return NextResponse.json({ valid: false, error: 'Code is no longer active' });
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: 'Code has expired' });
    }

    if (row.max_uses != null && row.uses_count >= row.max_uses) {
      return NextResponse.json({ valid: false, error: 'Code usage limit reached' });
    }

    // If a seller was specified, ensure the code belongs to that seller
    if (seller_user_id && row.user_id !== seller_user_id) {
      return NextResponse.json({ valid: false, error: 'Code not valid for this seller' });
    }

    return NextResponse.json({
      valid: true,
      code: row.code,
      discount_percent: row.discount_percent ?? 0,
      discount_amount: row.discount_amount ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ valid: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
