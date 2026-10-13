/**
 * The reads and writes behind the split sheet routes (LABEL-28). The rules
 * are `splits.ts` (pure); this file only touches the database. Service-role
 * client, org filter on every query: authorisation is the route's
 * (`requireTrackActor`, `requireObjectAccess`), and rows go out only through
 * `sheetView`.
 *
 * Draft creation and saving are Postgres functions (155) so a sheet and its
 * lines land together or not at all. Circulating and signing are audit
 * functions (`auditRpc`): the change and its event in one transaction.
 *
 * Migration 155 may not be applied: a missing table or function is
 * `SplitsNotReadyError`, which the routes answer as "not set up yet"
 * (GET: `schemaReady: false`; writes: 503), never a raw 500.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isUUID } from '@/lib/validate';
import type { EventSubject } from './activity';
import { creditReach, type CreditActor } from './credits';
import { isMissingCreditsSchema, partiesByIds } from './credits-store';
import { songEventSubject } from './song-stage-store';
import {
  draftIssues,
  parseShare,
  sheetView,
  shareToDb,
  type SplitKind,
  type SplitLineInput,
  type SplitLineRow,
  type SplitPartyFacts,
  type SplitSheetRow,
  type SplitSheetView,
} from './splits';

export const SPLIT_SHEET_COLUMNS =
  'id, track_id, kind, version, status, note, document_asset_id, created_by, created_at, circulated_at, signed_at, superseded_at, superseded_by';
export const SPLIT_LINE_COLUMNS = 'id, split_sheet_id, party_id, role, share, position, signed_at, signature_method, signature_asset_id';

export class SplitsNotReadyError extends Error {
  constructor() {
    super('migration 155 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

/** Tables and columns of 155, or a function PostgREST cannot find. */
export function isMissingSplitsSchema(error: DbError): boolean {
  if (!error) return false;
  return isMissingCreditsSchema(error) || /split_sheets|split_lines|labelos_split_|labelos_audit_split_/.test(error.message) && /could not find|does not exist/i.test(error.message);
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingSplitsSchema(error)) throw new SplitsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

/** Every sheet of a song (all kinds, all versions), newest version first within a kind. */
export async function listSheets(admin: AdminClient, org: string, trackId: string): Promise<SplitSheetRow[]> {
  const res = await admin.from('split_sheets').select(SPLIT_SHEET_COLUMNS).eq('org_id', org).eq('track_id', trackId);
  check('split sheet list', res.error);
  const rows = (res.data ?? []) as unknown as SplitSheetRow[];
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || b.version - a.version);
}

export async function readSheet(admin: AdminClient, org: string, trackId: string, sheetId: string): Promise<SplitSheetRow | null> {
  if (!isUUID(sheetId)) return null;
  const res = await admin.from('split_sheets').select(SPLIT_SHEET_COLUMNS).eq('org_id', org).eq('track_id', trackId).eq('id', sheetId).maybeSingle();
  check('split sheet read', res.error);
  return (res.data as unknown as SplitSheetRow | null) ?? null;
}

/** The lines of some sheets, grouped by sheet, in the order they were written (a stable order for the form). */
export async function linesOfSheets(admin: AdminClient, org: string, sheetIds: readonly string[]): Promise<Map<string, SplitLineRow[]>> {
  const out = new Map<string, SplitLineRow[]>();
  if (sheetIds.length === 0) return out;
  const res = await admin.from('split_lines').select(`${SPLIT_LINE_COLUMNS}, created_at`).eq('org_id', org).in('split_sheet_id', [...sheetIds]);
  check('split line list', res.error);
  const rows = ((res.data ?? []) as unknown as (SplitLineRow & { created_at?: string })[]).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id),
  );
  for (const row of rows) {
    const list = out.get(row.split_sheet_id) ?? [];
    list.push(row);
    out.set(row.split_sheet_id, list);
  }
  return out;
}

/** The JSON the 155 functions take: the share goes as an exact decimal string. */
export function linesPayload(lines: readonly SplitLineInput[]): { party_id: string; role: string; share: string }[] {
  return lines.map((l) => ({ party_id: l.partyId, role: l.role, share: shareToDb(l.units) }));
}

type RpcAdmin = Pick<AdminClient, 'rpc'>;
export type DraftResult = { sheet: SplitSheetRow } | { error: 'not_found' | 'not_draft' | 'draft_exists' };

function draftResult(data: unknown): DraftResult {
  const d = (data ?? {}) as { sheet?: SplitSheetRow; error?: string };
  if (d.sheet) return { sheet: d.sheet };
  if (d.error === 'not_draft' || d.error === 'draft_exists') return { error: d.error };
  return { error: 'not_found' };
}

/** A new draft (version = last + 1), with `lines` or a copy of `copyFrom`'s lines. */
export async function createDraft(
  admin: RpcAdmin,
  a: { org: string; actor: string; trackId: string; kind: SplitKind; note: string | null; lines: readonly SplitLineInput[] | null; copyFrom: string | null },
): Promise<DraftResult> {
  const res = await admin.rpc('labelos_split_create_draft', {
    p_org: a.org,
    p_actor: a.actor,
    p_track: a.trackId,
    p_kind: a.kind,
    p_note: a.note,
    p_lines: a.lines ? linesPayload(a.lines) : null,
    p_copy_from: a.copyFrom,
  });
  check('split draft create', res.error);
  return draftResult(res.data);
}

