import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireProducer, createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/promo-codes   — list this producer's codes
 * POST /api/promo-codes   — create a new code
 *
 * Codes are scoped to the seller via user_id. Schema lives in
 * migration 047. We accept either a percentage or a flat amount,
 * never both. uses_count + active are managed by the system
 * (atomic increment via the RPC from mig 048; toggling via PATCH).
 */

export async function GET() {
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ codes: [] });
  }

  try {
    const { data, error } = await admin
      .from('promo_codes')
      .select('code, discount_percent, discount_amount, max_uses, uses_count, active, expires_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ codes: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

const createSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/i, 'A–Z, 0–9, dashes/underscores only'),
  discount_percent: z.number().min(0).max(100).optional(),
  discount_amount: z.number().min(0).optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
}).refine(
  (v) => (v.discount_percent ?? 0) > 0 !== (v.discount_amount ?? 0) > 0,
  { message: 'Set exactly one of discount_percent or discount_amount' },
);

export async function POST(req: NextRequest) {
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const normalized = parsed.data.code.trim().toUpperCase();

    // Duplicate guard — codes are globally unique (PK)
    const { data: existing } = await admin
      .from('promo_codes')
      .select('code')
      .eq('code', normalized)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'That code already exists' }, { status: 409 });
    }

    const { data, error } = await admin
      .from('promo_codes')
      .insert({
        code: normalized,
        user_id: userId,
        discount_percent: parsed.data.discount_percent ?? 0,
        discount_amount: parsed.data.discount_amount ?? 0,
        max_uses: parsed.data.max_uses ?? null,
        expires_at: parsed.data.expires_at ?? null,
        active: true,
      })
      .select('code, discount_percent, discount_amount, max_uses, uses_count, active, expires_at, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ code: data });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
