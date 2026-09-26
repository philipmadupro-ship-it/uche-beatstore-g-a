import { describe, expect, it } from 'vitest';
import { isPublicApiPath, requiresProducerForApi } from './api-gate';

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