/** Replace a draft's note and / or all of its lines in one transaction. */
export async function saveDraft(
  admin: RpcAdmin,
  a: { org: string; sheetId: string; note?: string | null; lines?: readonly SplitLineInput[] },
): Promise<DraftResult> {
  const res = await admin.rpc('labelos_split_save_draft', {
    p_org: a.org,
    p_sheet: a.sheetId,
    p_set_note: a.note !== undefined,
    p_note: a.note ?? null,
    p_set_lines: a.lines !== undefined,
    p_lines: a.lines !== undefined ? linesPayload(a.lines) : null,
  });
  check('split draft save', res.error);
  return draftResult(res.data);
}

/** Discard a draft (a circulated sheet is a record and is never deleted). */
export async function deleteDraft(admin: AdminClient, org: string, trackId: string, sheetId: string): Promise<'deleted' | 'not_found' | 'not_draft'> {
  const sheet = await readSheet(admin, org, trackId, sheetId);
  if (!sheet) return 'not_found';
  if (sheet.status !== 'draft') return 'not_draft';
  const res = await admin.from('split_sheets').delete().eq('org_id', org).eq('id', sheetId).eq('status', 'draft').select('id');
  check('split draft delete', res.error);
  return ((res.data ?? []) as unknown[]).length > 0 ? 'deleted' : 'not_draft';
}

/** The song's context keys, for the event's filing; the subject itself is the sheet. */
export async function splitEventSubject(admin: AdminClient, org: string, trackId: string, sheetId: string | null): Promise<EventSubject> {
  const song = await songEventSubject(admin, org, trackId);
  return { ...song, type: 'split_sheet', id: sheetId };
}

/** The subject keys the audit functions take. */
export function auditSubject(s: EventSubject): { artist_id: string | null; project_id: string | null; song_id: string | null } {
  return { artist_id: s.artistId ?? null, project_id: s.projectId ?? null, song_id: s.songId ?? null };
}

/** Remove a signed-PDF row whose signature could not be recorded (the object is deleted by the caller). */
export async function removeAssetRow(admin: AdminClient, org: string, assetId: string): Promise<void> {
  await admin.from('project_assets').delete().eq('org_id', org).eq('id', assetId);
}

export type LinesInput = { party_id: string; role: string; share: string | number }[];
export type ResolvedLines = { ok: true; lines: SplitLineInput[] } | { ok: false; status: 400 | 404; error: string };

/**
 * A request's lines as integer units, checked for a DRAFT: every share parses
 * (four decimals at most, more than 0), roles belong to the kind, no person
 * twice in one role, and every party is a party of THIS org (404 otherwise,
 * so another org's party id reveals nothing).
 */
export async function resolveLines(admin: AdminClient, org: string, kind: SplitKind, input: LinesInput): Promise<ResolvedLines> {
  const lines: SplitLineInput[] = [];
  for (const raw of input) {
    const units = parseShare(typeof raw.share === 'number' ? String(raw.share) : raw.share);
    if (units === null || units <= 0) return { ok: false, status: 400, error: 'A share is more than 0 and at most 100, with up to four decimals' };
    lines.push({ partyId: raw.party_id.toLowerCase(), role: raw.role, units });
  }
  const issues = draftIssues(kind, lines);
  if (issues.length > 0) return { ok: false, status: 400, error: issues[0].message };
  const parties = await partiesByIds(admin, org, lines.map((l) => l.partyId));
  if (lines.some((l) => !parties.has(l.partyId))) return { ok: false, status: 404, error: 'Party not found' };
  return { ok: true, lines };
}

/** The sheets of a song as THIS actor may see them (an own-line reader gets non-draft sheets, their own lines only). */
export async function loadSheetViews(
  admin: AdminClient,
  org: string,
  trackId: string,
  actor: CreditActor,
  only?: string,
): Promise<SplitSheetView[]> {
  const reach = creditReach(actor);
  if (reach === 'none') return [];
  let sheets = await listSheets(admin, org, trackId);
  if (only) sheets = sheets.filter((s) => s.id === only);
  if (reach === 'own') sheets = sheets.filter((s) => s.status !== 'draft');
  const lines = await linesOfSheets(admin, org, sheets.map((s) => s.id));
  const parties = await partiesByIds(admin, org, [...lines.values()].flat().map((l) => l.party_id));
  const facts = new Map<string, SplitPartyFacts>();
  for (const [id, p] of parties) facts.set(id, { id, display_name: p.display_name, legal_name: p.legal_name, ipi: p.ipi, user_id: p.user_id });
  const views = sheets.map((s) => sheetView(s, lines.get(s.id) ?? [], facts, actor));
  // An own-line reader is shown a sheet only if one of its lines is theirs.
  return reach === 'own' ? views.filter((v) => v.lines.length > 0) : views;
}

/** Insert the restricted `split_sheet` project file a signed PDF is kept as (143: always restricted). */
export async function insertSignedPdfRow(
  admin: AdminClient,
  a: { org: string; projectId: string; createdBy: string; url: string; fileName: string; size: number; label: string },
): Promise<string> {
  const { data: last } = await admin
    .from('project_assets')
    .select('position')
    .eq('org_id', a.org)
    .eq('project_id', a.projectId)
    .order('position', { ascending: false })
    .limit(1);
  const position = ((last as Array<{ position: number }> | null)?.[0]?.position ?? -1) + 1;
  const res = await admin
    .from('project_assets')
    .insert({
      user_id: null,
      org_id: a.org,
      created_by: a.createdBy,
      project_id: a.projectId,
      kind: 'split_sheet',
      sensitivity: 'restricted',
      label: a.label.slice(0, 200),
      file_name: a.fileName.split(/[\\/]/).pop()!.slice(0, 300),
      url: a.url,
      mime: 'application/pdf',
      size_bytes: a.size,
      position,
      in_portal: false,
      portal_at: null,
    })
    .select('id')
    .single();
  check('signed document insert', res.error);
  return (res.data as { id: string }).id;
}
