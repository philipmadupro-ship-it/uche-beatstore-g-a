import { describe, it, expect } from 'vitest';
import {
  stripeKeyMode,
  webhookSecretStatus,
  resendConfig,
  fromDomain,
  deliveryRecipient,
  emailFailureHint,
  cleanEnv,
} from './payments-config';

describe('cleanEnv', () => {
  it('trims whitespace and newlines pasted into a dashboard', () => {
    expect(cleanEnv(' whsec_abc\n')).toBe('whsec_abc');
    expect(cleanEnv(undefined)).toBe('');
  });
});

describe('stripeKeyMode', () => {
  it('reads live vs test from the key prefix, never returning the key', () => {
    expect(stripeKeyMode('sk_live_abc')).toBe('live');
    expect(stripeKeyMode('rk_live_abc')).toBe('live');
    expect(stripeKeyMode('sk_test_abc')).toBe('test');
    expect(stripeKeyMode('rk_test_abc')).toBe('test');
    expect(stripeKeyMode('pk_live_abc')).toBe('unknown');
    expect(stripeKeyMode('')).toBe('missing');
    expect(stripeKeyMode(undefined)).toBe('missing');
  });
  it('tolerates a pasted trailing newline', () => {
    expect(stripeKeyMode('sk_live_abc\n')).toBe('live');
  });
});

describe('webhookSecretStatus', () => {
  it('flags a missing or malformed signing secret', () => {
    expect(webhookSecretStatus(undefined)).toEqual({ set: false, looks_valid: false, has_whitespace: false });
    expect(webhookSecretStatus('whsec_abc')).toEqual({ set: true, looks_valid: true, has_whitespace: false });
    expect(webhookSecretStatus('sk_live_abc').looks_valid).toBe(false);
  });
  it('reports stray whitespace, which breaks signature verification', () => {
    expect(webhookSecretStatus('whsec_abc\n').has_whitespace).toBe(true);
  });
});

describe('fromDomain', () => {
  it('extracts the domain from a bare or named address', () => {
    expect(fromDomain('sales@u2c.com')).toBe('u2c.com');
    expect(fromDomain('U2C Store <Sales@U2C.com>')).toBe('u2c.com');
    expect(fromDomain('')).toBeNull();
    expect(fromDomain('nonsense')).toBeNull();
  });
});

describe('resendConfig', () => {
  it('flags the Resend sandbox sender, which only delivers to the account owner', () => {
    const c = resendConfig({ RESEND_API_KEY: 're_abc', RESEND_FROM_EMAIL: undefined });
    expect(c.api_key_set).toBe(true);
    expect(c.from_set).toBe(false);
    expect(c.sandbox_sender).toBe(true);
    expect(c.problems.join(' ')).toMatch(/sandbox/i);
  });
  it('flags an explicit onboarding@resend.dev sender too', () => {
    expect(resendConfig({ RESEND_API_KEY: 're_abc', RESEND_FROM_EMAIL: 'onboarding@resend.dev' }).sandbox_sender).toBe(true);
  });
  it('is clean for a real sender', () => {
    const c = resendConfig({ RESEND_API_KEY: 're_abc', RESEND_FROM_EMAIL: 'Store <sales@u2c.com>' });
    expect(c.from_domain).toBe('u2c.com');
    expect(c.problems).toEqual([]);
  });
  it('flags a missing key', () => {
    expect(resendConfig({ RESEND_API_KEY: '', RESEND_FROM_EMAIL: 'a@b.co' }).problems.join(' ')).toMatch(/RESEND_API_KEY/);
  });
});

describe('deliveryRecipient', () => {
  it('prefers metadata, falls back to the Stripe customer email, lowercases', () => {
    expect(deliveryRecipient('Buyer@X.com', 'other@x.com')).toBe('buyer@x.com');
    expect(deliveryRecipient(undefined, 'Other@X.com')).toBe('other@x.com');
  });
  it('never returns the unknown@invalid placeholder', () => {
    expect(deliveryRecipient('unknown@invalid', null)).toBeNull();
    expect(deliveryRecipient('', null)).toBeNull();
  });
});

describe('emailFailureHint', () => {
  it('names the likely cause without echoing the raw error', () => {
    expect(emailFailureHint('The domain is not verified')).toMatch(/verif/i);
    expect(emailFailureHint('You can only send testing emails to your own email address')).toMatch(/sandbox|onboarding/i);
    expect(emailFailureHint('API key is invalid')).toMatch(/RESEND_API_KEY/);
    expect(emailFailureHint('something odd')).toMatch(/Resend dashboard/i);
  });
});
