import { describe, expect, it } from 'vitest';
import {
  fromSharePatchResponse,
  normalizeTrackIds,
  resolveSalesRule,
  toSharePatchBody,
  type ShareLinkFacts,
} from './share-link';

const token = { id: 'a', source: 'share_links' as const, token: 'tok' };
const project = { id: 'b', source: 'project_shares' as const, token: 'tok2' };

describe('toSharePatchBody', () => {
  const patch = {
    title: 'New',
    expires_days: 7,
    password: 'pw',
    recipient_kind: 'rapper' as const,
    sales_enabled: false,
    track_ids: ['t1', 't2'],
  };

  it('sends a token share every field under its own name', () => {
    expect(toSharePatchBody(token, patch)).toEqual(patch);
  });

  it('renames title to label for a project share and never sends track_ids', () => {
    const body = toSharePatchBody(project, patch);
    expect(body).toEqual({
      label: 'New',
      expires_days: 7,
      password: 'pw',
      recipient_kind: 'rapper',
      sales_enabled: false,
    });
    expect(body).not.toHaveProperty('track_ids');
  });

  it('keeps an explicit null password (clear) and drops undefined keys', () => {
    expect(toSharePatchBody(project, { password: null })).toEqual({ password: null });
    expect(toSharePatchBody(token, { expires_days: 0 })).toEqual({ expires_days: 0 });
  });
});

describe('fromSharePatchResponse', () => {
  const row: ShareLinkFacts = {
    ...project, title: 'x', content_title: 'Pack', expires_at: null, revoked_at: null, allow_downloads: true, password_protected: false,
  };
  it('maps the new project-share fields back onto the row', () => {
    expect(
      fromSharePatchResponse(row, { label: 'L', allow_downloads: true, password_protected: true, recipient_kind: 'friend', sales_enabled: false, expires_at: '2030-01-01T00:00:00Z' }),
    ).toMatchObject({ title: 'L', password_protected: true, recipient_kind: 'friend', sales_enabled: false, expires_at: '2030-01-01T00:00:00Z' });
  });
  it('passes a token share response through untouched', () => {
    const share = { password_protected: true, tracks: [] };
    expect(fromSharePatchResponse({ ...row, ...token }, share)).toBe(share);
  });
});

describe('resolveSalesRule', () => {
  it('moving away from client clears selling and returns the cleared value', () => {
    expect(resolveSalesRule('client', { recipient_kind: 'friend' })).toEqual({
      ok: true,
      fields: { recipient_kind: 'friend', sales_enabled: false },
    });
  });
  it('refuses selling on a non-client link instead of dropping it', () => {
    expect(resolveSalesRule('friend', { sales_enabled: true })).toMatchObject({ ok: false });
    expect(resolveSalesRule('client', { recipient_kind: 'rapper', sales_enabled: true })).toMatchObject({ ok: false });
  });
  it('allows selling on a client link, or when the same patch makes it one', () => {
    expect(resolveSalesRule('client', { sales_enabled: true })).toEqual({ ok: true, fields: { sales_enabled: true } });
    expect(resolveSalesRule('friend', { recipient_kind: 'client', sales_enabled: true })).toEqual({
      ok: true,
      fields: { recipient_kind: 'client', sales_enabled: true },
    });
  });
  it('treats an unknown current kind as client and leaves other patches alone', () => {
    expect(resolveSalesRule(null, { sales_enabled: true }).ok).toBe(true);
    expect(resolveSalesRule('friend', {})).toEqual({ ok: true, fields: {} });
    expect(resolveSalesRule('friend', { sales_enabled: false })).toEqual({ ok: true, fields: { sales_enabled: false } });
  });
});

describe('normalizeTrackIds', () => {
  it('drops repeats and keeps the first position', () => {
    expect(normalizeTrackIds(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
    expect(normalizeTrackIds([])).toEqual([]);
  });
});
