/**
 * Server-side reads that feed `beatSendEmailInput`: the producer's display
 * name, and — for a re-send that carries only ids (the follow-up nudge) — the
 * pack the link opens. Every read is owner-filtered and best effort: a failed
 * lookup falls back to the generic wording rather than blocking the email.
 */
import type { createServiceClient } from '@/lib/auth/ownership';

type Admin = ReturnType<typeof createServiceClient>;

export interface PackTrack {
  title: string;
  bpm: number | null;
  key: string | null;
  type: string | null;
}

export async function loadProducerName(admin: Admin, ownerId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from('creator_profiles')
      .select('display_name')
      .eq('user_id', ownerId)
      .maybeSingle();
    const name = (data as { display_name?: string | null } | null)?.display_name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** The caller's own tracks among `trackIds`, in the order given. */
export async function loadTrackPack(
  admin: Admin,
  ownerId: string,
  trackIds: unknown,
): Promise<{ tracks: PackTrack[]; coverUrl: string | null }> {
  const ids = Array.isArray(trackIds) ? trackIds.filter((v): v is string => typeof v === 'string') : [];
  if (ids.length === 0) return { tracks: [], coverUrl: null };
  try {
    const { data } = await admin
      .from('tracks')
      .select('id, title, bpm, key, type, cover_url')
      .in('id', ids)
      .eq('user_id', ownerId);
    type Row = { id: string; title: string; bpm: number | null; key: string | null; type: string | null; cover_url: string | null };
    const byId = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]));
    const rows = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r);
    return {
      tracks: rows.map((r) => ({ title: r.title, bpm: r.bpm ?? null, key: r.key ?? null, type: r.type ?? null })),
      coverUrl: rows[0]?.cover_url ?? null,
    };
  } catch {
    return { tracks: [], coverUrl: null };
  }
}

export async function loadProjectPack(
  admin: Admin,
  ownerId: string,
  projectId: string,
): Promise<{ name: string | null; coverUrl: string | null; trackCount: number | null }> {
  try {
    const [{ data: project }, { count }] = await Promise.all([
      admin.from('projects').select('name, cover_url').eq('id', projectId).eq('user_id', ownerId).maybeSingle(),
      admin.from('project_tracks').select('track_id', { count: 'exact', head: true }).eq('project_id', projectId),
    ]);
    const row = project as { name?: string | null; cover_url?: string | null } | null;
    return { name: row?.name ?? null, coverUrl: row?.cover_url ?? null, trackCount: typeof count === 'number' ? count : null };
  } catch {
    return { name: null, coverUrl: null, trackCount: null };
  }
}
