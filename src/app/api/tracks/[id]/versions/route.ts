import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, query } from '@/lib/local-store';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.tracks.id.versions');

/**
 * GET /api/tracks/[id]/versions — gated on track ownership. Pre-fix any
 * authenticated user could read every version of every track by guessing
 * the track ID, since the route used the cookie client without verifying
 * the caller owns the parent track.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('tracks', id);
      if (!owner.ok) return owner.res;

      const { data, error } = await owner.admin
        .from('track_versions')
        .select('*')
        .eq('track_id', id)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return NextResponse.json({ versions: data ?? [] });
    }

    const versions = query('track_versions', (v: any) => v.track_id === id)
      .sort((a: any, b: any) => (b.version_number ?? 0) - (a.version_number ?? 0));
    return NextResponse.json({ versions });
  } catch (error: any) {
    log.error('GET Versions Error:', { error: errorMessage(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
