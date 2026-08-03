import { describe, it, expect, vi } from 'vitest';
import { isMissingColumnError, selectWithOptionalColumns } from './optional-columns';

/**
 * The regression this guards: adding `bands_url` to a select list made the
 * whole tracks query fail on any deployment where migration 105 had not landed
 * yet. A failed select is not a degraded feature — it is an empty library.
 */
describe('isMissingColumnError', () => {
  it('recognises the Postgres undefined_column code', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
  });

  it('recognises the message PostgREST forwards', () => {
    expect(isMissingColumnError({ message: 'column tracks.bands_url does not exist' })).toBe(true);
  });

  it('does not swallow unrelated failures', () => {
    // A permissions or connection error must NOT trigger a silent retry that
    // hides it — only a genuinely absent column should.
    expect(isMissingColumnError({ message: 'permission denied for table tracks' })).toBe(false);
    expect(isMissingColumnError({ code: '08006', message: 'connection failure' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError('nope')).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });
});

describe('selectWithOptionalColumns', () => {
  const base = ['id', 'title'];
  const optional = ['bands_url'];

  it('uses the optional columns when the schema has them', async () => {
    const run = vi.fn().mockResolvedValue({ data: [{ id: '1' }], error: null });
    const out = await selectWithOptionalColumns(base, optional, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('id, title, bands_url');
    expect(out.usedOptional).toBe(true);
    expect(out.error).toBeNull();
  });

  it('retries without them when the column is missing', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'column tracks.bands_url does not exist' } })
      .mockResolvedValueOnce({ data: [{ id: '1' }], error: null });

    const out = await selectWithOptionalColumns(base, optional, run);

    expect(run).toHaveBeenNthCalledWith(1, 'id, title, bands_url');
    expect(run).toHaveBeenNthCalledWith(2, 'id, title');
    expect(out.usedOptional).toBe(false);
    expect(out.data).toEqual([{ id: '1' }]);
    expect(out.error).toBeNull();
  });

  it('does not retry on an unrelated error, and surfaces it', async () => {
    // Retrying here would turn a real failure into a confusing partial success.
    const error = { message: 'permission denied for table tracks' };
    const run = vi.fn().mockResolvedValue({ data: null, error });

    const out = await selectWithOptionalColumns(base, optional, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(out.error).toBe(error);
  });

  it('surfaces a failure from the retry rather than hiding it', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42703' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } });

    const out = await selectWithOptionalColumns(base, optional, run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(out.error).toEqual({ message: 'connection lost' });
  });
});
