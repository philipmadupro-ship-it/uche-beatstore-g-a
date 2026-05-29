import { NextRequest, NextResponse } from 'next/server';
import { deleteOwned, isErrorResponse } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** DELETE /api/smart-playlists/[id] — remove a saved view. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('smart_playlists', id);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ success: true });
}
