import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { readBody, isUUID, isValidEmail, parsePagination, z } from './validate';

/**
 * Tests for readBody — the Zod-validation entry point used by every
 * mutation route.
 *
 * We build a minimal NextRequest stand-in that only implements `.json()`.
 * `readBody` doesn't touch headers / URL / method, so the cast is safe.
 */
function fakeReq(body: unknown, malformed = false): NextRequest {
  return {
    json: async () => {
      if (malformed) throw new SyntaxError('Invalid JSON');
      return body;
    },
  } as unknown as NextRequest;
}

describe('readBody', () => {
  it('returns parsed data on a valid body', async () => {
    const Schema = z.object({ rating: z.number().int().min(0).max(5) });
    const res = await readBody(fakeReq({ rating: 4 }), Schema);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ rating: 4 });
  });

  it('responds 400 with structured issues on validation failure', async () => {
    const Schema = z.object({ rating: z.number().int().min(0).max(5) });
    const res = await readBody(fakeReq({ rating: 99 }), Schema);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.res.status).toBe(400);
      const body = await res.res.json();
      expect(body.error).toMatch(/less than or equal|<=|maximum/i);
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues[0].path).toBe('rating');
    }
  });

  it('responds 400 on malformed JSON', async () => {
    const Schema = z.object({ x: z.string() });
    const res = await readBody(fakeReq({}, true), Schema);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.res.status).toBe(400);
      const body = await res.res.json();
      expect(body.error).toMatch(/JSON/i);
    }
  });

  it('strips extra fields by default (no .strict() set)', async () => {
    const Schema = z.object({ name: z.string() });
    const res = await readBody(fakeReq({ name: 'ok', sneaky: 1 }), Schema);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.name).toBe('ok');
      // Default Zod object strips unknown keys silently — verifying so a
      // future opt-in to .strict() is a deliberate decision, not a surprise.
      expect((res.data as Record<string, unknown>).sneaky).toBeUndefined();
    }
  });

  it('handles nested object validation', async () => {
    const Schema = z.object({
      user: z.object({ id: z.string(), age: z.number().int().nonnegative() }),
    });
    const okRes = await readBody(fakeReq({ user: { id: 'u1', age: 30 } }), Schema);
    expect(okRes.ok).toBe(true);

    const badRes = await readBody(fakeReq({ user: { id: 'u1', age: -1 } }), Schema);
    expect(badRes.ok).toBe(false);
    if (!badRes.ok) {
      const body = await badRes.res.json();
      expect(body.issues[0].path).toBe('user.age');
    }
  });

  it('handles enum validation', async () => {
    const Schema = z.object({ role: z.enum(['viewer', 'commenter', 'editor']) });
    const okRes = await readBody(fakeReq({ role: 'editor' }), Schema);
    expect(okRes.ok).toBe(true);

    const badRes = await readBody(fakeReq({ role: 'admin' }), Schema);
    expect(badRes.ok).toBe(false);
  });
});

describe('isUUID', () => {
  it('accepts canonical UUIDs (any case)', () => {
    expect(isUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUUID('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('rejects malformed or non-string values', () => {
    expect(isUUID('not-a-uuid')).toBe(false);
    expect(isUUID('123e4567e89b12d3a456426614174000')).toBe(false); // no dashes
    expect(isUUID('123e4567-e89b-12d3-a456-42661417400')).toBe(false); // too short
    expect(isUUID('123e4567-e89b-12d3-a456-426614174000,extra')).toBe(false); // .or() footgun
    expect(isUUID(null)).toBe(false);
    expect(isUUID(undefined)).toBe(false);
    expect(isUUID(123)).toBe(false);
    expect(isUUID('')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('first.last+tag@example.com')).toBe(true);
  });

  it('rejects malformed or non-string values', () => {
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('two @at.com')).toBe(false);
    expect(isValidEmail('no@tld')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });
});

describe('parsePagination', () => {
  const parse = (qs: string, opts?: { maxLimit?: number }) =>
    parsePagination(new URLSearchParams(qs), opts);

  it('returns undefined limit + offset 0 when params are absent', () => {
    expect(parse('')).toEqual({ limit: undefined, offset: 0 });
  });

  it('parses and clamps a valid limit to the ceiling', () => {
    expect(parse('limit=10')).toEqual({ limit: 10, offset: 0 });
    expect(parse('limit=99999')).toEqual({ limit: 1000, offset: 0 });
    expect(parse('limit=50', { maxLimit: 25 })).toEqual({ limit: 25, offset: 0 });
  });

  it('ignores non-positive / unparseable limits (keeps default behaviour)', () => {
    expect(parse('limit=0').limit).toBeUndefined();
    expect(parse('limit=-5').limit).toBeUndefined();
    expect(parse('limit=abc').limit).toBeUndefined();
  });

  it('parses offset and floors negatives to 0', () => {
    expect(parse('offset=40').offset).toBe(40);
    expect(parse('offset=-3').offset).toBe(0);
    expect(parse('offset=nope').offset).toBe(0);
  });
});
