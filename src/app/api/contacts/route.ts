import { NextRequest, NextResponse } from 'next/server';
import { scopedList, insertOwned, isErrorResponse, isSupabaseConfigured, createServiceClient, getAll, requireUser, query, update } from '@/lib/db';
import { safeSellerId } from '@/lib/auth/ownership';
import { readBody, parsePagination } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { ContactsBatchPatchBodySchema, ContactCreateBodySchema, type CrmStage } from '@/lib/contracts';
import { normalizeEmailOrNull } from '@/lib/contacts/email';
import { selectInChunks } from '@/lib/db-in-chunks';
import { describeStageChange } from '@/lib/contacts/stage-change';
import { createLogger } from '@/lib/log';

const log = createLogger('api.contacts');

/**
 * Append one `stage_change` row per contact the bulk edit actually moved.
 *
 * Rows whose stage already equalled the target are skipped — describeStageChange
 * returns null for a no-op — so selecting 200 contacts and setting a stage half
 * of them already had logs 100 entries, not 200. One batched insert; non-fatal,
 * because the stage edit itself has already committed.
 */
async function logBulkStageChanges(
  admin: { from(table: string): { insert(rows: unknown[]): PromiseLike<{ error: { message: string } | null }> } },
  userId: string,
  updatedIds: string[],
  priorStages: Map<string, CrmStage | null>,
  next: CrmStage | null,
): Promise<void> {
  const rows = updatedIds.flatMap((id) => {
    const change = describeStageChange(priorStages.get(id) ?? null, next);
    if (!change) return [];
    return [{
      contact_id: id,
      user_id: userId,
      kind: 'stage_change',
      title: change.title,
      body: change.body,
      metadata: { from: priorStages.get(id) ?? null, to: next, bulk: true },
    }];
  });
  if (rows.length === 0) return;
  try {
    const { error } = await admin.from('contact_activity').insert(rows);
    if (error) log.warn('bulk stage change log failed', { count: rows.length, error: error.message });
  } catch (err) {
    log.warn('bulk stage change log threw', { count: rows.length, error: errorMessage(err) });
  }
}

interface ContactTagRow {
  id?: string;
  contact_id: string;
  tag: string;
  category?: string | null;
}

interface ContactRow {
  id: string;
}

/**
 * Contacts list + create — runs through the storage facade so the
 * `if (supabase) else (local)` boilerplate is centralized.
 *
 * GET  /api/contacts → caller's contacts, oldest-name-first, with tags attached
 *                       (mig 091). Owner-only (mig 097 + adoption in mig 111).
 * POST /api/contacts → create with user_id auto-stamped from session. Zod-
 *                       validated against the same field list as PATCH, so
 *                       the two can't drift (they did — see the contract).
 */
export async function GET(req: NextRequest) {
  const searchParams = new URL(req.url).searchParams;
  const { limit, offset } = parsePagination(searchParams);
  const crmStatus = searchParams.get('crm_status');
  const rows = await scopedList<{ id: string; [k: string]: unknown }>('contacts', {
    orderBy: 'name',
    ascending: true,
    // Owner-only, matching mig 097's RLS decision and /api/beat_sends. Legacy
    // null-owner rows are adopted onto the owner by mig 111 rather than being
    // included here by a service-role query that bypasses the policy.
    includeNullOwner: false,
    limit,
    offset,
    ...(crmStatus ? { extraEq: { crm_status: crmStatus } } : {}),
  });
  if (isErrorResponse(rows)) return rows;

  // Batch-attach tags so the CRM can filter/group by them client-side.
  const ids = rows.map((r) => r.id);
  const tagsByContact = new Map<string, { tag: string; category: string | null }[]>();
  if (ids.length) {
    if (isSupabaseConfigured()) {
      const admin = createServiceClient();
      // Chunked: one id per contact went into the URL, so this sat on the same
      // length cliff that took /api/tracks/store-summary (and with it the whole
      // store editor) down at ~650 ids.
      const tagRows = await selectInChunks<ContactTagRow>(ids, (batch) =>
        admin.from('contact_tags').select('contact_id, tag, category').in('contact_id', batch));
      tagRows.forEach((r) => {
        const arr = tagsByContact.get(r.contact_id) ?? [];
        arr.push({ tag: r.tag, category: r.category ?? null });
        tagsByContact.set(r.contact_id, arr);
      });
    } else {
      getAll<ContactTagRow>('contact_tags').forEach((r) => {
        const arr = tagsByContact.get(r.contact_id) ?? [];
        arr.push({ tag: r.tag, category: r.category ?? null });
        tagsByContact.set(r.contact_id, arr);
      });
    }
  }

  const withTags = rows.map((r) => ({ ...r, tags: tagsByContact.get(r.id) ?? [] }));
  return NextResponse.json(withTags);
}

export async function POST(req: NextRequest) {
  const parsed = await readBody(req, ContactCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const { name, email, ...rest } = parsed.data;

  const result = await insertOwned('contacts', {
    ...rest,
    name: name.trim(),
    // Normalised so a hand-added contact matches the buyer rows written by
    // checkout / the webhook. contacts_user_email_uniq (user_id, email) is
    // case-sensitive, so raw casing here silently forks the same human into
    // two contacts the first time they buy.
    email: normalizeEmailOrNull(email),
  });
  if (isErrorResponse(result)) return result;
  return NextResponse.json(result);
}

/**
 * PATCH /api/contacts — batch edit. Body { ids, patch: { crm_status?, category? } }.
 * Used by the CRM bulk-edit bar. Owner-scoped: only the caller's rows among
 * the given ids are updated.
 */
export async function PATCH(req: NextRequest) {
  const parsed = await readBody(req, ContactsBatchPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const { ids, patch } = parsed.data;
  if (Object.keys(patch).length === 0) return NextResponse.json({ updated: 0 });

  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    if (isSupabaseConfigured()) {
      // Validate before interpolating into .or() (comma footgun).
      const safeId = safeSellerId(auth.userId);
      if (!safeId) return NextResponse.json({ updated: 0 });
      // Prior stages, captured before the write so each move can be logged to
      // the contact's timeline. Only when the batch actually touches
      // crm_status — a category-only bulk edit skips the extra read.
      const changingStage = 'crm_status' in patch;
      let priorStages = new Map<string, CrmStage | null>();
      if (changingStage) {
        const { data: before } = await auth.admin
          .from('contacts')
          .select('id, crm_status')
          .in('id', ids)
          .eq('user_id', safeId);
        priorStages = new Map(
          ((before ?? []) as { id: string; crm_status: CrmStage | null }[])
            .map((r) => [r.id, r.crm_status ?? null]),
        );
      }

      // Single UPDATE … IN (ids) scoped to the owner. No N round-trips.
      const { data, error } = await auth.admin
        .from('contacts')
        .update(patch)
        .in('id', ids)
        .eq('user_id', safeId)
        .select('id');
      if (error) throw new Error(error.message);

      if (changingStage) {
        await logBulkStageChanges(
          auth.admin,
          auth.userId,
          ((data ?? []) as ContactRow[]).map((r) => r.id),
          priorStages,
          patch.crm_status ?? null,
        );
      }

      return NextResponse.json({ updated: data?.length ?? 0 });
    }

    // Local-store fallback.
    const idset = new Set(ids);
    const rows = query<ContactRow>('contacts', (c) => idset.has(c.id));
    rows.forEach((r) => update('contacts', r.id, patch));
    return NextResponse.json({ updated: rows.length });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
