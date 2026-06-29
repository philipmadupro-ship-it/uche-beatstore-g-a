import { describe, it, expect } from 'vitest';
import { maskEmail } from './log';

describe('maskEmail', () => {
  it('keeps the first 3 local chars + the domain', () => {
    expect(maskEmail('buyer@example.com')).toBe('buy***@example.com');
  });

  it('does not over-reveal a short local part', () => {
    expect(maskEmail('ab@x.io')).toBe('ab***@x.io');
  });

  it('handles empty / malformed input without throwing', () => {
    expect(maskEmail(null)).toBe('<none>');
    expect(maskEmail(undefined)).toBe('<none>');
    expect(maskEmail('')).toBe('<none>');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@nolocal.com')).toBe('***');
  });

  it('never contains the full original local part', () => {
    const out = maskEmail('verylongbuyername@example.com');
    expect(out).not.toContain('verylongbuyername');
    expect(out.endsWith('@example.com')).toBe(true);
  });
});
