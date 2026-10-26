import fs from 'node:fs';
import path from 'node:path';
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
    // The encrypted Slack webhook (LABEL-38) never leaves in an export.
    expect(EXPORT_TABLE_NAMES).not.toContain('org_digest_channels');
    expect(EXPORT_TABLE_NAMES).not.toContain('org_digest_members');
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

describe('the export covers every table that carries an org_id', () => {
  // Tables left out ON PURPOSE, each with the reason. A new org-scoped table is either exported or listed here.
  const DELIBERATELY_NOT_EXPORTED: Record<string, string> = {
    notifications: "a person's inbox, not the organization's",
    org_digest_members: 'a member’s own opt-in switch',
    org_digest_channels: 'holds the encrypted Slack webhook secret',
    org_overview_seen: 'a member’s own read marker, not the organization’s data',
    org_entitlements: 'the platform operator’s licence for the organization (modules and caps), not the organization’s own data',
    org_managed_accounts: 'sign-in administration of the accounts the org created (password-change and switch-off state); the memberships themselves are exported with org_members',
  };

  function orgScopedTablesInMigrations(): string[] {
    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    const found = new Set<string>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
        if (/^\s+org_id\s/m.test(m[2])) found.add(m[1]);
      }
      for (const m of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?public\.(\w+)\s+ADD COLUMN IF NOT EXISTS org_id\b/g)) found.add(m[1]);
    }
    return [...found].sort();
  }

  it('lists each org-scoped table as exported, or as deliberately left out with a reason', () => {
    const tables = orgScopedTablesInMigrations();
    // Guard the scan itself: if the regexes stop matching, this must not pass on an empty list.
    expect(tables).toEqual(expect.arrayContaining(['tracks', 'releases', 'split_sheets', 'activity_events']));
    const missing = tables.filter((t) => !EXPORT_TABLE_NAMES.includes(t) && !(t in DELIBERATELY_NOT_EXPORTED));
    expect(missing, 'org tables missing from EXPORT_TABLES (add them, or give a reason above)').toEqual([]);
  });
});
