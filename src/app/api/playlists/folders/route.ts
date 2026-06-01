import { NextRequest, NextResponse } from 'next/server';
import { scopedList, insertOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { PlaylistFolderCreateBodySchema } from '@/lib/contracts';

export async function GET() {
  const folders = await scopedList('playlist_folders', { orderBy: 'position', ascending: true, includeNullOwner: false });
  if (isErrorResponse(folders)) return folders;
  return NextResponse.json({ folders });
}

export async function POST(req: NextRequest) {
  const parsed = await readBody(req, PlaylistFolderCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const result = await insertOwned('playlist_folders', { name: parsed.data.name.trim(), color: parsed.data.color ?? null, position: 0 });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ folder: result });
}
