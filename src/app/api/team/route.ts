import { NextResponse } from 'next/server';
import { requireProducer } from '@/lib/auth/ownership';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await requireProducer();
    if (!result.ok) return result.res;

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ members: [] });
    }

    const admin = createServiceClient();
    const { data, error } = await admin
      .from('team_members')
      .select('user_id, role, email, name')
      .order('role', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ members: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
