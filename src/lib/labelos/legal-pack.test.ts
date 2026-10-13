import { describe, expect, it } from 'vitest';
import {
  LEGAL_PACK_COLUMNS,
  documentPath,
  legalPackCsv,
  legalPackFileName,
  legalPackRows,
  packReadme,
  safeSegment,
  sheetsInForce,
  type PackParty,
  type PackSong,
} from './legal-pack';

const party = (id: string, over: Partial<PackParty> = {}): PackParty => ({
  id,
  displayName: `Display ${id}`,
  legalName: `Legal ${id}`,
  pro: 'ASCAP',
  proAffiliation: 'affiliated',
  ipi: '00123456789',
  publisherName: 'Pub Co',
  ...over,
});
const parties = (...p: PackParty[]) => new Map(p.map((x) => [x.id, x]));

const song = (over: Partial<PackSong> = {}): PackSong => ({ id: 's1', title: 'Midnight', sheets: [], credits: [], ...over });

describe('the CSV columns are 09 §3.3, exactly', () => {
  it('names song, role, legal name, PRO, IPI, publisher, share, signed at — in that order', () => {
    expect([...LEGAL_PACK_COLUMNS]).toEqual(['Song', 'Role', 'Legal name', 'PRO', 'IPI', 'Publisher', 'Share', 'Signed at']);
    expect(legalPackCsv([]).split('\r\n')[0]).toBe('Song,Role,Legal name,PRO,IPI,Publisher,Share,Signed at');
  });
});

describe('legalPackRows', () => {
  const sheets = [
    {
      id: 'c1',
      kind: 'composition',
      version: 2,
      status: 'signed',
      lines: [
        { partyId: 'b', role: 'writer', share: '40.0000', signedAt: null, position: 1 },
        { partyId: 'a', role: 'writer_composer', share: '60.0000', signedAt: '2026-10-02T10:00:00Z', position: 0 },
      ],
    },
    { id: 'c0', kind: 'composition', version: 1, status: 'superseded', lines: [{ partyId: 'z', role: 'writer', share: '100.0000', signedAt: null, position: 0 }] },
    { id: 'c3', kind: 'composition', version: 3, status: 'draft', lines: [{ partyId: 'y', role: 'writer', share: '100.0000', signedAt: null, position: 0 }] },
    { id: 'm1', kind: 'master', version: 1, status: 'circulated', lines: [{ partyId: 'a', role: 'master_owner', share: '100.0000', signedAt: null, position: 0 }] },
  ];

  it('writes the lines of the sheet in force, in the order written; never a draft or a superseded sheet', () => {
    const rows = legalPackRows([song({ sheets })], parties(party('a'), party('b')));
    expect(rows).toEqual([
      ['Midnight', 'Writer & composer', 'Legal a', 'ASCAP', '00123456789', 'Pub Co', '60%', '2026-10-02T10:00:00Z'],
      ['Midnight', 'Writer', 'Legal b', 'ASCAP', '00123456789', 'Pub Co', '40%', ''],
      ['Midnight', 'Master owner', 'Legal a', 'ASCAP', '00123456789', 'Pub Co', '100%', ''],
    ]);
  });

  it('shows shares exactly: 33.3333 is not rounded', () => {
    const s = [{ id: 'x', kind: 'composition', version: 1, status: 'circulated', lines: [{ partyId: 'a', role: 'writer', share: 33.3333, signedAt: null, position: 0 }] }];
    expect(legalPackRows([song({ sheets: s })], parties(party('a')))[0][6]).toBe('33.3333%');
  });

  it('follows the tracklist order of the songs it is given', () => {
    const rows = legalPackRows([song({ id: 'b', title: 'Second', credits: [{ id: '1', role: 'producer', status: 'confirmed', partyId: 'a', name: 'A' }] }), song({ id: 'a', title: 'First', credits: [{ id: '2', role: 'producer', status: 'confirmed', partyId: 'a', name: 'A' }] })], parties(party('a')));
    expect(rows.map((r) => r[0])).toEqual(['Second', 'First']);
  });

  it('lists credits that are on no split line after the lines, with no share or signature, marking an unconfirmed one', () => {
    const credits = [
      { id: '1', role: 'producer', status: 'confirmed', partyId: 'a', name: 'A' }, // on a line: not repeated
      { id: '2', role: 'producer', status: 'confirmed', partyId: 'c', name: 'C' },
      { id: '3', role: 'mixing_engineer', status: 'proposed', partyId: 'c', name: 'C' },
      { id: '4', role: 'songwriter', status: 'disputed', partyId: null, name: 'No Party' },
    ];
    const rows = legalPackRows([song({ sheets: [sheets[3]], credits })], parties(party('a'), party('c')));
    expect(rows.slice(1)).toEqual([
      ['Midnight', 'Producer', 'Legal c', 'ASCAP', '00123456789', 'Pub Co', '', ''],
      ['Midnight', 'Mixing engineer (proposed)', 'Legal c', 'ASCAP', '00123456789', 'Pub Co', '', ''],
      ['Midnight', 'Songwriter (disputed)', '(missing: No Party)', '', '', '', '', ''],
    ]);
  });

  it('a missing legal name is spelled out, never replaced by the display name; not-affiliated is said', () => {
    const p = party('a', { legalName: '  ', pro: null, proAffiliation: 'not_affiliated', ipi: null, publisherName: null });
    const rows = legalPackRows([song({ sheets: [sheets[3]] })], parties(p));
    expect(rows[0]).toEqual(['Midnight', 'Master owner', '(missing: Display a)', 'Not affiliated', '', '', '100%', '']);
  });

  it('an untitled song is named', () => {
    expect(legalPackRows([song({ title: null, credits: [{ id: '1', role: 'producer', status: 'confirmed', partyId: null, name: 'X' }] })], parties())[0][0]).toBe('Untitled');
  });
});

