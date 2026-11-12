/**
 * The legal pack of a release (LABEL-31, 09 §3.3): a CSV with one row per
 * credit / split line, and the documents behind it. Pure — `legal-pack-store`
 * reads the rows, the route streams the result.
 *
 * COLUMNS (09 §3.3, exactly): Song, Role, Legal name, PRO, IPI, Publisher,
 * Share, Signed at. Rows, per song in tracklist order:
 *   1. every line of the split sheet IN FORCE for each kind (composition, then
 *      master) — circulated, signed or disputed; a draft is not in force and a
 *      superseded one is not either — in the order the sheet was written;
 *   2. then every credit whose person is on none of those lines, with no
 *      share and no signature: legal sees who is credited but not yet split.
 * A missing legal name is written as `(missing: <display name>)` so the gap is
 * visible in the one column a reviewer reads, never as a blank that looks like
 * an omission or, worse, as a display name posing as a legal one.
 *
 * Cells go through `csvCell` (lib/labelos/org-export): a value that starts with
 * `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe, so a party called
 * `=HYPERLINK(…)` is data in a spreadsheet, not a formula; quotes, commas and
 * line breaks are RFC 4180 quoted.
 */
import { creditRoleLabel } from './credit-roles';
import { csvCell } from './org-export';
import { formatShare, isLive, isSplitKind, splitRoleLabel, unitsOf, SPLIT_KINDS } from './splits';

export const LEGAL_PACK_COLUMNS = ['Song', 'Role', 'Legal name', 'PRO', 'IPI', 'Publisher', 'Share', 'Signed at'] as const;

export type PackParty = {
  id: string;
  displayName: string;
  legalName: string | null;
  pro: string | null;
  proAffiliation: string | null;
  ipi: string | null;
  publisherName: string | null;
};

export type PackLine = { partyId: string; role: string; share: number | string; signedAt: string | null; position: number };
export type PackSheet = { id: string; kind: string; version: number; status: string; lines: PackLine[] };
export type PackCredit = { id: string; role: string; status: string; partyId: string | null; name: string };
export type PackSong = { id: string; title: string | null; sheets: PackSheet[]; credits: PackCredit[] };

const blank = (v: string | null | undefined): boolean => v == null || v.trim() === '';

/** The sheet of each kind that is in force: live, highest version. */
export function sheetsInForce(sheets: readonly PackSheet[]): PackSheet[] {
  const out: PackSheet[] = [];
  for (const kind of SPLIT_KINDS) {
    const live = sheets.filter((s) => isSplitKind(s.kind) && s.kind === kind && isLive(s.status));
    const best = live.sort((a, b) => b.version - a.version || a.id.localeCompare(b.id))[0];
    if (best) out.push(best);
  }
  return out;
}

function identity(party: PackParty | undefined, fallbackName: string) {
  const legal = party && !blank(party.legalName) ? party.legalName!.trim() : `(missing: ${party?.displayName || fallbackName || 'unnamed'})`;
  const pro = party ? (!blank(party.pro) ? party.pro!.trim() : party.proAffiliation === 'not_affiliated' ? 'Not affiliated' : '') : '';
  return { legal, pro, ipi: party?.ipi?.trim() ?? '', publisher: party?.publisherName?.trim() ?? '' };
}

/** The data rows (without the header), one string[] of `LEGAL_PACK_COLUMNS.length` per row. */
export function legalPackRows(songs: readonly PackSong[], parties: ReadonlyMap<string, PackParty>): string[][] {
  const rows: string[][] = [];
  for (const song of songs) {
    const title = song.title?.trim() || 'Untitled';
    const onLines = new Set<string>();
    for (const sheet of sheetsInForce(song.sheets)) {
      for (const line of [...sheet.lines].sort((a, b) => a.position - b.position || a.partyId.localeCompare(b.partyId))) {
        onLines.add(line.partyId);
        const who = identity(parties.get(line.partyId), '');
        rows.push([title, splitRoleLabel(line.role), who.legal, who.pro, who.ipi, who.publisher, `${formatShare(unitsOf(line.share))}%`, line.signedAt ?? '']);
      }
    }
    for (const credit of song.credits) {
      if (credit.partyId && onLines.has(credit.partyId)) continue;
      const who = identity(credit.partyId ? parties.get(credit.partyId) : undefined, credit.name);
      const role = creditRoleLabel(credit.role);
      rows.push([title, credit.status === 'confirmed' ? role : `${role} (${credit.status})`, who.legal, who.pro, who.ipi, who.publisher, '', '']);
    }
  }
  return rows;
}

