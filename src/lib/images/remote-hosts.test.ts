import { describe, expect, it } from 'vitest';
import {
  allowedImageHostnames,
  cdnImageHostname,
  isOptimizableImageSrc,
  matchesHostPattern,
} from './remote-hosts';

describe('matchesHostPattern', () => {
  it('matches a single label for *', () => {
    expect(matchesHostPattern('pub-abc123.r2.dev', '*.r2.dev')).toBe(true);
    expect(matchesHostPattern('r2.dev', '*.r2.dev')).toBe(false);
    // `*` is one label, so a nested subdomain must not slip through.
    expect(matchesHostPattern('a.b.r2.dev', '*.r2.dev')).toBe(false);
  });

  it('matches many labels for **', () => {
    expect(matchesHostPattern('a.b.example.com', '**.example.com')).toBe(true);
    expect(matchesHostPattern('a.example.com', '**.example.com')).toBe(true);
  });

  it('treats dots literally rather than as regex wildcards', () => {
    // Without escaping, "r2Xdev" would match ".": a lookalike host would be
    // treated as our own bucket.
    expect(matchesHostPattern('pub-abc.r2Xdev', '*.r2.dev')).toBe(false);
  });

  it('matches an exact hostname with no wildcard', () => {
    expect(matchesHostPattern('cdn.uche-beatstore.com', 'cdn.uche-beatstore.com')).toBe(true);
    expect(matchesHostPattern('evil.com', 'cdn.uche-beatstore.com')).toBe(false);
  });
});

describe('cdnImageHostname', () => {
  it('reads the host out of the configured CDN url', () => {
    expect(cdnImageHostname('https://cdn.uche-beatstore.com')).toBe('cdn.uche-beatstore.com');
    expect(cdnImageHostname('https://cdn.uche-beatstore.com/')).toBe('cdn.uche-beatstore.com');
  });

  it('degrades instead of throwing on a malformed value', () => {
    // A bad env var must not take the build down.
    expect(cdnImageHostname('not a url')).toBeNull();
    expect(cdnImageHostname(undefined)).toBeNull();
    expect(cdnImageHostname('')).toBeNull();
  });

  it('is included in the allowlist when set', () => {
    expect(allowedImageHostnames('https://cdn.uche-beatstore.com')).toContain('cdn.uche-beatstore.com');
    expect(allowedImageHostnames(undefined)).not.toContain('cdn.uche-beatstore.com');
  });
});

describe('isOptimizableImageSrc', () => {
  it('allows R2 buckets', () => {
    expect(isOptimizableImageSrc('https://pub-4e91.r2.dev/covers/x.jpg')).toBe(true);
    expect(isOptimizableImageSrc('https://acct.r2.cloudflarestorage.com/x.jpg')).toBe(true);
  });

  it('allows same-origin paths', () => {
    expect(isOptimizableImageSrc('/covers/x.jpg')).toBe(true);
  });

  it('refuses a foreign host, which is what used to crash the page', () => {
    // next/image throws at render for an unconfigured hostname, so this must
    // fall back to a plain <img> rather than be handed to the optimizer.
    expect(isOptimizableImageSrc('https://placehold.co/600x600.png')).toBe(false);
    expect(isOptimizableImageSrc('https://images.example.com/cover.jpg')).toBe(false);
  });

  it('refuses blob:, data: and malformed values', () => {
    expect(isOptimizableImageSrc('blob:http://localhost/abc')).toBe(false);
    expect(isOptimizableImageSrc('data:image/png;base64,AAAA')).toBe(false);
    expect(isOptimizableImageSrc('')).toBe(false);
    expect(isOptimizableImageSrc('https://')).toBe(false);
  });

  it('allows the CDN host only when configured', () => {
    const url = 'https://cdn.uche-beatstore.com/covers/x.jpg';
    expect(isOptimizableImageSrc(url, 'https://cdn.uche-beatstore.com')).toBe(true);
    expect(isOptimizableImageSrc(url, undefined)).toBe(false);
  });
});
