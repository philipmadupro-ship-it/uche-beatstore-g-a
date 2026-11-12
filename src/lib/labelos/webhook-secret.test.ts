import { describe, expect, it } from 'vitest';
import { SecretUnavailableError, decryptWebhook, digestSecrets, encryptWebhook, secretAvailable } from './webhook-secret';
import { SLACK_TEST_URL } from '@/lib/labelos/mocks/slack-url';

const URL_ = SLACK_TEST_URL;
const ORG = '10000000-0000-4000-8000-000000000001';
const env = (over: Record<string, string | undefined> = {}) => ({ DIGEST_SECRET: 'secret-one', ...over }) as unknown as NodeJS.ProcessEnv;

describe('webhook secret at rest', () => {
  it('round-trips, and the stored form holds neither the URL nor any part of it', () => {
    const stored = encryptWebhook(URL_, ORG, env());
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('slack');
    expect(stored).not.toContain('abcdefgh');
    expect(decryptWebhook(stored, ORG, env())).toBe(URL_);
  });

  it('uses a fresh salt and iv every time', () => {
    expect(encryptWebhook(URL_, ORG, env())).not.toBe(encryptWebhook(URL_, ORG, env()));
  });

  it('does not open for another org, a tampered value, another key or an unknown version', () => {
    const stored = encryptWebhook(URL_, ORG, env());
    expect(decryptWebhook(stored, '10000000-0000-4000-8000-000000000002', env())).toBeNull();
    const parts = stored.split('.');
    parts[4] = `${parts[4].slice(0, -2)}AA`;
    expect(decryptWebhook(parts.join('.'), ORG, env())).toBeNull();
    expect(decryptWebhook(stored, ORG, env({ DIGEST_SECRET: 'other' }))).toBeNull();
    expect(decryptWebhook(stored.replace(/^v1/, 'v2'), ORG, env())).toBeNull();
    expect(decryptWebhook('garbage', ORG, env())).toBeNull();
    expect(decryptWebhook('', ORG, env())).toBeNull();
  });

  it('rotates: a value written under the old key still opens while it is listed as previous', () => {
    const stored = encryptWebhook(URL_, ORG, env());
    const rotated = env({ DIGEST_SECRET: 'secret-two', DIGEST_SECRET_PREVIOUS: 'secret-one' });
    expect(decryptWebhook(stored, ORG, rotated)).toBe(URL_);
    expect(decryptWebhook(encryptWebhook(URL_, ORG, rotated), ORG, rotated)).toBe(URL_);
    expect(decryptWebhook(stored, ORG, env({ DIGEST_SECRET: 'secret-two' }))).toBeNull();
  });

  it('falls back to the service role key, and with no secret at all refuses to store', () => {
    const fallback = { SUPABASE_SERVICE_ROLE_KEY: 'svc' } as unknown as NodeJS.ProcessEnv;
    expect(digestSecrets(fallback)).toEqual(['svc']);
    expect(secretAvailable(fallback)).toBe(true);
    const none = {} as NodeJS.ProcessEnv;
    expect(secretAvailable(none)).toBe(false);
    expect(() => encryptWebhook(URL_, ORG, none)).toThrow(SecretUnavailableError);
    expect(decryptWebhook(encryptWebhook(URL_, ORG, fallback), ORG, none)).toBeNull();
  });
});
