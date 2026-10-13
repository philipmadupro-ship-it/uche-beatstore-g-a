import { describe, expect, it } from 'vitest';
import {
  buildMetadataCsv,
  buildMetadataJson,
  csvCell,
  exportColumns,
  exportFileName,
  metadataWarnings,
  type ExportInput,
} from './metadata-export';

const GENERATED = new Date('2026-10-13T09:00:00.000Z');

/** A fixture release: two tracks, one credit of each status, one with a hostile name. */
function fixture(over: Partial<ExportInput> = {}): ExportInput {
  return {
    release: {
      title: 'Midnight Run',
      type: 'ep',
      displayArtist: 'Nova',
      labelName: 'Night Shift Records',
      upc: '012345678905',
      pLine: '℗ 2026 Night Shift Records',
      cLine: '© 2026 Night Shift Records',
      primaryGenre: 'Alt R&B',
      releaseDate: '2026-11-06',
      targetDate: '2026-11-01',
    },
    items: [
      {
        position: 1,
        isrc: 'USABC2600001',
        title: 'Midnight',
        versionTitle: null,
        explicit: false,
        contributors: [
          { name: 'Nova', role: 'Songwriter', ipi: '00987654321', status: 'confirmed' },
          { name: 'Kilo, Jr.', role: 'Mixer', ipi: null, status: 'confirmed' },
          { name: 'Draft Person', role: 'Producer', ipi: null, status: 'proposed' },
        ],
      },
      {
        position: 2,
        isrc: 'USABC2600002',
        title: 'Second "Wind"',
        versionTitle: 'Radio Edit',
        explicit: true,
        contributors: [{ name: 'Nova', role: 'Main Artist', ipi: null, status: 'confirmed' }],
      },
    ],
    includeRights: true,
    generatedAt: GENERATED,
    ...over,
  };
}

