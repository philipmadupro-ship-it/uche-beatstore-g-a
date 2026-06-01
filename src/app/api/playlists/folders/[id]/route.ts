import { NextRequest, NextResponse } from 'next/server';
import { updateOwned, deleteOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { PlaylistFolderPatchBodySchema } from '@/lib/contracts';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, PlaylistFolderPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const result = await updateOwned('playlist_folders', id, parsed.data);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ folder: result });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('playlist_folders', id);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ success: true });
}
