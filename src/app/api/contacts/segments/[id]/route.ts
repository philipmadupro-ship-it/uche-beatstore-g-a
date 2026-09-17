import { NextRequest, NextResponse } from 'next/server';
import { deleteOwned, updateOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ContactSegmentUpdateBodySchema } from '@/lib/contracts';

/**
 * Saved CRM segment mutations (mig 090).
 *
 *   PATCH  — rename, retarget the filters, or reorder. Previously missing:
 *            segments could only be created and deleted, so fixing a typo in
 *            a segment name meant deleting it and rebuilding the filters.
 *   DELETE — remove the segment.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, ContactSegmentUpdateBodySchema);
  if (!parsed.ok) return parsed.res;

  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }
  const next = patch.name !== undefined ? { ...patch, name: patch.name.trim() } : patch;

  const result = await updateOwned('contact_segments', id, next);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ segment: result });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('contact_segments', id);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ success: true });
}
