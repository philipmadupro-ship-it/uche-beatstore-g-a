import { describe, expect, it } from 'vitest';
import { canSubmitDelete, daysLeftLabel, failureMessage, fileNameFromDisposition, interpretFailure, longDate } from './org-lifecycle-client';

describe('interpretFailure', () => {
  it('a 403 asking for a fresh sign-in is reauth; any other 401/403 is forbidden', () => {
    expect(interpretFailure(403, { error: 'Sign in again to continue', requiresReauth: true })).toEqual({ kind: 'reauth' });
    expect(interpretFailure(403, { error: 'Forbidden' })).toEqual({ kind: 'forbidden' });
    expect(interpretFailure(401, {})).toEqual({ kind: 'forbidden' });
  });

  it('maps the other statuses', () => {
    expect(interpretFailure(429, {})).toEqual({ kind: 'rate' });
    expect(interpretFailure(404, {})).toEqual({ kind: 'gone' });
    expect(interpretFailure(410, {})).toEqual({ kind: 'gone' });
    expect(interpretFailure(409, { error: 'The producer workspace cannot be deleted from here' })).toEqual({ kind: 'conflict', message: 'The producer workspace cannot be deleted from here' });
    expect(interpretFailure(400, { error: 'Type the name' })).toEqual({ kind: 'invalid', message: 'Type the name' });
    expect(interpretFailure(500, { error: 'Could not export' })).toEqual({ kind: 'error', message: 'Could not export' });
  });

  it('survives a body that is not JSON-shaped', () => {
    expect(interpretFailure(500, null)).toEqual({ kind: 'error', message: 'Something went wrong. Try again.' });
    expect(interpretFailure(500, 'oops')).toEqual({ kind: 'error', message: 'Something went wrong. Try again.' });
  });

  it('has words for every kind', () => {
    for (const f of [{ kind: 'reauth' }, { kind: 'forbidden' }, { kind: 'rate' }, { kind: 'gone' }, { kind: 'error', message: 'Something broke' }] as const) {
      expect(failureMessage(f).length).toBeGreaterThan(5);
    }
  });
});

describe('small helpers', () => {
  it('delete needs the name', () => {
    expect(canSubmitDelete('Night Shift', 'Night Shift')).toBe(true);
    expect(canSubmitDelete('night shift', 'Night Shift')).toBe(false);
    expect(canSubmitDelete('', 'Night Shift')).toBe(false);
  });

  it('reads the file name from the disposition', () => {
    expect(fileNameFromDisposition('attachment; filename="night-shift-export-2026-10-13.json"', 'x.json')).toBe('night-shift-export-2026-10-13.json');
    expect(fileNameFromDisposition(null, 'x.json')).toBe('x.json');
    expect(fileNameFromDisposition('attachment; filename="../etc"', 'x.json')).toBe('x.json');
  });

  it('formats dates and days', () => {
    expect(longDate('nonsense')).toBe('');
    expect(longDate(null)).toBe('');
    expect(longDate('2026-11-11T12:00:00Z')).toContain('2026');
    expect(daysLeftLabel(0)).toBe('less than a day');
    expect(daysLeftLabel(1)).toBe('1 day');
    expect(daysLeftLabel(12)).toBe('12 days');
  });
});
