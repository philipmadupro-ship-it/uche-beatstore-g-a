import { describe, it, expect } from 'vitest';
import { buildCsp, cspHeaderName, isCspEnforcedPath } from './csp';

describe('isCspEnforcedPath', () => {
  it.each(['/store', '/store/', '/store/abc', '/store/checkout', '/store/projects/access/tok'])('enforces %s', (p) => {
    expect(isCspEnforcedPath(p)).toBe(true);
    expect(cspHeaderName(p, 'production')).toBe('Content-Security-Policy');
  });

  it.each(['/', '/library', '/login', '/api/store', '/api/store/checkout', '/storefront', '/stores', '/projects/share/x', '/embed/x'])(
    'reports only on %s',
    (p) => {
      expect(isCspEnforcedPath(p)).toBe(false);
      expect(cspHeaderName(p, 'production')).toBe('Content-Security-Policy-Report-Only');
    },
  );

  it('never enforces outside production, so next dev HMR keeps working', () => {
    expect(cspHeaderName('/store', 'development')).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderName('/store/checkout', 'test')).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('buildCsp', () => {
  const csp = buildCsp('abc123');
  const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('allows scripts only from self, the nonce and Stripe, with no unsafe-inline or unsafe-eval', () => {
    const script = directive('script-src');
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain('https://js.stripe.com');
    expect(script).toContain('https://*.js.stripe.com');
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toMatch(/'unsafe-eval'/);
  });

  it('lets Stripe checkout frame load', () => {
    expect(directive('frame-src')).toContain('https://*.stripe.com');
  });

  it('allows blob: workers', () => {
    expect(directive('worker-src')).toBe("worker-src 'self' blob:");
  });

  it('locks framing to self except for embeds', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'self'");
    expect(buildCsp('n', true)).toContain('frame-ancestors *');
  });

  it('blocks plugins and base-tag hijacking', () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
  });
});
