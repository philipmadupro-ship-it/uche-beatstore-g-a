import { NextRequest, NextResponse } from 'next/server';
import { uploadAudio } from '@/lib/storage/upload';
import { isSupabaseConfigured, requireRowOwnership } from '@/lib/db';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.tracks.stem-files');
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Flexible, repeatable stem files (migration 080 — track_stem_files).
 *
 *   GET    /api/tracks/[id]/stem-files            → { files: [...] }
 *   POST   /api/tracks/[id]/stem-files (multipart: file, label?, category?)
 *   DELETE /api/tracks/[id]/stem-files?file_id=…
 *
 * Unlike the four fixed columns on the legacy `stems` table, this holds an
 * arbitrary number of labeled stems per track (lead, harmony, 808, fx, …).
 * Owner-gated on the parent track.
 */
const MAX_BYTES = 100 * 1024 * 1024;
// webm/weba added for in-browser MediaRecorder captures (topline recordings).
const ALLOWED_EXT = ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg', 'webm', 'weba'];
// 'topline' = a quick vocal/melody idea recorded in the Lyrics Studio notes;
// kept distinct from deliverable stems so it never leaks to producer shares.
const CATEGORIES = ['vocals', 'drums', 'bass', 'melody', 'fx', 'other', 'topline'];

function detectContentType(ext: string, fallback: string): string {
  switch (ext) {
    case 'mp3':  return 'audio/mpeg';
    case 'wav':  return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'aif':
    case 'aiff': return 'audio/aiff';
    case 'm4a':  return 'audio/mp4';
    case 'ogg':  return 'audio/ogg';
    case 'webm':
    case 'weba': return 'audio/webm';
    default:     return fallback || 'application/octet-stream';
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ files: [] });
  try {
    const owner = await requireRowOwnership('tracks', trackId);
    if (!owner.ok) return owner.res;
    const { data, error } = await owner.admin
      .from('track_stem_files')
      .select('id, label, category, url, position, created_at')
      .eq('track_id', trackId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ files: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackId } = await params;
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const { userId, admin } = auth;

    // Ownership on the parent track.
    const owner = await requireRowOwnership('tracks', trackId);
    if (!owner.ok) return owner.res;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const label = ((formData.get('label') as string | null) || '').trim().slice(0, 60) || 'Stem';
    const rawCat = ((formData.get('category') as string | null) || 'other').toLowerCase();
    const category = CATEGORIES.includes(rawCat) ? rawCat : 'other';

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 100MB' }, { status: 400 });
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: `Unsupported file type ".${ext}".` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const fileName = `stems/${trackId}-${safeLabel}-${Date.now()}.${ext}`;
    const url = await uploadAudio(buffer, fileName, detectContentType(ext, file.type));

    // Append at the end (max existing position + 1).
    const { data: last } = await admin
      .from('track_stem_files')
      .select('position')
      .eq('track_id', trackId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = ((last as any)?.position ?? -1) + 1;

    const { data, error } = await admin
      .from('track_stem_files')
      .insert({ track_id: trackId, user_id: userId, label, category, url, position })
      .select('id, label, category, url, position, created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ file: data });
  } catch (err) {
    log.error('stem-file upload failed', { trackId, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: trackId } = await params;
  try {
    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });
    const owner = await requireRowOwnership('tracks', trackId);
    if (!owner.ok) return owner.res;
    const fileId = new URL(req.url).searchParams.get('file_id');
    if (!fileId) return NextResponse.json({ error: 'file_id required' }, { status: 400 });
    const { error } = await owner.admin
      .from('track_stem_files')
      .delete()
      .eq('id', fileId)
      .eq('track_id', trackId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
