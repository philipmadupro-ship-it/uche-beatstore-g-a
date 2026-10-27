/**
 * What an owner's export of an organization holds (LABEL-39), and how it is
 * written. Pure: `org-lifecycle-store.ts` reads the tables, this module says
 * WHICH tables, WHICH columns, and turns rows into JSON, CSV and the manifest.
 *
 * The export is "every row the org owns", found two ways: rows that carry the
 * org (`org_id`), and child rows reached through a parent we already hold
 * (a project's tracks, a song's links, a song's tags). A child table is listed
 * with the parent it hangs from, so a row of the producer's or of another org
 * cannot slip in through a shared id: the parent set is the org's own.
 *
 * Left out on purpose: `notifications` and `user_profiles` (a person's inbox
 * and settings are theirs, not the org's) and secrets (`token_hash` of an
 * invitation, which would let a reader accept it).
 */

export type ExportSource =
  | { by: 'org' }
  /** A row the org is one side of: any of these columns holds the org id (an artist ↔ label connection). */
  | { by: 'either'; columns: readonly [string, string] }
  | { by: 'parent'; parent: string; parentKey: string; column: string };

export type ExportTable = {
  name: string;
  /** Where the org's rows come from. */
  source: ExportSource;
  /** Stable paging order; the table's primary key. */
  order: readonly string[];
  /** Columns that never leave the database. */
  omit?: readonly string[];
};

/** Parents come before children: a child is found through its parent's rows. */
export const EXPORT_TABLES: readonly ExportTable[] = [
  { name: 'organizations', source: { by: 'org' }, order: ['id'] },
  { name: 'org_members', source: { by: 'org' }, order: ['user_id'] },
  { name: 'org_invitations', source: { by: 'org' }, order: ['id'], omit: ['token_hash'] },
  { name: 'member_artist_scopes', source: { by: 'org' }, order: ['user_id', 'contact_id'] },
  { name: 'contacts', source: { by: 'org' }, order: ['id'] },
  { name: 'projects', source: { by: 'org' }, order: ['id'] },
  { name: 'tracks', source: { by: 'org' }, order: ['id'] },
  { name: 'project_tracks', source: { by: 'parent', parent: 'projects', parentKey: 'id', column: 'project_id' }, order: ['project_id', 'track_id'] },
  { name: 'project_contacts', source: { by: 'parent', parent: 'projects', parentKey: 'id', column: 'project_id' }, order: ['id'] },
  { name: 'project_assets', source: { by: 'org' }, order: ['id'] },
  { name: 'project_comments', source: { by: 'org' }, order: ['id'] },
  { name: 'project_members', source: { by: 'org' }, order: ['id'] },
  { name: 'track_links', source: { by: 'parent', parent: 'tracks', parentKey: 'id', column: 'from_track_id' }, order: ['from_track_id', 'to_track_id'] },
  { name: 'song_beats', source: { by: 'parent', parent: 'tracks', parentKey: 'id', column: 'song_track_id' }, order: ['song_track_id', 'beat_track_id'] },
  { name: 'track_tags', source: { by: 'parent', parent: 'tracks', parentKey: 'id', column: 'track_id' }, order: ['track_id', 'tag'] },
  { name: 'stems', source: { by: 'parent', parent: 'tracks', parentKey: 'id', column: 'track_id' }, order: ['track_id'] },
  { name: 'song_reviews', source: { by: 'org' }, order: ['track_id', 'reviewer_id'] },
  { name: 'releases', source: { by: 'org' }, order: ['id'] },
  { name: 'release_items', source: { by: 'org' }, order: ['id'] },
  { name: 'tasks', source: { by: 'org' }, order: ['id'] },
  // Rights and legal record (LABEL-27/28/30): credits, the parties they name, split sheets and their lines, approvals.
  { name: 'parties', source: { by: 'org' }, order: ['id'] },
  { name: 'track_collaborators', source: { by: 'org' }, order: ['id'] },
  { name: 'split_sheets', source: { by: 'org' }, order: ['id'] },
  { name: 'split_lines', source: { by: 'org' }, order: ['id'] },
  { name: 'approvals', source: { by: 'org' }, order: ['id'] },
  // Creative direction (LABEL-26) and what an artist org shares with a label (LABEL-41, the artist side's rows)
  { name: 'artist_direction', source: { by: 'org' }, order: ['contact_id'] },
  { name: 'artist_references', source: { by: 'org' }, order: ['id'] },
  // LABEL-41: each side of a connection holds the record of who can see what.
  { name: 'org_connections', source: { by: 'either', columns: ['label_org_id', 'artist_org_id'] }, order: ['id'] },
  { name: 'connection_projects', source: { by: 'org' }, order: ['connection_id', 'project_id'] },
  // LABEL-37: filter definitions only (ids and enums, never results)
  { name: 'org_saved_views', source: { by: 'org' }, order: ['id'] },
  // LABEL-71: every credited artist's answer on listing a release, and the store owner's own vetoes.
  { name: 'listing_consents', source: { by: 'org' }, order: ['id'] },
  { name: 'store_listing_vetoes', source: { by: 'org' }, order: ['release_id'] },
  { name: 'activity_events', source: { by: 'org' }, order: ['created_at', 'id'] },
];

