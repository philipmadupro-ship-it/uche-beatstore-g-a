import { NextResponse } from 'next/server';
import { requireProducer } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';

/** Stem names the separation backends emit. Anything else is refused. */
export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar'] as const;

/**
 * Job ids are backend-issued and optionally carry a `demucs:` / `moises:`
 * prefix. They are interpolated into an upstream URL path, so the shape is
 * strict: no `/`, `.`, `%` or `?` can reach the stem service.
 */
const JOB_ID_RE = /^(?:(?:demucs|moises):)?[A-Za-z0-9_-]{1,128}$/;

export function isValidJobId(jobId: string): boolean {
  return JOB_ID_RE.test(jobId);
}

export function isValidStemName(name: string): boolean {
  return (STEM_NAMES as readonly string[]).includes(name);
}

/**
 * Authorize a stem-job read. A job exposes the producer's track status and
 * stem audio, so only the producer who owns the track may reach it. Buyers
 * sign in through the same Supabase auth, so "authenticated" is not enough
 * (`requireProducer`). Resolves job_id → stems.track_id → tracks.user_id and
 * requires an exact match — owner-only, no null-owner allowance (mig 097).
 * A job with no persisted row yet (just dispatched) is allowed for the
 * producer. Returns a NextResponse to short-circuit, or null when allowed.
 * Local-store dev mode (no Supabase) is exempt — it's localhost-only.
 */
export async function authorizeStemJob(jobId: string): Promise<NextResponse | null> {
  if (!isSupabaseConfigured()) return null;
  const auth = await requireProducer();
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const candidates = jobId.includes(':') ? [jobId] : [jobId, `demucs:${jobId}`, `moises:${jobId}`];
  const { data: stemRows } = await admin
    .from('stems')
    .select('track_id')
    .in('job_id', candidates)
    .limit(1);
  const trackId = (stemRows as Array<{ track_id?: string | null }> | null)?.[0]?.track_id;
  if (!trackId) return null;

  const { data: track } = await admin
    .from('tracks')
    .select('user_id')
    .eq('id', trackId)
    .maybeSingle();
  const ownerId = (track as { user_id?: string | null } | null)?.user_id;
  if (ownerId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
