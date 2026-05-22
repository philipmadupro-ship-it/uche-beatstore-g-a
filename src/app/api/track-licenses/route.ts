import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.track-licenses');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/track-licenses?track_id=xxx
 *
 * Returns the per-track license rows (enabled/disabled + price override)
 * merged with the full creator license tier list so the UI can render a
 * complete checkbox grid even for tiers that have no row yet.
 *
 * Response:
 *   {
 *     licenses: Array<{
 *       id: string,           // licenses.id
 *       name: string,
 *       price_usd: number,
 *       is_exclusive: boolean,
 *       // per-track state:
 *       enabled: boolean,     // true = explicitly enabled, false = explicitly disabled
 *       linked: boolean,      // true = a track_licenses row exists
 *       price_override_usd: number | null,
 *     }>
 *   }
 *
 * PUT /api/track-licenses?track_id=xxx
 *   body: { license_id: string, enabled: boolean, price_override_usd?: number | null }
 *
 * Upserts a single track_licenses row (or removes it when enabled=true and no
 * price override, which effectively reverts to the global default).
 */

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const trackId = new URL(req.url).searchParams.get('track_id');
  if (!trackId) return NextResponse.json({ error: 'track_id required' }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  try {
    const admin = createServiceClient();

    // Verify ownership of the track
    const { data: track } = await admin
      .from('tracks')
      .select('id, user_id')
      .eq('id', trackId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (!track) return NextResponse.json({ error: 'Track not found or not yours' }, { status: 404 });

    const [{ data: allLicenses }, { data: trackLinks }] = await Promise.all([
      admin
        .from('licenses')
        .select('id, name, price_usd, is_exclusive, sort_order')
        .eq('user_id', auth.userId)
        .order('sort_order', { ascending: true }),
      admin
        .from('track_licenses')
        .select('license_id, enabled, price_override_usd')
        .eq('track_id', trackId),
    ]);

    const linkMap = new Map(
      (trackLinks ?? []).map((l: any) => [l.license_id, l]),
    );

    const licenses = (allLicenses ?? []).map((l: any) => {
      const link = linkMap.get(l.id);
      return {
        id: l.id,
        name: l.name,
        price_usd: Number(l.price_usd),
        is_exclusive: l.is_exclusive,
        linked: !!link,
        enabled: link ? link.enabled : true, // default = enabled (global)
        price_override_usd: link?.price_override_usd ?? null,
      };
    });

    return NextResponse.json({ licenses });
  } catch (err) {
    log.error('GET track-licenses failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const trackId = new URL(req.url).searchParams.get('track_id');
  if (!trackId) return NextResponse.json({ error: 'track_id required' }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const { license_id, enabled, price_override_usd } = body;

    if (!license_id) return NextResponse.json({ error: 'license_id required' }, { status: 400 });
    if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });

    const admin = createServiceClient();

    // Verify track ownership
    const { data: track } = await admin
      .from('tracks')
      .select('id, user_id')
      .eq('id', trackId)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (!track) return NextResponse.json({ error: 'Track not found or not yours' }, { status: 404 });

    // Verify license belongs to this user
    const { data: license } = await admin
      .from('licenses')
      .select('id')
      .eq('id', license_id)
      .eq('user_id', auth.userId)
      .maybeSingle();
    if (!license) return NextResponse.json({ error: 'License not found or not yours' }, { status: 404 });

    // If reverting to global default (enabled=true, no price override), delete the row
    if (enabled && (price_override_usd == null || price_override_usd === '')) {
      await admin
        .from('track_licenses')
        .delete()
        .eq('track_id', trackId)
        .eq('license_id', license_id);
      return NextResponse.json({ ok: true, action: 'deleted' });
    }

    // Otherwise upsert
    const priceOverride =
      price_override_usd !== null && price_override_usd !== '' && price_override_usd !== undefined
        ? Number(price_override_usd)
        : null;

    const { error } = await admin
      .from('track_licenses')
      .upsert(
        {
          track_id: trackId,
          license_id,
          enabled,
          price_override_usd: priceOverride,
        },
        { onConflict: 'track_id,license_id' },
      );
    if (error) throw error;

    return NextResponse.json({ ok: true, action: 'upserted' });
  } catch (err) {
    log.error('PUT track-licenses failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
