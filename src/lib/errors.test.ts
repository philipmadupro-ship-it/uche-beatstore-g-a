import { describe, it, expect } from 'vitest';
import { errorMessage, isError, schemaCacheMessage, missingColumnFrom, missingTableFrom } from './errors';

/**
 * Tests for the error-coercion helpers.
 *
 * Why these matter:
 *   - Every API route's catch block runs `errorMessage(err)` to surface a
 *     stable error string. If this helper returned undefined or threw, the
 *     client would see a vague "Internal error" with no actionable detail.
 *   - The Supabase SDK throws objects shaped `{ message, code, hint }` —
 *     not Error instances. The naive `err.message` access works for those
 *     but breaks on `throw 'string'`, which we've actually hit in lib/audio
 *     when an upstream service rejected with a plain string.
 */
describe('errorMessage', () => {
  it('returns the .message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a thrown string as-is', () => {
    expect(errorMessage('plain string')).toBe('plain string');
  });

  it('extracts .message from Supabase-style objects', () => {
    expect(errorMessage({ message: 'duplicate key', code: '23505' })).toBe('duplicate key');
  });

  it('JSON-stringifies arbitrary objects when no message present', () => {
    const out = errorMessage({ code: 'XYZ', details: 'something' });
    // Object key order is stable in modern JS; this assertion is precise.
    expect(out).toBe('{"code":"XYZ","details":"something"}');
  });

  it('falls back to String() for non-stringifiable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // JSON.stringify throws on circular refs; helper should still return something.
    const out = errorMessage(circular);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('handles null and undefined without returning undefined', () => {
    // Regression: previously `errorMessage(undefined)` returned the *value*
    // undefined because JSON.stringify(undefined) is undefined. The
    // function signature said it returns string — it didn't. Both must
    // now be coerced to readable strings.
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('handles thrown numbers', () => {
    expect(errorMessage(42)).toBe('42');
  });
});

describe('isError', () => {
  it('recognizes Error instances', () => {
    expect(isError(new Error('x'))).toBe(true);
    expect(isError(new TypeError('x'))).toBe(true);
  });

  it('rejects non-Error values', () => {
    expect(isError('string')).toBe(false);
    expect(isError({ message: 'fake' })).toBe(false);
    expect(isError(null)).toBe(false);
    expect(isError(undefined)).toBe(false);
  });
});

describe('schemaCacheMessage', () => {
  it('names the migration for a known column', () => {
    const msg = schemaCacheMessage({
      message: "Could not find the 'default_artwork_playlist_palette' column of 'creator_profiles' in the schema cache",
    });
    expect(msg).toContain('108_brand_logo_and_kind_artwork');
    // Says what to do, not what went wrong internally.
    expect(msg).toMatch(/run it on supabase/i);
    expect(msg).not.toMatch(/schema cache/i);
  });

  it('names the migration for a known table', () => {
    const msg = schemaCacheMessage({
      message: "Could not find the table 'public.tag_colors' in the schema cache",
    });
    expect(msg).toContain('107_tag_colors');
  });

  it('still helps when the column is not in the map', () => {
    const msg = schemaCacheMessage({
      message: "Could not find the 'something_new' column of 'tracks' in the schema cache",
    });
    expect(msg).toContain('something_new');
    expect(msg).toMatch(/pending migrations/i);
  });

  it('handles the Postgres wording as well as the PostgREST one', () => {
    expect(schemaCacheMessage({ message: 'column "logo_url" does not exist' }))
      .toContain('108_brand_logo_and_kind_artwork');
    expect(schemaCacheMessage({ message: 'relation "public.tag_colors" does not exist' }))
      .toContain('107_tag_colors');
  });

  it('returns null for anything that is not a schema problem', () => {
    // The caller must be able to tell these apart — otherwise it would tell
    // someone to run a migration because their session expired.
    for (const err of [
      new Error('Not authenticated'),
      new Error('duplicate key value violates unique constraint'),
      'network error',
      null,
      undefined,
      {},
      42,
    ]) {
      expect(schemaCacheMessage(err)).toBeNull();
    }
  });
});

describe('missingColumnFrom / missingTableFrom', () => {
  it('pulls the identifier out of both wordings', () => {
    expect(missingColumnFrom("Could not find the 'logo_url' column")).toBe('logo_url');
    expect(missingColumnFrom('column "creator_profiles.logo_url" does not exist')).toBe('logo_url');
    expect(missingTableFrom("Could not find the table 'public.tag_colors' in the schema cache")).toBe('tag_colors');
    expect(missingTableFrom('relation "tag_colors" does not exist')).toBe('tag_colors');
  });

  it('is null when there is no identifier to find', () => {
    expect(missingColumnFrom('boom')).toBeNull();
    expect(missingTableFrom('boom')).toBeNull();
  });
});
