/**
 * GET /api/portal/[token] — the redaction contract.
 *
 * The database here returns HOSTILE rows: every table hands back more than
 * the route asked for — private `r2://` references, CRM notes, the contact's
 * email, prices, owner ids. The route must build its JSON from explicit field
 * lists (lib/artist-portal/view.ts), so none of it may reach the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const OWNER = 'owner-0000';
const updates: Array<{ table: string; patch: unknown }> = [];
const inserts: Array<{ table: string; row: unknown }> = [];

const hostile = {
  contacts: [{ id: 'c1', name: 'Artist #1', email: 'artist@secret.test', notes: 'CRM: owes a verse', crm_status: 'cold', phone: '+33 6 00 00 00 00' }],
  creator_profiles: [{ user_id: OWNER, display_name: 'UCHE', logo_url: 'r2://private/logo.png', hero_image_url: null, contact_email: 'producer@secret.test' }],
  project_contacts: [{ project_id: 'p1', created_at: '2026-09-01T00:00:00Z', last_notified_at: null, allow_downloads: false, can_comment: true, role: 'artist', user_id: OWNER }],
  projects: [
    { id: 'p1', name: 'New EP', cover_url: 'r2://private/cover.png', description: 'Six tracks', status: 'in_progress', price_usd: 99, user_id: OWNER },
  ],
  project_tracks: [
    { project_id: 'p1', track_id: 't1', added_at: '2026-09-02T00:00:00Z', position: 0 },
    { project_id: 'p1', track_id: 't2', added_at: '2026-09-02T00:00:00Z', position: 1 },
  ],
  contact_track_states: [
    { track_id: 't1', decision: 'interested', set_by: 'artist', contact_id: 'c1' },
  ],
  tracks: [
    { id: 't1', title: 'MIDNIGHT', type: 'beat', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 180, cover_url: 'https://cdn.test/c1.png', beat_track_id: null,
      audio_url: 'r2://private/masters/t1.wav', wav_url: 'r2://private/masters/t1.wav', preview_url: 'r2://private/prev/t1.mp3', peaks_url: 'r2://private/peaks/t1.json',
      notes: 'CRM: pitch to label', lease_price_usd: 50, user_id: OWNER },
    { id: 't2', title: 'MIDNIGHT (vocal)', type: 'song', bpm: 140, key: 'F', scale: 'minor', duration_seconds: 190, cover_url: null, beat_track_id: 't1',
      audio_url: 'r2://private/masters/t2.wav', wav_url: null, preview_url: null, peaks_url: null, notes: null, user_id: OWNER },
  ],
  tag_colors: [],
} as Record<string, Array<Record<string, unknown>>>;

function chain(table: string) {
  const rows = () => hostile[table] ?? [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'neq']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  q.single = q.maybeSingle;
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
  q.update = (patch: unknown) => { updates.push({ table, patch }); return q; };
  q.insert = (row: unknown) => { inserts.push({ table, row }); return q; };
  return q;
}

vi.mock('@/lib/auth/ownership', () => ({ createServiceClient: () => ({ from: (t: string) => chain(t) }) }));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: () => Promise.resolve(true), clientIp: () => '127.0.0.1' }));
vi.mock('@/lib/artist-portal/gate', () => ({
  gatePortal: () => Promise.resolve({
    ok: true,
    portal: { id: 'portal-1', token: 'portaltoken1234567890abcd', user_id: OWNER, contact_id: 'c1', last_viewed_at: null, previous_viewed_at: null, view_count: 0 },
  }),
  hashRequestIp: () => 'iphash',
}));

const get = () => new NextRequest('http://localhost/api/portal/portaltoken1234567890abcd');
const params = { params: Promise.resolve({ token: 'portaltoken1234567890abcd' }) };

beforeEach(() => {
  updates.length = 0;
  inserts.length = 0;
});

describe('GET /api/portal/[token]', () => {
  it('never emits a private reference, a CRM field or an owner id', async () => {
    const { GET } = await import('./route');
    const res = await GET(get(), params);
    expect(res.status).toBe(200);
    const json = JSON.stringify(await res.json());
    for (const leak of ['r2://', 'artist@secret.test', 'producer@secret.test', 'CRM:', 'owes a verse', '+33', OWNER, 'lease_price', 'price_usd', '"notes"', 'crm_status']) {
      expect(json, `leaked ${leak}`).not.toContain(leak);
    }
  });

  it('serves audio only through signed share-media URLs', async () => {
    const { GET } = await import('./route');
    const body = await (await GET(get(), params)).json();
    const beat = body.tracks.find((t: { id: string }) => t.id === 't1');
    expect(beat.streamUrl).toMatch(/^\/api\/share\/portaltoken1234567890abcd\/preview\/t1\?expires=\d+&sig=/);
    expect(beat.peaksUrl).toMatch(/^\/api\/share\/portaltoken1234567890abcd\/peaks\/t1\?expires=\d+&sig=/);
  });

  it('shows this artist’s own decision, NEW on a first visit, and the song’s beat', async () => {
    const { GET } = await import('./route');
    const body = await (await GET(get(), params)).json();
    const beat = body.tracks.find((t: { id: string }) => t.id === 't1');
    const song = body.tracks.find((t: { id: string }) => t.id === 't2');
    expect(beat).toMatchObject({ decision: 'interested', decisionSetBy: 'artist', isNew: true, canDownload: false });
    expect(song).toMatchObject({ type: 'song', builtOn: { id: 't1', title: 'MIDNIGHT' } });
    expect(body.projects).toEqual([expect.objectContaining({ id: 'p1', name: 'New EP', cover_url: null, beats: 1, songs: 1, newCount: 2 })]);
    expect(body.producer.logo_url).toBeNull();
  });

  it('stamps the visit and logs it on the contact timeline', async () => {
    const { GET } = await import('./route');
    await GET(get(), params);
    expect(updates.find((u) => u.table === 'artist_portals')?.patch).toMatchObject({ previous_viewed_at: null, view_count: 1 });
    expect(inserts.find((i) => i.table === 'contact_activity')?.row).toMatchObject({ kind: 'portal_opened', contact_id: 'c1', title: 'Opened the portal · 2 new' });
  });
});
