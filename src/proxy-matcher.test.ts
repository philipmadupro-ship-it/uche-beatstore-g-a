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
});