describe('metadata export — ERN-aligned snapshot of a fixture release', () => {
  it('CSV with rights.read', () => {
    expect(buildMetadataCsv(fixture())).toMatchInlineSnapshot(`
      ""ReleaseTitle","ReleaseType","DisplayArtistName","LabelName","UPC","PLine","CLine","GenreText","ReleaseDate","SequenceNumber","ISRC","TrackTitle","SubTitle","ParentalWarningType","Contributors","ContributorIPI"
      "Midnight Run","ep","Nova","Night Shift Records","012345678905","℗ 2026 Night Shift Records","© 2026 Night Shift Records","Alt R&B","2026-11-06","1","USABC2600001","Midnight","","NotExplicit","Nova (Songwriter) | Kilo, Jr. (Mixer)","00987654321 | "
      "Midnight Run","ep","Nova","Night Shift Records","012345678905","℗ 2026 Night Shift Records","© 2026 Night Shift Records","Alt R&B","2026-11-06","2","USABC2600002","Second ""Wind""","Radio Edit","Explicit","Nova (Main Artist)",""
      "
    `);
  });

  it('CSV without rights.read has no contributor columns at all', () => {
    const csv = buildMetadataCsv(fixture({ includeRights: false }));
    expect(csv.split('\r\n')[0]).not.toMatch(/Contributor/);
    expect(csv).not.toMatch(/Kilo|Nova \(/);
    expect(exportColumns(false)).not.toContain('Contributors');
    expect(exportColumns(true)).toContain('Contributors');
  });

  it('JSON with rights.read', () => {
    expect(buildMetadataJson(fixture())).toMatchInlineSnapshot(`
      {
        "generatedAt": "2026-10-13T09:00:00.000Z",
        "release": {
          "CLine": "© 2026 Night Shift Records",
          "DisplayArtistName": "Nova",
          "GenreText": "Alt R&B",
          "LabelName": "Night Shift Records",
          "PLine": "℗ 2026 Night Shift Records",
          "ReleaseDate": "2026-11-06",
          "ReleaseTitle": "Midnight Run",
          "ReleaseType": "ep",
          "UPC": "012345678905",
        },
        "schema": "label-os.release-metadata/1",
        "tracks": [
          {
            "Contributors": [
              {
                "IPI": "00987654321",
                "Name": "Nova",
                "Role": "Songwriter",
              },
              {
                "IPI": null,
                "Name": "Kilo, Jr.",
                "Role": "Mixer",
              },
            ],
            "ISRC": "USABC2600001",
            "ParentalWarningType": "NotExplicit",
            "SequenceNumber": 1,
            "SubTitle": null,
            "TrackTitle": "Midnight",
          },
          {
            "Contributors": [
              {
                "IPI": null,
                "Name": "Nova",
                "Role": "Main Artist",
              },
            ],
            "ISRC": "USABC2600002",
            "ParentalWarningType": "Explicit",
            "SequenceNumber": 2,
            "SubTitle": "Radio Edit",
            "TrackTitle": "Second "Wind"",
          },
        ],
        "warnings": [
          "1 credit is proposed or disputed and not included.",
        ],
        "withheld": [],
      }
    `);
  });

  it('JSON without rights.read says what is withheld and carries no contributors key', () => {
    const json = buildMetadataJson(fixture({ includeRights: false }));
    expect(json.withheld).toEqual(['contributors']);
    expect(json.warnings.join(' ')).toMatch(/rights\.read/);
    for (const t of json.tracks) expect(t).not.toHaveProperty('Contributors');
    expect(JSON.stringify(json)).not.toMatch(/Kilo|00987654321|Draft Person/);
  });

  it('never carries legal names, emails or ISNI (they are not even inputs)', () => {
    const text = buildMetadataCsv(fixture()) + JSON.stringify(buildMetadataJson(fixture()));
    expect(text).not.toMatch(/legal|isni|@/i);
  });

  it('only confirmed credits go out; the rest are counted', () => {
    const json = buildMetadataJson(fixture());
    expect(JSON.stringify(json)).not.toMatch(/Draft Person/);
    expect(json.warnings).toContain('1 credit is proposed or disputed and not included.');
  });

  it('falls back to the target date, and a release with no tracks is still one row', () => {
    const csv = buildMetadataCsv(fixture({ items: [], release: { ...fixture().release, releaseDate: null } }));
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"2026-11-01"');
    expect(rows[1].endsWith(',"","","","","","",""')).toBe(true);
  });

  it('notes from the loader replace the generic rights warning', () => {
    const json = buildMetadataJson(fixture({ includeRights: false, notes: ['Contributors are not included: credits need migration 153 applied.'] }));
    expect(json.warnings.join(' ')).toMatch(/migration 153/);
    expect(json.warnings.join(' ')).not.toMatch(/rights\.read/);
  });
});

describe('CSV formula injection and escaping', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tTAB', '\rCR'])('guards a leading %j', (v) => {
    expect(csvCell(v)).toBe(`"'${v.replace(/"/g, '""')}"`);
  });

  it('leaves ordinary text, dates and numbers alone, doubles quotes, keeps newlines inside the quotes', () => {
    expect(csvCell('Normal')).toBe('"Normal"');
    expect(csvCell('2026-11-06')).toBe('"2026-11-06"');
    expect(csvCell(3)).toBe('"3"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb,c')).toBe('"a\nb,c"');
  });

  it('a hostile title, artist and contributor cannot start a formula in the sheet', () => {
    const base = fixture();
    const csv = buildMetadataCsv(
      fixture({
        release: { ...base.release, title: '=HYPERLINK("http://x","y")', displayArtist: '@evil' },
        items: [{ ...base.items[0], title: '+cmd|calc', contributors: [{ name: '-1', role: 'Mixer', ipi: null, status: 'confirmed' }] }],
      }),
    );
    for (const cell of csv.split('\r\n')[1].match(/"(?:[^"]|"")*"/g) ?? []) expect(cell).not.toMatch(/^"[=+\-@\t\r]/);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(`"'-1 (Mixer)"`);
  });

  it('uses CRLF row ends', () => {
    expect(buildMetadataCsv(fixture())).toMatch(/\r\n/);
    expect(buildMetadataCsv(fixture()).replace(/\r\n/g, '')).not.toMatch(/\r|\n(?!")/);
  });
});

describe('warnings and file names', () => {
  it('names what a distributor still needs', () => {
    const w = metadataWarnings({
      release: { ...fixture().release, upc: null, pLine: null, releaseDate: null, targetDate: null },
      items: [{ ...fixture().items[0], isrc: null }],
    });
    expect(w).toEqual(['The release has no UPC.', 'The release has no release or target date.', 'The release is missing its ℗ or © line.', 'Track 1 has no ISRC.']);
    expect(metadataWarnings(fixture())).toEqual([]);
  });

  it('builds a safe header file name', () => {
    expect(exportFileName('Midnight Run', 'csv')).toBe('midnight-run-metadata.csv');
    expect(exportFileName('"; rm -rf /\r\nX: y', 'json')).toBe('rm-rf-x-y-metadata.json');
    expect(exportFileName('日本語', 'csv')).toBe('release-metadata.csv');
  });
});
