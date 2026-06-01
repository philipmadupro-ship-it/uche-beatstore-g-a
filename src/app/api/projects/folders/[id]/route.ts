import { NextRequest, NextResponse } from 'next/server';
import { updateOwned, deleteOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { FolderPatchBodySchema } from '@/lib/contracts';

/**
 * Rename / reorder / delete a project folder (mig 082). Owner-gated via the
 * facade; deleting a folder cascades its project_folder_items membership rows.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, FolderPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const result = await updateOwned('project_folders', id, parsed.data);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ folder: result });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('project_folders', id);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ success: true });
}
