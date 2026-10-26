/**
 * The producer's personal org (LABEL-07, 11-migration-strategy.md M2).
 *
 * Every `creator_profiles` owner owns one `producer`-kind org. Migration 137
 * creates it for the producers that exist when it is applied; POST
 * /api/profile calls `ensurePersonalOrg` after every successful save so a
 * producer created later gets one too. Both go through the same SQL function,
 * `labelos_ensure_producer_org`, which:
 *  - does nothing for a user without a creator_profiles row (buyers);
 *  - does nothing for a user who already owns or created a producer org (so
 *    an ownership transfer never spawns a second one);
 *  - takes a per-user advisory lock, so two simultaneous profile saves create
 *    one org, not two.
 * Keeping the rule in SQL means the backfill and the route cannot disagree.
 *
 * This is a side effect of a profile save, never a reason for it to fail:
 * `ensurePersonalOrg` never throws, and before 136/137 are applied it answers
 * `skipped / schema_missing` (CLAUDE.md: unapplied migrations degrade).
 * No org_id is written to any existing table (M7, out of scope).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';
import { recordEvent, type ActivityAdmin } from './activity';

const log = createLogger('lib.labelos.personal-org');

export const ENSURE_PRODUCER_ORG_RPC = 'labelos_ensure_producer_org';

export type PersonalOrgResult =
  | { status: 'created'; orgId: string }
  | { status: 'exists'; orgId: string }
  | { status: 'skipped'; reason: 'not_producer' | 'schema_missing' | 'invalid_user' }
  | { status: 'failed'; error: string };

/** `.rpc()` for the function, `.from()` for the activity event. */
export type PersonalOrgAdmin = Pick<SupabaseClient, 'rpc'> & ActivityAdmin;

type RpcError = { code?: string; message?: string } | null;

/**
 * PostgREST: function not in the schema cache (137 missing). Postgres:
 * undefined function, or an undefined table inside it (136 missing).
 */
const MISSING_SCHEMA_CODES = new Set(['PGRST202', '42883', '42P01', '42703', 'PGRST205']);

function isMissingSchema(error: NonNullable<RpcError>): boolean {
  if (error.code && MISSING_SCHEMA_CODES.has(error.code)) return true;
  return typeof error.message === 'string' && /does not exist|schema cache/i.test(error.message);
}

/** Pure: what the RPC's answer means. */
export function interpretEnsureResult(data: unknown, error: RpcError): PersonalOrgResult {
  if (error) {
    if (isMissingSchema(error)) return { status: 'skipped', reason: 'schema_missing' };
    return { status: 'failed', error: error.message || error.code || 'unknown error' };
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (d.skipped === 'not_producer') return { status: 'skipped', reason: 'not_producer' };
    if (isUUID(d.org_id) && typeof d.created === 'boolean') {
      return d.created ? { status: 'created', orgId: d.org_id } : { status: 'exists', orgId: d.org_id };
    }
  }
  return { status: 'failed', error: `unexpected ${ENSURE_PRODUCER_ORG_RPC} answer` };
}

/**
 * Make sure `userId` owns a producer org if they are the producer. Call it
 * with the service-role client after the profile write succeeded. Never
 * throws.
 */
export async function ensurePersonalOrg(admin: PersonalOrgAdmin, userId: string): Promise<PersonalOrgResult> {
  // Local-store mode writes the profile as 'local-user'; there is no database.
  if (!isUUID(userId)) return { status: 'skipped', reason: 'invalid_user' };

  let result: PersonalOrgResult;
  try {
    const { data, error } = await admin.rpc(ENSURE_PRODUCER_ORG_RPC, { p_user: userId });
    result = interpretEnsureResult(data, error as RpcError);
  } catch (err) {
    result = { status: 'failed', error: errorMessage(err) };
  }

  if (result.status === 'failed') {
    log.warn('personal org not ensured', { userId, error: result.error });
  } else if (result.status === 'skipped' && result.reason === 'schema_missing') {
    log.debug('personal org skipped: migrations 136/137 not applied', { userId });
  } else if (result.status === 'created') {
    log.info('personal org created', { userId, orgId: result.orgId });
    // Everyday event: best effort, never thrown (recordEvent returns ok:false).
    try {
      await recordEvent(
        admin,
        { orgId: result.orgId, userId },
        'org.created',
        { type: 'org', id: result.orgId },
        { kind: 'producer', source: 'profile' },
      );
    } catch (err) {
      log.warn('org.created event not recorded', { orgId: result.orgId, error: errorMessage(err) });
    }
  }
  return result;
}
