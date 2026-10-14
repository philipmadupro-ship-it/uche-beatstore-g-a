/**
 * The reads and writes behind an organization's export, deletion and
 * retention (LABEL-39). The rules are in ./org-lifecycle and ./org-export; the
 * routes and crons call these with the service-role client after they have
 * authorised the caller (owner + fresh sign-in) or checked CRON_SECRET.
 *
 * Deleting rows is ONE statement on `organizations`: every org-scoped table
 * references it `ON DELETE CASCADE` (migrations 136–151), and what hangs from
 * those rows (a track's tags, a project's comments) cascades from them.
 * `supabase/local/checks/labelos_org_hard_delete.sql` proves on a real
 * database that this leaves no row of the org and none of anyone else's
 * touched. Nothing here lists tables to delete from, so a table added later
 * that cascades is purged without an edit, and one that forgets to cascade
 * fails that check instead of lingering.
 *
 * The purge removes the OBJECTS first and the rows second: if the store
 * refuses, the org row is still there, still due, and tomorrow's run tries
 * again. The other order would leave orphaned audio with nothing pointing at it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUDIT_VERBS } from './activity';
import { EXPORT_TABLES, redactRow, type ExportTable, type Row } from './org-export';
import { purgeCutoff, retentionCutoff } from './org-lifecycle';
import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';

const log = createLogger('lib.labelos.org-lifecycle-store');

type Admin = Pick<SupabaseClient, 'from'>;

const PAGE = 1000;
/** Ids per `in (…)`: keeps the request line well inside URL limits. */
const IN_CHUNK = 100;

// ── Export ──────────────────────────────────────────────────────────────

async function pagedRows(
  admin: Admin,
  table: ExportTable,
  apply: (q: ReturnType<ReturnType<Admin['from']>['select']>) => ReturnType<ReturnType<Admin['from']>['select']>,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = apply(admin.from(table.name).select('*'));
    for (const col of table.order) query = query.order(col, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table.name}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Every exported table's rows for one org, secrets redacted. Throws if any table cannot be read. */
export async function gatherOrgExport(admin: Admin, orgId: string): Promise<Record<string, Row[]>> {
  const rawByTable: Record<string, Row[]> = {};
  const result: Record<string, Row[]> = {};
  for (const table of EXPORT_TABLES) {
    let rows: Row[];
    if (table.source.by === 'org') {
      // `organizations` is keyed by id, everything else by org_id.
      const column = table.name === 'organizations' ? 'id' : 'org_id';
      rows = await pagedRows(admin, table, (q) => q.eq(column, orgId));
    } else {
      const { parent, parentKey, column } = table.source;
      const ids = [...new Set((rawByTable[parent] ?? []).map((r) => r[parentKey]).filter((v): v is string => typeof v === 'string'))];
      rows = [];
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const chunk = ids.slice(i, i + IN_CHUNK);
        rows.push(...(await pagedRows(admin, table, (q) => q.in(column, chunk))));
      }
    }
    rawByTable[table.name] = rows;
    result[table.name] = rows.map((r) => redactRow(table, r));
  }
  return result;
}

// ── Soft delete and restore ─────────────────────────────────────────────

