/**
 * SHARE-09: the email /api/email sends is the email the SendBeatModal preview
 * shows. The preview builds `buildBeatSendEmail(beatSendEmailInput(inputs))`
 * with a placeholder link; the route must produce the same HTML, subject and
 * from for the same inputs, differing only in the URL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeAdmin } from '@/lib/email/fake-admin';
import { beatSendEmailInput, previewShareUrl } from '@/lib/email/beat-send-input';
import { buildBeatSendEmail } from '@/lib/email/beat-send-template';

const mockSend = vi.fn();
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

vi.mock('@/lib/auth/ownership', () => ({
  requireProducer: async () => ({ ok: true, userId: 'producer-1', admin: fakeAdmin(tables) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      insert: () => chain, select: () => chain, eq: () => chain, upsert: async () => ({}),
      maybeSingle: async () => ({ data: { id: 'send-1' } }),
    });
    return { auth: { getUser: async () => ({ data: { user: { id: 'producer-1' } } }) }, from: () => chain };
  },
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/local-store', async (orig) => ({ ...(await orig<object>()), isSupabaseConfigured: () => true }));

const ORIGIN = 'http://localhost:3000';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const EXPIRES = '2027-03-15T12:00:00.000Z';

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/email', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
function sent() {
  return mockSend.mock.calls[0][0] as { html: string; subject: string; from: string; to: string };
}
/** The sent HTML with the real link swapped for the preview's placeholder one. */
function asPreview(html: string, kind: 'tracks' | 'project', token: string) {
  const real = `${ORIGIN}${kind === 'project' ? '/projects/share/' : '/share/'}${token}`;
  return html.split(real).join(previewShareUrl(kind, ORIGIN));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Uche <hi@u2c.test>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  tables.creator_profiles = [{ user_id: 'producer-1', display_name: 'Uche' }];
  tables.share_links = [{ token: 'abcdef123', user_id: 'producer-1', expires_at: EXPIRES, revoked_at: null, allow_downloads: false, full_playback: false }];
  tables.project_shares = [];
  tables.projects = [];
  tables.project_tracks = [];
  tables.tracks = [];
  mockSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
});

describe('POST /api/email matches the preview', () => {
  it('modal track send: same html, subject and from', async () => {
    const tracks = [
      { title: 'Night Shift', bpm: 140, key: 'F minor', type: 'beat' },
      { title: 'Cold Front', bpm: 92, key: 'Bb major', type: 'beat' },
    ];
    const { POST } = await import('./route');
    const res = await POST(post({
      contactId: 'c-1', email: 'ada@example.com', recipientName: 'Ada Lovelace', trackIds: ['t1', 't2'],
      shareToken: 'abcdef123', message: ' Hey <b>there</b>\nsecond line ', subject: 'Custom subject',
      packTitle: '2 tracks', coverUrl: 'https://cdn.test/c.jpg', allowDownloads: false, expiresDays: 30, tracks,
    }));
    expect(res.status).toBe(200);

    const preview = beatSendEmailInput({
      kind: 'tracks', shareUrl: previewShareUrl('tracks', ORIGIN), recipientName: 'Ada Lovelace',
      packTitle: '2 tracks', trackCount: 2, coverUrl: 'https://cdn.test/c.jpg', message: ' Hey <b>there</b>\nsecond line ',
      allowDownloads: false, expiresAt: EXPIRES, fullPlayback: false, tracks, producerName: 'Uche',
      subject: 'Custom subject', fromAddress: 'Uche <hi@u2c.test>',
    });
    expect(asPreview(sent().html, 'tracks', 'abcdef123')).toBe(buildBeatSendEmail(preview.template));
    expect(sent().subject).toBe(preview.subject);
    expect(sent().from).toBe(preview.from);
    expect(sent().html).toContain('75-second previews');
  });

  it('modal track send with no custom subject uses the producer-name default', async () => {
    const { POST } = await import('./route');
    await POST(post({ email: 'ada@example.com', shareToken: 'abcdef123', packTitle: 'Night Shift', tracks: [{ title: 'Night Shift' }], trackIds: ['t1'] }));
    expect(sent().subject).toBe('New music: Night Shift — Uche');
  });

  it('nudge of a track share: pack read back from the owner’s own tracks', async () => {
    tables.tracks = [
      { id: 't1', user_id: 'producer-1', title: 'Night Shift', bpm: 140, key: 'F minor', type: 'beat', cover_url: 'https://cdn.test/n.jpg' },
      { id: 't2', user_id: 'producer-1', title: 'Cold Front', bpm: 92, key: 'Bb major', type: 'beat', cover_url: null },
      { id: 't3', user_id: 'someone-else', title: 'NOT MINE', bpm: 100, key: 'C', type: 'beat', cover_url: null },
    ];
    const { POST } = await import('./route');
    await POST(post({ contactId: 'c-1', email: 'ada@example.com', trackIds: ['t1', 't2', 't3'], shareToken: 'abcdef123', message: 'Following up' }));

    const tracks = [
      { title: 'Night Shift', bpm: 140, key: 'F minor', type: 'beat' },
      { title: 'Cold Front', bpm: 92, key: 'Bb major', type: 'beat' },
    ];
    const preview = beatSendEmailInput({
      kind: 'tracks', shareUrl: previewShareUrl('tracks', ORIGIN), recipientName: 'ada',
      packTitle: '2 tracks', trackCount: 2, coverUrl: 'https://cdn.test/n.jpg', message: 'Following up',
      allowDownloads: false, expiresAt: EXPIRES, fullPlayback: false, tracks, producerName: 'Uche', fromAddress: 'Uche <hi@u2c.test>',
    });
    expect(asPreview(sent().html, 'tracks', 'abcdef123')).toBe(buildBeatSendEmail(preview.template));
    expect(sent().html).not.toContain('NOT MINE');
    expect(sent().html).not.toContain('New music</h1>');
  });

  it('nudge of a project share: project name, cover, count, role note', async () => {
    tables.share_links = [];
    tables.project_shares = [{ token: 'abcdef123', project_id: PROJECT, expires_at: null, revoked_at: null, allow_downloads: true, role: 'commenter' }];
    tables.projects = [{ id: PROJECT, user_id: 'producer-1', name: 'Midnight EP', cover_url: 'https://cdn.test/p.jpg' }];
    tables.project_tracks = [{ project_id: PROJECT, track_id: 'a' }, { project_id: PROJECT, track_id: 'b' }, { project_id: PROJECT, track_id: 'c' }];
    const { POST } = await import('./route');
    await POST(post({ contactId: 'c-1', email: 'ada@example.com', trackIds: ['a'], shareToken: 'abcdef123', message: 'Following up' }));

    const preview = beatSendEmailInput({
      kind: 'project', shareUrl: previewShareUrl('project', ORIGIN), recipientName: 'ada',
      packTitle: 'Midnight EP', trackCount: 3, coverUrl: 'https://cdn.test/p.jpg', message: 'Following up',
      allowDownloads: true, expiresAt: null, fullPlayback: true, role: 'commenter', producerName: 'Uche', fromAddress: 'Uche <hi@u2c.test>',
    });
    expect(asPreview(sent().html, 'project', 'abcdef123')).toBe(buildBeatSendEmail(preview.template));
    expect(sent().subject).toBe(preview.subject);
    expect(sent().html).toContain('You can leave feedback on this project.');
  });
});

describe('GET /api/email', () => {
  it('reports the from and producer name a send will use', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(await res.json()).toEqual({ from: 'Uche <hi@u2c.test>', producerName: 'Uche' });
  });
});