export const EXPORT_TABLE_NAMES: readonly string[] = EXPORT_TABLES.map((t) => t.name);

export type Row = Record<string, unknown>;

/** A row without the columns that must not leave. */
export function redactRow(table: ExportTable, row: Row): Row {
  if (!table.omit?.length) return row;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!table.omit.includes(k)) out[k] = v;
  return out;
}

// ── CSV ─────────────────────────────────────────────────────────────────

/**
 * One cell. Strings that a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@`, tab, CR) get a leading apostrophe — a contact called `=HYPERLINK(…)` is
 * data in an export, not a formula in the owner's Excel. Objects and arrays
 * are written as JSON.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 with CRLF line ends. Columns are the union of the rows' keys, first-seen order. */
export function toCsv(rows: readonly Row[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0) return '';
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// ── Manifest of object keys ─────────────────────────────────────────────

export type ObjectRef = {
  table: string;
  id: string | null;
  column: string;
  /** The reference as stored. */
  ref: string;
  location: 'r2' | 'local';
  bucket: string | null;
  key: string;
};

/** The object a stored reference points at, or null when it is not an R2 / local object reference. */
export function parseObjectRef(value: unknown): { location: 'r2' | 'local'; bucket: string | null; key: string } | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('r2://')) {
    const rest = value.slice(5);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) return null;
    return { location: 'r2', bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }
  if (value.startsWith('local://')) {
    const key = value.slice(8);
    return key ? { location: 'local', bucket: null, key } : null;
  }
  if (value.startsWith('local:')) {
    const key = value.slice(6);
    return key ? { location: 'local', bucket: null, key } : null;
  }
  return null;
}

/** Every R2 / local object reference in a table's rows, one entry per column it appears in. */
export function objectRefsOf(table: string, rows: readonly Row[]): ObjectRef[] {
  const out: ObjectRef[] = [];
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : null;
    for (const [column, value] of Object.entries(row)) {
      const parsed = parseObjectRef(value);
      if (parsed) out.push({ table, id, column, ref: value as string, ...parsed });
    }
  }
  return out;
}

export type StoredObject = { key: string; size: number | null; lastModified: string | null };

export type ExportManifest = {
  format: 1;
  orgId: string;
  generatedAt: string;
  /** Row count per table. */
  tables: Record<string, number>;
  /** Object references found in the rows. */
  references: ObjectRef[];
  /** What the object store actually holds under `orgs/<org_id>/`; null when it could not be listed. */
  stored: StoredObject[] | null;
  /** Why `stored` is null. */
  storedError?: string;
  note: string;
};

export function buildManifest(input: {
  orgId: string;
  generatedAt: Date;
  tables: Record<string, readonly Row[]>;
  stored: StoredObject[] | null;
  storedError?: string;
}): ExportManifest {
  const counts: Record<string, number> = {};
  const references: ObjectRef[] = [];
  for (const [name, rows] of Object.entries(input.tables)) {
    counts[name] = rows.length;
    references.push(...objectRefsOf(name, rows));
  }
  return {
    format: 1,
    orgId: input.orgId,
    generatedAt: input.generatedAt.toISOString(),
    tables: counts,
    references,
    stored: input.stored,
    ...(input.storedError ? { storedError: input.storedError } : {}),
    note:
      'Audio and files are not inside this export. `references` are the objects the rows point at; `stored` is what the object store holds under orgs/<org_id>/. Download them separately before deleting the organization.',
  };
}

/** The file name an export downloads as. */
export function exportFileName(slug: string, format: 'json' | 'csv', at: Date): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'organization';
  return `${safe}-export-${at.toISOString().slice(0, 10)}.${format === 'csv' ? 'zip' : 'json'}`;
}
