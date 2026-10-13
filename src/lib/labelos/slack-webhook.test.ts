import { describe, expect, it, vi } from 'vitest';
import { postToSlack, validateSlackWebhookUrl } from './slack-webhook';
import { SLACK_HOST, SLACK_PATH, SLACK_TEST_URL } from '@/lib/labelos/mocks/slack-url';

const GOOD = SLACK_TEST_URL;

describe('validateSlackWebhookUrl', () => {
  it('accepts Slack’s own shape and returns it normalised', () => {
    expect(validateSlackWebhookUrl(`  ${GOOD}  `)).toEqual({ ok: true, url: GOOD });
  });

  it.each([
    ['http scheme', GOOD.replace('https', 'http')],
    ['another host', `https://example.com${SLACK_PATH}`],
    ['a look-alike host', `https://${SLACK_HOST}.evil.test${SLACK_PATH}`],
    ['a subdomain trick', `https://evil.test/@${SLACK_HOST}${SLACK_PATH}`],
    ['credentials', `https://user:pw@${SLACK_HOST}${SLACK_PATH}`],
    ['a port', `https://${SLACK_HOST}:8443${SLACK_PATH}`],
    ['a query', `${GOOD}?x=1`],
    ['a fragment', `${GOOD}#x`],
    ['a wrong path', 'https://hooks.slack.com/anything/else'],
    ['loopback', `https://127.0.0.1${SLACK_PATH}`],
    ['a private IP', `https://10.0.0.5${SLACK_PATH}`],
    ['metadata IP', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', `https://localhost${SLACK_PATH}`],
    ['not a URL', 'nonsense'],
    ['empty', ''],
    ['a number', 42],
  ])('refuses %s', (_, input) => {
    expect(validateSlackWebhookUrl(input).ok).toBe(false);
  });

  it('never echoes the input in the reason', () => {
    const r = validateSlackWebhookUrl('https://evil.test/secret-token-123');
    expect(JSON.stringify(r)).not.toContain('secret-token-123');
  });
});

describe('postToSlack', () => {
  const body = { text: 'hi', blocks: [] };

  it('posts JSON without following redirects', async () => {
    const f = vi.fn(async () => new Response('ok', { status: 200 }));
    expect(await postToSlack(GOOD, body, f as unknown as typeof fetch)).toEqual({ ok: true });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe('manual');
    expect(init.method).toBe('POST');
  });

  it('treats a redirect as a failure and does not follow it', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    expect(await postToSlack(GOOD, body, f as unknown as typeof fetch)).toEqual({ ok: false, reason: 'redirect' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reports a rejection and a network error without throwing', async () => {
    expect(await postToSlack(GOOD, body, (async () => new Response('no', { status: 404 })) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'rejected' });
    expect(await postToSlack(GOOD, body, (async () => { throw new Error('boom'); }) as unknown as typeof fetch)).toEqual({ ok: false, reason: 'network' });
  });

  it('refuses to post to a stored URL that no longer validates', async () => {
    const f = vi.fn();
    expect(await postToSlack('https://evil.test/x', body, f as unknown as typeof fetch)).toEqual({ ok: false, reason: 'rejected' });
    expect(f).not.toHaveBeenCalled();
  });
});
