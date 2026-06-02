import { NextRequest, NextResponse } from 'next/server';
import { scopedList, insertOwned, isErrorResponse } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ContactSegmentCreateBodySchema } from '@/lib/contracts';

/** Saved CRM filter segments (mig 090). */
export async function GET() {
  const segments = await scopedList('contact_segments', { orderBy: 'position', ascending: true, includeNullOwner: false });
  if (isErrorResponse(segments)) return segments;
  return NextResponse.json({ segments });
}

export async function POST(req: NextRequest) {
  const parsed = await readBody(req, ContactSegmentCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const result = await insertOwned('contact_segments', { name: parsed.data.name.trim(), filters: parsed.data.filters, position: 0 });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ segment: result });
}
