import { describe, expect, it } from 'vitest';
import {
  EXPORT_TABLES,
  EXPORT_TABLE_NAMES,
  buildManifest,
  csvCell,
  exportFileName,
  objectRefsOf,
  parseObjectRef,
  redactRow,
  toCsv,
} from './org-export';

describe('the export table list', () => {
  it('lists every table once, parents before their children', () => {
    expect(new Set(EXPORT_TABLE_NAMES).size).toBe(EXPORT_TABLE_NAMES.length);
    EXPORT_TABLES.forEach((t, i) => {
      if (t.source.by === 'parent') expect(EXPORT_TABLE_NAMES.indexOf(t.source.parent), t.name).toBeLessThan(i);
    });
  });

  it('keeps private inboxes and settings out, and the invitation secret off the invitations', () => {
    expect(EXPORT_TABLE_NAMES).not.toContain('notifications');
    expect(EXPORT_TABLE_NAMES).not.toContain('user_profiles');
    const inv = EXPORT_TABLES.find((t) => t.name === 'org_invitations')!;
    expect(redactRow(inv, { id: 'i', email: 'a@b.c', token_hash: 'secret' })).toEqual({ id: 'i', email: 'a@b.c' });
  });

  it('every table has a paging order', () => {
    for (const t of EXPORT_TABLES) expect(t.order.length, t.name).toBeGreaterThan(0);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines; blanks null; writes JSON for objects', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(7)).toBe('7');
    expect(csvCell(false)).toBe('false');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(['x', 'y'])).toBe('"[""x"",""y""]"');
  });

  it('defuses spreadsheet formulas in text but leaves numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2 hours')).toBe("'-2 hours");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes a header from the union of keys and one line per row', () => {
    const csv = toCsv([{ id: 1, name: 'A' }, { id: 2, extra: 'x' }]);
    expect(csv).toBe('id,name,extra\r\n1,A,\r\n2,,x\r\n');
  });

  it('is empty for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('object references', () => {
  it('reads r2 and local references, nothing else', () => {
    expect(parseObjectRef('r2://priv/orgs/o1/tracks/a.wav')).toEqual({ location: 'r2', bucket: 'priv', key: 'orgs/o1/tracks/a.wav' });
    expect(parseObjectRef('local://orgs/o1/assets/p/a.png')).toEqual({ location: 'local', bucket: null, key: 'orgs/o1/assets/p/a.png' });
    expect(parseObjectRef('local:orgs/o1/tracks/abc')).toEqual({ location: 'local', bucket: null, key: 'orgs/o1/tracks/abc' });
    expect(parseObjectRef('https://cdn.test/a.png')).toBeNull();
    expect(parseObjectRef('r2://priv')).toBeNull();
    expect(parseObjectRef(42)).toBeNull();
  });

  it('finds them in every column of every row', () => {
    const refs = objectRefsOf('tracks', [
      { id: 't1', title: 'A', audio_url: 'r2://priv/orgs/o1/tracks/a.wav', preview_url: 'r2://priv/orgs/o1/previews/a.mp3', cover_url: 'https://x/y.png' },
      { id: 't2', audio_url: null },
    ]);
    expect(refs.map((r) => [r.id, r.column, r.key])).toEqual([
      ['t1', 'audio_url', 'orgs/o1/tracks/a.wav'],
      ['t1', 'preview_url', 'orgs/o1/previews/a.mp3'],
    ]);
  });

  it('the manifest counts rows, lists references and says when the store could not be listed', () => {
    const m = buildManifest({
      orgId: 'o1',
      generatedAt: new Date('2026-10-13T00:00:00Z'),
      tables: { tracks: [{ id: 't1', audio_url: 'r2://priv/orgs/o1/tracks/a.wav' }], tasks: [] },
      stored: null,
      storedError: 'denied',
    });
    expect(m.tables).toEqual({ tracks: 1, tasks: 0 });
    expect(m.references).toHaveLength(1);
    expect(m.stored).toBeNull();
    expect(m.storedError).toBe('denied');
    expect(m.generatedAt).toBe('2026-10-13T00:00:00.000Z');
  });
});

describe('file name', () => {
  it('is slug + date + extension, and a zip for CSV', () => {
    const at = new Date('2026-10-13T08:00:00Z');
    expect(exportFileName('night-shift', 'json', at)).toBe('night-shift-export-2026-10-13.json');
    expect(exportFileName('night-shift', 'csv', at)).toBe('night-shift-export-2026-10-13.zip');
    expect(exportFileName('../evil"', 'json', at)).toBe('evil-export-2026-10-13.json');
  });
});