/** RFC 4180, CRLF, header first. */
export function legalPackCsv(rows: readonly (readonly string[])[]): string {
  const lines = [LEGAL_PACK_COLUMNS.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

// ── Documents ───────────────────────────────────────────────────────────

export type PackDocument = {
  assetId: string;
  /** Path inside the zip, always under `documents/`. */
  path: string;
  /** What it is, for the README. */
  describes: string;
};

/**
 * A path segment: no separators, control characters (C0, DEL, C1), line or
 * paragraph separators or bidi overrides; no leading or trailing dots or
 * spaces (so never `.`, `..` or `. .`); never empty. Titles are typed by org
 * members, so they are hostile until proven otherwise.
 */
export function safeSegment(text: string, fallback: string): string {
  const cleaned = text
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned || fallback;
}

/** Free text from a member as one plain line (README lines, row labels): no line breaks or control characters to forge a line with. */
export function oneLine(text: string | null | undefined, fallback = 'Untitled'): string {
  const t = (text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return t || fallback;
}

/** The last line of defence before a name enters the archive: `documents/<a>/<b>`, every segment plain. */
export function isSafeZipPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(path)) return false;
  const parts = path.split('/');
  return parts.length >= 1 && parts.every((p) => p !== '' && p !== '.' && p !== '..' && !/^[.\s]|[.\s]$/.test(p));
}

const extensionOf = (fileName: string): string => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return m ? `.${m[1].toLowerCase()}` : '';
};

/**
 * A unique zip path for a document: `documents/<song>/<what>-<short id><ext>`.
 * The asset's own id keeps two files with one name apart.
 */
export function documentPath(songTitle: string | null, what: string, assetId: string, fileName: string): string {
  return `documents/${safeSegment(songTitle ?? '', 'Untitled')}/${safeSegment(what, 'document')}-${assetId.slice(0, 8)}${extensionOf(fileName)}`;
}

export function legalPackFileName(releaseTitle: string, at: Date, format: 'csv' | 'zip'): string {
  const day = at.toISOString().slice(0, 10).replace(/-/g, '');
  // ASCII only: the name goes into a Content-Disposition header, which throws on anything else.
  const base = safeSegment(releaseTitle, 'release').replace(/[^\x20-\x7e]/g, '_').replace(/\s+/g, '-');
  return `${base}-legal-pack-${day}.${format}`;
}

export function packReadme(input: {
  releaseTitle: string;
  generatedAt: Date;
  rows: number;
  documents: readonly PackDocument[];
  missingDocuments: readonly string[];
  songsNotIncluded: number;
}): string {
  const lines = [
    `Legal pack: ${oneLine(input.releaseTitle, 'release')}`,
    `Generated ${input.generatedAt.toISOString()}`,
    '',
    `legal-pack.csv has ${input.rows} row${input.rows === 1 ? '' : 's'}: one per split line of the sheet in force, then credits not yet on a split.`,
    `Columns: ${LEGAL_PACK_COLUMNS.join(', ')}.`,
    '',
    `documents/ holds ${input.documents.length} file${input.documents.length === 1 ? '' : 's'}:`,
    ...input.documents.map((d) => `  ${d.path}  — ${d.describes}`),
  ];
  if (input.missingDocuments.length) lines.push('', 'Could not be added (missing in storage, or not yours to read):', ...input.missingDocuments.map((m) => `  ${m}`));
  if (input.songsNotIncluded > 0) {
    lines.push('', `${input.songsNotIncluded} song${input.songsNotIncluded === 1 ? '' : 's'} on this release ${input.songsNotIncluded === 1 ? 'is' : 'are'} not in this pack: you cannot open ${input.songsNotIncluded === 1 ? 'it' : 'them'}.`);
  }
  return `${lines.join('\n')}\n`;
}
