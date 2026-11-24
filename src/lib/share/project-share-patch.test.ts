/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { shareAccessFailure } from './token-access';
import { buildProjectSharePatch, handleProjectSharePatch } from './project-share-patch';

const NOW = Date.UTC(2030, 0, 1);

describe('buildProjectSharePatch', () => {
  it('sets expiry as now + N days and 0 clears it', async () => {
    const r = await buildProjectSharePatch({ expires_days: 7 }, 'client', NOW);
    expect(r.ok && r.patch.expires_at).toBe(new Date(NOW + 7 * 86400000).toISOString());
    const never = await buildProjectSharePatch({ expires_days: 0 }, 'client', NOW);
    expect(never.ok && never.patch).toEqual({ expires_at: null });
  });

  it('hashes a password with bcrypt and null clears it', async () => {
    const r = await buildProjectSharePatch({ password: 'secret' }, 'client', NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.password_hash).not.toBe('secret');
      expect(await bcrypt.compare('secret', r.patch.password_hash as string)).toBe(true);
    }
    const cleared = await buildProjectSharePatch({ password: null }, 'client', NOW);
    expect(cleared.ok && cleared.patch).toEqual({ password_hash: null });
  });

  it('applies the selling rule: clears on kind change, 400 for sales on a non-client link', async () => {
    const moved = await buildProjectSharePatch({ recipient_kind: 'producer' }, 'client', NOW);
    expect(moved.ok && moved.patch).toEqual({ recipient_kind: 'producer', sales_enabled: false });
    expect(await buildProjectSharePatch({ sales_enabled: true }, 'friend', NOW)).toMatchObject({ ok: false });
  });

  it('a password set here is what the share gate then asks for, and an expiry applies at once', async () => {
    const r = await buildProjectSharePatch({ password: 'secret', expires_days: 1 }, 'client', NOW);
    if (!r.ok) throw new Error('expected ok');
    const stored = { password_hash: r.patch.password_hash as string, expires_at: r.patch.expires_at as string, revoked_at: null };
    expect(await shareAccessFailure(stored, { password: '', now: NOW })).toMatchObject({ status: 401, requiresPassword: true });
    expect(await shareAccessFailure(stored, { password: 'nope', now: NOW })).toMatchObject({ status: 401 });
    expect(await shareAccessFailure(stored, { password: 'secret', now: NOW })).toBeNull();
    expect(await shareAccessFailure(stored, { password: 'secret', now: NOW + 2 * 86400000 })).toMatchObject({ status: 410 });
  });

  it('refuses an empty patch', async () => {
    expect(await buildProjectSharePatch({}, 'client', NOW)).toEqual({ ok: false, error: 'No editable fields in body' });
  });
});

function fakeAdmin(row: Record<string, unknown>) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { recipient_kind: row.recipient_kind } }) }) }),
      update: (fields: Record<string, unknown>) => {
        writes.push(fields);
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...row, ...fields }, error: null }) }) }) };
      },
    }),
  };
}

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/shares/s1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('handleProjectSharePatch', () => {
  const row = { id: 's1', token: 't', recipient_kind: 'client', sales_enabled: true, password_hash: null, expires_at: null };

  it('returns the cleared selling value and password_protected, never the hash', async () => {
    const admin = fakeAdmin(row);
    const res = await handleProjectSharePatch(req({ recipient_kind: 'friend', password: 'pw' }), 's1', async () => ({ ok: true, admin }));
    expect(res.status).toBe(200);
    const { share } = await res.json();
    expect(share).toMatchObject({ recipient_kind: 'friend', sales_enabled: false, password_protected: true });
    expect(share).not.toHaveProperty('password_hash');
    expect(admin.writes[0]).toMatchObject({ sales_enabled: false });
  });

  it('is 400 for sales_enabled=true on a non-client link, and writes nothing', async () => {
    const admin = fakeAdmin({ ...row, recipient_kind: 'friend' });
    const res = await handleProjectSharePatch(req({ sales_enabled: true }), 's1', async () => ({ ok: true, admin }));
    expect(res.status).toBe(400);
    expect(admin.writes).toHaveLength(0);
  });

  it('rejects a bad recipient kind / expiry at the Zod layer', async () => {
    const admin = fakeAdmin(row);
    expect((await handleProjectSharePatch(req({ recipient_kind: 'boss' }), 's1', async () => ({ ok: true, admin }))).status).toBe(400);
    expect((await handleProjectSharePatch(req({ expires_days: -1 }), 's1', async () => ({ ok: true, admin }))).status).toBe(400);
  });

  it('returns the gate refusal untouched', async () => {
    const { NextResponse } = await import('next/server');
    const res = await handleProjectSharePatch(req({ expires_days: 1 }), 's1', async () => ({ ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }));
    expect(res.status).toBe(403);
  });
});
