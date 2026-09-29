import { describe, expect, it } from 'vitest';
import { buildBeatSendEmail, shareExpiryText } from './beat-send-template';

describe('shareExpiryText', () => {
  it('null / missing / unparseable → no expiry', () => {
    expect(shareExpiryText(null)).toBe('No expiry');
    expect(shareExpiryText(undefined)).toBe('No expiry');
    expect(shareExpiryText('not a date')).toBe('No expiry');
  });

  it('renders the absolute date in UTC, however far out', () => {
    expect(shareExpiryText('2026-10-05T23:30:00.000Z')).toBe('Link expires Oct 5, 2026');
    expect(shareExpiryText('2029-01-01T00:00:00.000Z')).toBe('Link expires Jan 1, 2029');
  });

  it('is what the email permissions row shows', () => {
    const html = buildBeatSendEmail({
      recipientName: 'Ada', shareUrl: 'https://x/share/abc', packTitle: 'Pack', packMeta: '',
      message: '', allowDownloads: true, expiresAt: null,
    });
    expect(html).toContain('No expiry');
  });
});