describe('sheetsInForce', () => {
  it('takes the highest live version of each kind', () => {
    const mk = (id: string, kind: string, version: number, status: string) => ({ id, kind, version, status, lines: [] });
    expect(sheetsInForce([mk('a', 'composition', 1, 'signed'), mk('b', 'composition', 2, 'disputed'), mk('c', 'master', 1, 'draft'), mk('d', 'master', 2, 'superseded')]).map((s) => s.id)).toEqual(['b']);
  });
});

describe('legalPackCsv escaping', () => {
  it('quotes commas, quotes and line breaks (RFC 4180, CRLF)', () => {
    const csv = legalPackCsv([['Say "hi", ok', 'a\nb', 'x', '', '', '', '', '']]);
    expect(csv.split('\r\n')[1]).toBe('"Say ""hi"", ok","a\nb",x,,,,,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('defuses a formula: =, +, -, @, tab and CR get a leading apostrophe', () => {
    for (const bad of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
      const row = legalPackCsv([[bad, '', '', '', '', '', '', '']]).split('\r\n')[1];
      expect(row.replace(/^"/, '')[0], bad).toBe("'");
    }
  });

  it('a legal name that is a formula cannot start one', () => {
    const rows = legalPackRows([song({ credits: [{ id: '1', role: 'producer', status: 'confirmed', partyId: 'a', name: 'A' }] })], parties(party('a', { legalName: '=cmd|"/c calc"!A1' })));
    const line = legalPackCsv(rows).split('\r\n')[1];
    expect(line.split(',')[2].replace(/^"/, '')[0]).toBe("'");
  });
});

describe('document names', () => {
  it('never lets a title climb out of documents/', () => {
    const p = documentPath('../../etc/passwd', 'Composition split v1', '11111111-2222-3333-4444-555555555555', 'x.PDF');
    expect(p).toBe('documents/_.._etc_passwd/Composition split v1-11111111.pdf');
    expect(p.startsWith('documents/')).toBe(true);
    expect(p.split('/')).toHaveLength(3);
    expect(p).not.toMatch(/\/\.\.\//);
  });
  it('safeSegment strips separators, control characters and leading dots, and is never empty', () => {
    expect(safeSegment('a/b\\c:d\u0000', 'x')).toBe('a_b_c_d_');
    expect(safeSegment('...', 'fallback')).toBe('fallback');
    expect(safeSegment('   ', 'fallback')).toBe('fallback');
  });
  it('file name carries the day and the format', () => {
    expect(legalPackFileName('Nova EP', new Date('2026-10-13T12:00:00Z'), 'zip')).toBe('Nova-EP-legal-pack-20261013.zip');
  });
});

describe('packReadme', () => {
  it('says what is in it, what is missing and what was left out', () => {
    const text = packReadme({
      releaseTitle: 'Nova EP',
      generatedAt: new Date('2026-10-13T00:00:00Z'),
      rows: 3,
      documents: [{ assetId: 'a', path: 'documents/Midnight/Composition split v1-aaaaaaaa.pdf', describes: 'signed copy' }],
      missingDocuments: ['Sample clearance — Midnight'],
      songsNotIncluded: 2,
    });
    expect(text).toContain('3 rows');
    expect(text).toContain('documents/Midnight/Composition split v1-aaaaaaaa.pdf');
    expect(text).toContain('Sample clearance — Midnight');
    expect(text).toContain('2 songs on this release are not in this pack');
  });
});
