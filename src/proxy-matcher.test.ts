import { describe, expect, it } from 'vitest';
import { config } from './proxy';

/**
 * The proxy's matcher is a negative lookahead. `share` used to be a bare
 * prefix in it, which also exempted `/shared` — LABEL-21's "Shared with me"
 * pages — from the flag check, the session refresh and the membership gate.
 * Next compiles the matcher with path-to-regexp; anchoring it as a plain
 * regular expression answers the same question for these paths.
 */
const runs = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe('proxy matcher', () => {
  it.each(['/shared', '/shared/9f1c', '/o/acme', '/join/abc', '/api/org', '/api/org/shared', '/library', '/store/x', '/projects/share/tok'])(
    'runs on %s',
    (p) => expect(runs(p)).toBe(true),
  );
  it.each(['/share/abc', '/share', '/_next/static/chunk.js', '/_next/image', '/favicon.ico', '/logo.png'])('skips %s', (p) =>
    expect(runs(p)).toBe(false),
  );

  // The static-extension skip must not exempt a Label OS URL. A route whose last segment ends in `.png` / `.js`
  // would otherwise run with no flag check (LABEL_OS_ENABLED off must 404 the namespace), no token refresh and no
  // membership gate. Static files elsewhere keep skipping the proxy.
  it.each([
    '/api/org/11111111-1111-4111-8111-111111111111/tracks/x.png',
    '/api/org/x.js',
    '/o/acme/x.css',
    '/shared/p.map',
    '/join/abc.png',
    '/restore/11111111-1111-4111-8111-111111111111.js',
  ])('still runs on a Label OS URL that ends like a static file: %s', (p) => expect(runs(p)).toBe(true));
  it.each(['/store/hero.jpg', '/fonts/x.png', '/sw.js', '/api/store/x.png', '/other/o/x.css'])(
    'keeps skipping real static assets: %s',
    (p) => expect(runs(p)).toBe(false),
  );
});
