import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership, createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { z } from 'zod';

const log = createLogger('api.licenses.id');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  price_usd: z.number().nonnegative().optional(),
  is_free: z.boolean().optional(),
  file_types: z.array(z.string()).min(1).max(6).optional(),
  stems_included: z.boolean().optional(),
  is_exclusive: z.boolean().optional(),
  streaming_limit: z.number().int().positive().nullable().optional(),
  distribution_limit: z.number().int().positive().nullable().optional(),
  commercial_rights: z.boolean().optional(),
  sync_rights: z.boolean().optional(),
  broadcast_rights: z.boolean().optional(),
  credit_required: z.boolean().optional(),
  sort_order: z.number().int().optional(),
}).strict();

/**
 * PATCH /api/licenses/[id]
 * Updates a license tier. Owner-gated via requireRowOwnership.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRowOwnership('licenses', id);
  if (!auth.ok) return auth.res;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const admin = createServiceClient();
    const { data, error } = await admin
      .from('licenses')
      .update(parsed.data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ license: data });
  } catch (err) {
    log.error('update failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/licenses/[id]
 * Deletes a license tier. Owner-gated.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRowOwnership('licenses', id);
  if (!auth.ok) return auth.res;

  try {
    const admin = createServiceClient();
    const { error } = await admin.from('licenses').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error('delete failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
