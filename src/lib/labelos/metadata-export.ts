/**
 * Distributor-ready release metadata (LABEL-34, 09 §4). Pure: the route loads
 * the rows and decides what the caller may read; this module turns them into
 * CSV / JSON whose column names follow DDEX ERN 4.3 element names, so a
 * distributor's importer or a person mapping a sheet recognises them. It is
 * an EXPORT, not a DDEX feed (no XML, no delivery: 02 §4).
 *
 *   column                  ERN element
 *   ReleaseTitle            Release/ReferenceTitle/TitleText
 *   ReleaseType             Release/ReleaseType
 *   DisplayArtistName       Release/DisplayArtistName
 *   LabelName               Release/ReleaseLabelReference → PartyName
 *   UPC                     Release/ReleaseId/ICPN  (UPC-A / EAN-13)
 *   PLine / CLine           Release/PLine/PLineText · CLine/CLineText
 *   GenreText               Release/Genre/GenreText
 *   ReleaseDate             Release/ReleaseDate (the date it goes out)
 *   SequenceNumber          ResourceGroup/SequenceNumber (track position)
 *   ISRC                    SoundRecording/SoundRecordingId/ISRC
 *   TrackTitle              SoundRecording/ReferenceTitle/TitleText
 *   SubTitle                SoundRecording/ReferenceTitle/SubTitle (version)
 *   ParentalWarningType     SoundRecording/ParentalWarningType (Explicit | NotExplicit)
 *   Contributors            SoundRecording/IndirectContributor · DisplayArtist
 *                           ("Name (Role)" joined by " | ")
 *
 * ONE ROW PER TRACK, the release columns repeated: the flat sheet most
 * distributor uploaders take. A release with no tracklist still yields one
 * row (the track columns blank) so the release data is not lost.
 *
 * WHAT IS RIGHTS DATA. Credit lines — who is credited, in which role, with
 * which IPI — are rights data (06 §2.2: `rights.read`; a producer / engineer
 * sees only their own line, which a whole-release export cannot honour). They
 * are included ONLY when the caller holds `rights.read`; otherwise the
 * Contributors / ContributorIPI columns are not in the file at all (JSON:
 * `contributors: null` and a warning), never blank cells that look like
 * "nobody was credited". Even then only `confirmed` credits go out — a
 * proposed or disputed credit is not a fact a distributor should receive —
 * and the count left out is a warning. Legal names, emails, ISNI and PRO
 * details are never exported. Release facts and track facts (title, ISRC,
 * UPC, lines, dates, explicit flag) are catalogue data (`catalog.read`).
 *
 * CSV cells are guarded against spreadsheet formula injection: a text value
 * starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading apostrophe, so
 * Excel / Sheets show it as text instead of running it. Every cell is quoted,
 * quotes doubled, lines end CRLF (RFC 4180).
 */

export type ExportRelease = {
  title: string;
  type: string;
  displayArtist: string | null;
  labelName: string | null;
  upc: string | null;
  pLine: string | null;
  cLine: string | null;
  primaryGenre: string | null;
  /** The date it goes out; falls back to the target date in the export. */
  releaseDate: string | null;
  targetDate: string | null;
};

export type ExportContributor = {
  name: string;
  /** The role's display label ("Mixer"). */
  role: string;
  ipi: string | null;
  status: string;
};

export type ExportItem = {
  position: number;
  isrc: string | null;
  title: string;
  versionTitle: string | null;
  explicit: boolean;
  contributors: readonly ExportContributor[];
};

export type ExportInput = {
  release: ExportRelease;
  items: readonly ExportItem[];
  /** The caller holds `rights.read`. */
  includeRights: boolean;
  /** Reasons the loader already knows something is missing (e.g. an unapplied migration); copied into the warnings. */
  notes?: readonly string[];
  generatedAt: Date;
};

export type ExportColumn = (typeof RELEASE_COLUMNS)[number] | (typeof TRACK_COLUMNS)[number] | (typeof RIGHTS_COLUMNS)[number];

const RELEASE_COLUMNS = ['ReleaseTitle', 'ReleaseType', 'DisplayArtistName', 'LabelName', 'UPC', 'PLine', 'CLine', 'GenreText', 'ReleaseDate'] as const;
const TRACK_COLUMNS = ['SequenceNumber', 'ISRC', 'TrackTitle', 'SubTitle', 'ParentalWarningType'] as const;
const RIGHTS_COLUMNS = ['Contributors', 'ContributorIPI'] as const;

export const SCHEMA_ID = 'label-os.release-metadata/1';

export function exportColumns(includeRights: boolean): ExportColumn[] {
  return [...RELEASE_COLUMNS, ...TRACK_COLUMNS, ...(includeRights ? RIGHTS_COLUMNS : [])];
}

const SEP = ' | ';
const parental = (explicit: boolean) => (explicit ? 'Explicit' : 'NotExplicit');