/** Stamp `deleted_at`. Returns the stamp, or null when the org was already deleted (or gone). */
export async function softDeleteOrg(admin: Admin, orgId: string, now: Date = new Date()): Promise<string | null> {
  const stamp = now.toISOString();
  const { data, error } = await admin
    .from('organizations')
    .update({ deleted_at: stamp })
    .eq('id', orgId)
    .is('deleted_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0 ? stamp : null;
}

/**
 * Clear `deleted_at` if it still holds `deletedAt` AND the grace period is not over (compare-and-set).
 * The second condition is the database's own: the purge cron deletes an org's files BEFORE its row, so a
 * restore that lands after the boundary (a request begun just before it) must not succeed on a row whose
 * masters are already gone. True when it was restored.
 */
export async function restoreOrg(admin: Admin, orgId: string, deletedAt: string, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await admin
    .from('organizations')
    .update({ deleted_at: null })
    .eq('id', orgId)
    .eq('deleted_at', deletedAt)
    .gt('deleted_at', purgeCutoff(now).toISOString())
    .select('id');
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

// ── Purge ───────────────────────────────────────────────────────────────

export type DueOrg = { id: string; name: string; deleted_at: string };

/** Orgs whose grace period is over, oldest first. */
export async function dueOrgs(admin: Admin, now: Date = new Date(), limit = 10): Promise<DueOrg[]> {
  const { data, error } = await admin
    .from('organizations')
    .select('id, name, deleted_at')
    .not('deleted_at', 'is', null)
    .lte('deleted_at', purgeCutoff(now).toISOString())
    .order('deleted_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DueOrg[];
}

export type PurgeOutcome =
  | { status: 'purged'; orgId: string; objects: number }
  | { status: 'kept'; orgId: string; reason: string };

/**
 * Permanently delete one due org: its objects, then its row (and with it
 * everything that cascades). `deleteObjects` is injected so the order and the
 * failure behaviour are testable without a bucket.
 *
 * The row delete repeats the "deleted and due" condition, so an org that was
 * restored (or never deleted) between the listing and now is NOT deleted.
 */
export async function purgeOrg(
  admin: Admin,
  org: DueOrg,
  deleteObjects: (orgId: string) => Promise<number>,
  now: Date = new Date(),
): Promise<PurgeOutcome> {
  let objects: number;
  try {
    objects = await deleteObjects(org.id);
  } catch (err) {
    log.error('purge: objects not deleted, org kept', { orgId: org.id, error: errorMessage(err) });
    return { status: 'kept', orgId: org.id, reason: `objects: ${errorMessage(err)}` };
  }
  const { data, error } = await admin
    .from('organizations')
    .delete()
    .eq('id', org.id)
    .not('deleted_at', 'is', null)
    .lte('deleted_at', purgeCutoff(now).toISOString())
    .select('id');
  if (error) {
    log.error('purge: rows not deleted', { orgId: org.id, error: error.message });
    return { status: 'kept', orgId: org.id, reason: `rows: ${error.message}` };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { status: 'kept', orgId: org.id, reason: 'no longer due' };
  }
  return { status: 'purged', orgId: org.id, objects };
}

// ── Event retention ─────────────────────────────────────────────────────

const PRUNE_BATCH = 500;
const PRUNE_MAX_BATCHES = 40;

export type PruneResult = { deleted: number; cutoff: string; more: boolean };

/**
 * Delete NON-audit events older than the retention window (D9), in batches so
 * one run stays bounded. Audit events — the `audit` flag, and as a second
 * line the audit verb list — are never touched here; they go with the org.
 * `more` says a batch cap stopped the run, so tomorrow's picks up the rest.
 */
export async function pruneOldEvents(admin: Admin, now: Date = new Date()): Promise<PruneResult> {
  const cutoff = retentionCutoff(now).toISOString();
  const auditVerbs = `(${AUDIT_VERBS.map((v) => `"${v}"`).join(',')})`;
  let deleted = 0;
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    const { data: ids, error: readErr } = await admin
      .from('activity_events')
      .select('id')
      .eq('audit', false)
      .not('verb', 'in', auditVerbs)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(PRUNE_BATCH);
    if (readErr) throw new Error(readErr.message);
    const list = ((ids ?? []) as { id: string }[]).map((r) => r.id);
    if (list.length === 0) return { deleted, cutoff, more: false };
    const { data: removed, error: delErr } = await admin
      .from('activity_events')
      .delete()
      .in('id', list)
      .eq('audit', false)
      .lt('created_at', cutoff)
      .select('id');
    if (delErr) throw new Error(delErr.message);
    deleted += Array.isArray(removed) ? removed.length : 0;
    if (list.length < PRUNE_BATCH) return { deleted, cutoff, more: false };
  }
  return { deleted, cutoff, more: true };
}
