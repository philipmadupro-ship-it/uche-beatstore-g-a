import { NextRequest, NextResponse } from 'next/server';
import { deleteOwned, isErrorResponse } from '@/lib/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('contact_segments', id);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ success: true });
}
