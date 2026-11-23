/**
 * SHARE-09: the project invite email is the email the SendBeatModal preview
 * shows — same HTML, subject and from, differing only in the link.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeAdmin } from '@/lib/email/fake-admin';
import { beatSendEmailInput, previewShareUrl } from '@/lib/email/beat-send-input';
import { buildBeatSendEmail } from '@/lib/email/beat-send-template';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const mockEmailSend = vi.fn();

vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  requireRowOwnership: async () => ({ ok: true, userId: 'owner-1', admin: fakeAdmin(tables) }),
}));
vi.mock('resend', () => ({
  Resend: class { emails = { send: (...a: unknown[]) => mockEmailSend(...a) }; },
}));

const PROJECT = '33333333-3333-4333-8333-333333333333';
const SHARE = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'http://localhost:3000';
const EXPIRES = '2027-03-15T12:00:00.000Z';
const params = { params: Promise.resolve({ id: PROJECT, shareId: SHARE }) };

function invite(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT}/shares/${SHARE}/invite`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
function sent() {
  return mockEmailSend.mock.calls[0][0] as { html: string; subject: string; from: string; to: string };
}
function setShare(extra: Row) {
  tables.project_shares = [{
    id: SHARE, project_id: PROJECT, token: 'sharetoken123', role: 'viewer', allow_downloads: true,
    invited_email: null, expires_at: null, revoked_at: null, ...extra,
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Uche <hi@u2c.test>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
  tables.creator_profiles = [{ user_id: 'owner-1', display_name: 'Uche' }];
  tables.projects = [{ id: PROJECT, user_id: 'owner-1', name: 'Midnight EP', cover_url: 'https://cdn.test/p.jpg' }];
  tables.project_tracks = [{ project_id: PROJECT, track_id: 'a' }, { project_id: PROJECT, track_id: 'b' }];
  setShare({});
  mockEmailSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
});

describe('project invite matches the preview', () => {
  const preview = (over: Record<string, unknown> = {}) => beatSendEmailInput({
    kind: 'project', shareUrl: previewShareUrl('project', ORIGIN), recipientName: 'Ada Lovelace',
    packTitle: 'Midnight EP', trackCount: 2, coverUrl: 'https://cdn.test/p.jpg', message: 'Yo',
    allowDownloads: true, expiresAt: null, fullPlayback: true, role: 'viewer',
    producerName: 'Uche', fromAddress: 'Uche <hi@u2c.test>', ...over,
  });
  const asPreview = (html: string) => html.split(`${ORIGIN}/projects/share/sharetoken123`).join(previewShareUrl('project', ORIGIN));

  it('viewer, default subject', async () => {
    const { POST } = await import('./route');
    const res = await POST(invite({ email: 'ada@example.com', recipient_name: 'Ada Lovelace', message: ' Yo ' }), params);
    expect(res.status).toBe(200);
    const p = preview();
    expect(asPreview(sent().html)).toBe(buildBeatSendEmail(p.template));
    expect(sent().subject).toBe(p.subject);
    expect(sent().from).toBe(p.from);
    expect(sent().html).not.toContain('You can');
    expect(sent().html).toContain('2 tracks · Full tracks');
  });

  it('editor with expiry, downloads off, preview playback and a custom subject', async () => {
    setShare({ role: 'editor', allow_downloads: false, expires_at: EXPIRES, full_playback: false });
    const { POST } = await import('./route');
    await POST(invite({ email: 'ada@example.com', recipient_name: 'Ada Lovelace', message: 'Yo', subject: 'Take a look' }), params);
    const p = preview({ role: 'editor', allowDownloads: false, expiresAt: EXPIRES, fullPlayback: false, subject: 'Take a look' });
    expect(asPreview(sent().html)).toBe(buildBeatSendEmail(p.template));
    expect(sent().subject).toBe('Take a look');
    expect(sent().html).toContain('You can comment and edit.');
    expect(sent().html).toContain('Link expires Mar 15, 2027');
  });

  it('commenter note, and the CTA is the template’s readable button', async () => {
    setShare({ role: 'commenter' });
    const { POST } = await import('./route');
    await POST(invite({ email: 'ada@example.com', recipient_name: 'Ada Lovelace', message: 'Yo' }), params);
    expect(sent().html).toContain('You can leave feedback on this project.');
    expect(sent().html).toContain('background:#FFFFFF;color:#090907');
  });
});
