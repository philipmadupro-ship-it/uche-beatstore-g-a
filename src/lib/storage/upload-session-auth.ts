import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/local-store';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { UploadSession } from './upload-sessions';

export async function requireUploadSessionOwner(session: UploadSession): Promise<
  | { ok: true; userId: string | null }
  | { ok: false; res: NextResponse }
> {
  if (!isSupabaseConfigured()) return { ok: true, userId: session.userId };

  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  if (!session.userId || session.userId !== user.id) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Upload session not found' }, { status: 404 }),
    };
  }

  return { ok: true, userId: user.id };
}
