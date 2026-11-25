import { describe, expect, it } from 'vitest';
import { publicImageUrl } from './redact';

describe('publicImageUrl', () => {
  it('keeps https and site-relative', () => {
    expect(publicImageUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(publicImageUrl('/api/covers/a.jpg')).toBe('/api/covers/a.jpg');
  });
  it('upgrades http', () => {
    expect(publicImageUrl('http://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
  });
  it.each([
    'r2://bucket/key.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'blob:https://x/1',
    '//evil.example.com/a.jpg', 'file:///etc/passwd', 'https://user:pw@x.com/a.jpg', '', '   ', null, undefined,
    'https://b.r2.cloudflarestorage.com/k?X-Amz-Signature=abc&X-Amz-Expires=60',
    'https://x.com/a.jpg?token=abc', '/a b.jpg', '/\\evil.com',
  ])('refuses %s', (input) => {
    expect(publicImageUrl(input as string | null | undefined)).toBeNull();
  });
});
