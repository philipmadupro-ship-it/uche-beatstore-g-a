import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { uploadAudio } from '@/lib/storage/upload';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.profile.voice-tag');

/**
 * POST /api/profile/voice-tag — upload the producer's reusable voice tag.
 *
 * multipart/form-data with `file`. Stores it to R2 (or local fallback) and
 * sets creator_profiles.voice_tag_url. The producer then toggles voice_tag_enabled
 * per beat in the store editor; the preview player overlays it client-side.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const { userId, admin } = auth;

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file' }, { status: 400 });
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Tag must be 1 byte–5 MB' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadAudio(buffer, file.name || 'voice-tag.mp3', file.type || 'audio/mpeg');

    if (isSupabaseConfigured()) {
      const { error } = await admin
        .from('creator_profiles')
        .update({ voice_tag_url: url })
        .eq('user_id', userId);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, voice_tag_url: url });
  } catch (err) {
    log.error('voice-tag upload failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