/** Only confirmed credits leave the building; the rest are counted, not sent. */
function exportable(contributors: readonly ExportContributor[]) {
  const confirmed = contributors.filter((c) => c.status === 'confirmed');
  return { confirmed, left: contributors.length - confirmed.length };
}

/** The date a distributor books: the release date, else the target. */
const bookedDate = (r: ExportRelease) => r.releaseDate ?? r.targetDate;

export type MetadataJson = {
  schema: typeof SCHEMA_ID;
  generatedAt: string;
  release: Record<(typeof RELEASE_COLUMNS)[number], string | null>;
  tracks: ({
    SequenceNumber: number;
    ISRC: string | null;
    TrackTitle: string;
    SubTitle: string | null;
    ParentalWarningType: 'Explicit' | 'NotExplicit';
  } & { Contributors?: { Name: string; Role: string; IPI: string | null }[] })[];
  /** Which part is not in the file and why; never silent. */
  withheld: string[];
  warnings: string[];
};

/** What is missing for a distributor, by name. Advisory: the export still goes out. */
export function metadataWarnings(input: Pick<ExportInput, 'release' | 'items'>): string[] {
  const out: string[] = [];
  const r = input.release;
  if (!r.upc) out.push('The release has no UPC.');
  if (!bookedDate(r)) out.push('The release has no release or target date.');
  if (!r.displayArtist) out.push('The release has no display artist.');
  if (!r.labelName) out.push('The release has no label name.');
  if (!r.pLine || !r.cLine) out.push('The release is missing its ℗ or © line.');
  if (!r.primaryGenre) out.push('The release has no genre.');
  if (input.items.length === 0) out.push('The release has no tracks.');
  for (const i of input.items) if (!i.isrc) out.push(`Track ${i.position} has no ISRC.`);
  return out;
}

export function buildMetadataJson(input: ExportInput): MetadataJson {
  const { release, items, includeRights } = input;
  const withheld: string[] = includeRights ? [] : ['contributors'];
  const warnings = metadataWarnings(input);
  if (!includeRights && !input.notes?.length) warnings.push('Contributors are not included: reading credits needs the rights.read capability.');
  warnings.push(...(input.notes ?? []));
  let left = 0;
  const tracks = items.map((i) => {
    const track: MetadataJson['tracks'][number] = {
      SequenceNumber: i.position,
      ISRC: i.isrc,
      TrackTitle: i.title,
      SubTitle: i.versionTitle,
      ParentalWarningType: parental(i.explicit),
    };
    if (includeRights) {
      const { confirmed, left: n } = exportable(i.contributors);
      left += n;
      track.Contributors = confirmed.map((c) => ({ Name: c.name, Role: c.role, IPI: c.ipi }));
    }
    return track;
  });
  if (left > 0) warnings.push(`${left} credit${left === 1 ? ' is' : 's are'} proposed or disputed and not included.`);
  return {
    schema: SCHEMA_ID,
    generatedAt: input.generatedAt.toISOString(),
    release: {
      ReleaseTitle: release.title,
      ReleaseType: release.type,
      DisplayArtistName: release.displayArtist,
      LabelName: release.labelName,
      UPC: release.upc,
      PLine: release.pLine,
      CLine: release.cLine,
      GenreText: release.primaryGenre,
      ReleaseDate: bookedDate(release),
    },
    tracks,
    withheld,
    warnings,
  };
}

/** One CSV cell: text guarded against formula injection, quoted, quotes doubled. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildMetadataCsv(input: ExportInput): string {
  const json = buildMetadataJson(input);
  const cols = exportColumns(input.includeRights);
  const rel = json.release;
  const rows: (string | number | null)[][] = [];
  const trackRow = (t: MetadataJson['tracks'][number] | null) =>
    cols.map((c) => {
      if ((RELEASE_COLUMNS as readonly string[]).includes(c)) return rel[c as (typeof RELEASE_COLUMNS)[number]];
      if (!t) return '';
      if (c === 'Contributors') return (t.Contributors ?? []).map((x) => `${x.Name} (${x.Role})`).join(SEP);
      if (c === 'ContributorIPI') return (t.Contributors ?? []).map((x) => x.IPI ?? '').join(SEP);
      return t[c as (typeof TRACK_COLUMNS)[number]];
    });
  if (json.tracks.length === 0) rows.push(trackRow(null));
  else for (const t of json.tracks) rows.push(trackRow(t));
  const lines = [cols.map((c) => csvCell(c)).join(','), ...rows.map((r) => r.map((v) => csvCell(v)).join(','))];
  return lines.join('\r\n') + '\r\n';
}

/** A safe download name: `<slug>-metadata.<ext>`; never the raw title in a header. */
export function exportFileName(title: string, format: 'csv' | 'json'): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'release'}-metadata.${format}`;
}
