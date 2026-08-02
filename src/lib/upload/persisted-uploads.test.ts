import { describe, it, expect } from 'vitest';
import {
  parsePersistedUploads,
  normalisePersistedItem,
  bytesFromCompletedParts,
} from './persisted-uploads';

/**
 * The bug these pin: `hydrate()` read `p.completedPartNumbers.length` off a
 * raw `JSON.parse` of localStorage. One entry missing that field threw, and
 * because `UploadsTray` mounts in `DashboardGroupLayout`, the throw took down
 * every dashboard route — permanently, since the bad entry stayed on disk.
 */

const valid = {
  id: 'abc',
  sessionId: 's1',
  fileName: 'beat.wav',
  fileSize: 1000,
  fileLastModified: 1,
  contentType: 'audio/wav',
  partSize: 500,
  totalParts: 2,
  completedPartNumbers: [1],
  type: 'instrumental',
  projectId: null,
  replaceTrackId: null,
  status: 'uploading',
  startedAt: 123,
};

describe('parsePersistedUploads', () => {
  it('round-trips a well-formed entry', () => {
    const out = parsePersistedUploads(JSON.stringify([valid]));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('abc');
    expect(out[0].completedPartNumbers).toEqual([1]);
  });

  it('survives an entry missing completedPartNumbers', () => {
    // The exact shape that crashed the dashboard.
    const { completedPartNumbers: _omit, ...missing } = valid;
    const out = parsePersistedUploads(JSON.stringify([missing]));
    expect(out).toHaveLength(1);
    expect(out[0].completedPartNumbers).toEqual([]);
  });

  it('never throws on any garbage payload', () => {
    for (const raw of [
      null, undefined, '', 'not json', '{}', '[]', 'null', '123', '"a string"',
      '[null]', '[1,2,3]', '[[]]', '[{"id":null}]', '{"not":"an array"}',
    ]) {
      expect(() => parsePersistedUploads(raw)).not.toThrow();
      expect(Array.isArray(parsePersistedUploads(raw))).toBe(true);
    }
  });

  it('drops entries with no id or no fileName, keeping the good ones', () => {
    const out = parsePersistedUploads(JSON.stringify([
      { ...valid, id: '' },
      { ...valid, fileName: '' },
      valid,
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('abc');
  });

  it('drops duplicate ids so a row cannot render twice', () => {
    const out = parsePersistedUploads(JSON.stringify([valid, valid]));
    expect(out).toHaveLength(1);
  });

  it('coerces wrong-typed fields rather than discarding the row', () => {
    const out = parsePersistedUploads(JSON.stringify([{
      ...valid,
      fileSize: 'big',
      partSize: null,
      totalParts: {},
      startedAt: 'yesterday',
      completedPartNumbers: 'nope',
    }]));
    expect(out).toHaveLength(1);
    expect(out[0].fileSize).toBe(0);
    expect(out[0].completedPartNumbers).toEqual([]);
    expect(Number.isFinite(out[0].startedAt)).toBe(true);
  });

  it('never returns partSize 0, which is used as a divisor downstream', () => {
    const out = parsePersistedUploads(JSON.stringify([{ ...valid, partSize: 0 }]));
    expect(out[0].partSize).toBeGreaterThan(0);
  });

  it('filters non-numeric and negative part numbers', () => {
    const out = parsePersistedUploads(JSON.stringify([{
      ...valid, completedPartNumbers: [1, 'two', null, -3, 0, 4],
    }]));
    expect(out[0].completedPartNumbers).toEqual([1, 4]);
  });

  it('falls back to a known status for an unrecognised one', () => {
    const out = parsePersistedUploads(JSON.stringify([{ ...valid, status: 'wat' }]));
    expect(out[0].status).toBe('interrupted');
  });
});

describe('normalisePersistedItem', () => {
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 1, 'str', [], true]) {
      expect(normalisePersistedItem(v)).toBeNull();
    }
  });
});

describe('bytesFromCompletedParts', () => {
  it('multiplies completed parts by part size', () => {
    const item = normalisePersistedItem({ ...valid, completedPartNumbers: [1] })!;
    expect(bytesFromCompletedParts(item)).toBe(500);
  });

  it('never reports more than the file size', () => {
    // A corrupted part list must not drive a progress bar past 100%.
    const item = normalisePersistedItem({
      ...valid, fileSize: 600, completedPartNumbers: [1, 2, 3, 4, 5],
    })!;
    expect(bytesFromCompletedParts(item)).toBe(600);
  });

  it('is zero when nothing has been uploaded', () => {
    const item = normalisePersistedItem({ ...valid, completedPartNumbers: [] })!;
    expect(bytesFromCompletedParts(item)).toBe(0);
  });
});
