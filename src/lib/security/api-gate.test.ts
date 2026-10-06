import { describe, expect, it } from 'vitest';
import {
  apiGateFor,
  isLabelOsApiPath,
  isLabelOsJoinApiPath,
  isLabelOsJoinPagePath,
  isLabelOsPagePath,
  isPublicApiPath,
  requiresProducerForApi,
} from './api-gate';

describe('isPublicApiPath', () => {
  it.each([
    '/api/store', '/api/store/me', '/api/store/checkout', '/api/store/download-file',
    '/api/share/tok123', '/api/share/tok/preview/t1', '/api/projects/share/tok',
    '/api/stripe/webhook', '/api/resend/webhook', '/api/cron/process-uploads',
    '/api/csp-report', '/api/health', '/api/whoami', '/api/tracks/abc/heatmap',
  ])('allows %s', (p) => expect(isPublicApiPath(p)).toBe(true));

  it.each([
    '/api/email', '/api/invite', '/api/team', '/api/upload/init', '/api/upload/image',
    '/api/tracks', '/api/tracks/abc', '/api/tracks/abc/heatmap/extra', '/api/projects',
    '/api/projects/abc', '/api/audio', '/api/sales', '/api/contacts', '/api/cover/generate',
    '/api/stripe/diagnostics', '/api/privacy/erase', '/api/profile',
    // prefix look-alikes must not slip through
    '/api/storefront-admin', '/api/stripe/webhooks-admin', '/api/healthz',
  ])('gates %s', (p) => expect(isPublicApiPath(p)).toBe(false));
});

describe('requiresProducerForApi', () => {
  it('leaves signed-out requests to the route (cron bearer, 401s)', () => {
    expect(requiresProducerForApi('/api/email', false)).toBe(false);
  });
  it('gates a signed-in caller on a dashboard route', () => {
    expect(requiresProducerForApi('/api/email', true)).toBe(true);
  });
  it('ignores non-api paths', () => {
    expect(requiresProducerForApi('/library', true)).toBe(false);
  });
});

describe('isLabelOsApiPath', () => {
  it.each(['/api/org', '/api/org/', '/api/org/abc', '/api/org/abc/members', '/api/org/join'])(
    'is the namespace: %s',
    (p) => expect(isLabelOsApiPath(p)).toBe(true),
  );
  it.each(['/api/organizations', '/api/orgs', '/api/orgx/1', '/api', '/api/', '/org', '/o/acme', '/api/tracks/org'])(
    'is not: %s',
    (p) => expect(isLabelOsApiPath(p)).toBe(false),
  );
});

describe('isLabelOsPagePath', () => {
  it.each(['/o', '/o/', '/o/acme', '/o/acme/artists/1', '/shared', '/shared/', '/shared/9f1c'])('is the namespace: %s', (p) =>
    expect(isLabelOsPagePath(p)).toBe(true),
  );
  it.each(['/offline', '/orders', '/org', '/oo/x', '/store/orders', '/', '/api/org', '/share/abc', '/shares', '/sharedx', '/projects/shared', '/api/shared'])('is not: %s', (p) =>
    expect(isLabelOsPagePath(p)).toBe(false),
  );
});

describe('the join exception (LABEL-08)', () => {
  it('is exactly /api/org/join', () => {
    expect(isLabelOsJoinApiPath('/api/org/join')).toBe(true);
    for (const p of ['/api/org/join/', '/api/org/join/x', '/api/org/joint', '/api/org/x/join', '/api/org', '/api/join', '/api/org/JOIN']) {
      expect(isLabelOsJoinApiPath(p), p).toBe(false);
    }
  });

  it('the join page is /join/<token>', () => {
    for (const p of ['/join/abc', '/join/abc/']) expect(isLabelOsJoinPagePath(p), p).toBe(true);
    for (const p of ['/join', '/join/', '/joiner/x', '/o/join/x', '/api/org/join', '/store/join/x']) {
      expect(isLabelOsJoinPagePath(p), p).toBe(false);
    }
  });

  it('admits any signed-in caller to /api/org/join only; the route authorises', () => {
    expect(apiGateFor('/api/org/join', true)).toBe('session');
    expect(apiGateFor('/api/org/join', false)).toBe('none');
    for (const p of ['/api/org/join/x', '/api/org/joint', '/api/org/x/join', '/api/org/x/invitations']) {
      expect(apiGateFor(p, true), p).toBe('member');
    }
    expect(requiresProducerForApi('/api/org/join', true)).toBe(false);
  });
});

describe('apiGateFor', () => {
  it('gates Label OS paths on membership, never on producer', () => {
    expect(apiGateFor('/api/org', true)).toBe('member');
    expect(apiGateFor('/api/org/abc/members', true)).toBe('member');
    expect(requiresProducerForApi('/api/org/abc', true)).toBe(false);
  });

  it('leaves signed-out callers to the route everywhere, Label OS included', () => {
    for (const p of ['/api/org', '/api/email', '/api/store']) expect(apiGateFor(p, false)).toBe('none');
  });

  it('keeps every other path exactly as requiresProducerForApi had it', () => {
    for (const p of ['/api/email', '/api/tracks', '/api/organizations', '/api/orgs', '/api/stripe/diagnostics']) {
      expect(apiGateFor(p, true), p).toBe('producer');
    }
    for (const p of ['/api/store/me', '/api/share/t', '/api/portal/t', '/api/tracks/t/heatmap', '/library', '/o/acme']) {
      expect(apiGateFor(p, true), p).toBe('none');
    }
  });
});
