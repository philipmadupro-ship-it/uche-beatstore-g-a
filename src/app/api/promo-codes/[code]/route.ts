import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireProducer } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  active: z.boolean().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
}).strict();

/**
 * PATCH /api/promo-codes/[code]   — toggle active, change cap or expiry
 * DELETE /api/promo-codes/[code]  — remove the code entirely
 *
 * Owner-only (requireProducer + user_id match in the WHERE). uses_count
 * is system-managed via the RPC (mig 048); we don't expose a setter.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { code } = await params;
    const normalized = code.trim().toUpperCase();
    const raw = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const { data, error } = await admin
      .from('promo_codes')
      .update(parsed.data)
      .eq('code', normalized)
      .eq('user_id', userId)
      .select('code, discount_percent, discount_amount, max_uses, uses_count, active, expires_at, created_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Code not found' }, { status: 404 });
    return NextResponse.json({ code: data });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const { code } = await params;
    const normalized = code.trim().toUpperCase();
    const { error } = await admin
      .from('promo_codes')
      .delete()
      .eq('code', normalized)
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
