import { NextRequest, NextResponse } from 'next/server';
import { scopedList, insertOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { FolderCreateBodySchema } from '@/lib/contracts';

/**
 * Project folders (mig 082) — multi-membership collections for organizing
 * the projects list. Owner-scoped via the db facade.
 *
 *   GET  → { folders: [...] }  (ordered by position, then created)
 *   POST → { folder }          (create)
 */
export async function GET() {
  type FolderRow = { id: string; user_id: string; name: string; position: number; created_at: string };
  const folders = await scopedList<FolderRow>('project_folders', {
    orderBy: 'position',
    ascending: true,
    includeNullOwner: false,
  });
  if (isErrorResponse(folders)) return folders;
  return NextResponse.json({ folders });
}

export async function POST(req: NextRequest) {
  const parsed = await readBody(req, FolderCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const result = await insertOwned('project_folders', { name: parsed.data.name.trim(), position: 0 });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ folder: result });
}
