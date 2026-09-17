import { NextRequest, NextResponse } from 'next/server';
import { getOwned, updateOwned, deleteOwned, isErrorResponse, isSupabaseConfigured } from '@/lib/db';
import { requireUser } from '@/lib/auth/ownership';
import { readBody } from '@/lib/validate';
import { ContactPatchBodySchema, type CrmStage } from '@/lib/contracts';
import { describeStageChange } from '@/lib/contacts/stage-change';
import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';

const log = createLogger('api.contacts.detail');

/**
 * Per-contact CRUD.
 *
 *   GET    — full contact row, used by /contacts/[id] detail page
 *   PATCH  — inline field edits (notes, phone, role, etc) from the detail page
 *   DELETE — used by the batch-delete bar on /contacts
 *
 * Auth: rides the facade's owner gate (same as tracks / projects / playlists).
 * Strictly owner-only — requireRowOwnership 403s a row whose user_id is null,
 * which is why the list endpoints had to stop including legacy null-owner rows
 * (they rendered in the CRM but 403'd the moment you opened one). Mig 111
 * adopts those rows onto the owner. The contacts table has CASCADE on
 * beat_sends so deletion cleans up history automatically.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getOwned('contacts', id);
  if (isErrorResponse(row)) return row;
  return NextResponse.json({ contact: row });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, ContactPatchBodySchema);
  if (!parsed.ok) return parsed.res;

  // Capture the prior stage before the write so the move can be logged to the
  // timeline. Only when crm_status is actually part of this patch — an edit to
  // notes or phone must not cost an extra read.
  const changingStage = 'crm_status' in parsed.data;
  let previousStage: CrmStage | null = null;
  if (changingStage) {
    const before = await getOwned('contacts', id);
    if (isErrorResponse(before)) return before;
    previousStage = ((before as { crm_status?: CrmStage | null } | null)?.crm_status) ?? null;
  }

  const result = await updateOwned('contacts', id, parsed.data);
  if (isErrorResponse(result)) return result;

  if (changingStage) {
    await logStageChange(id, previousStage, parsed.data.crm_status ?? null);
  }

  return NextResponse.json({ contact: result });
}

/**
 * Append a `stage_change` row to the contact's timeline.
 *
 * Non-fatal by design: the stage edit itself already succeeded, and losing an
 * audit row must not turn a working inline edit into an error toast. No
 * dedupe_key — mig 094's unique index is partial on `dedupe_key IS NOT NULL`,
 * so leaving it unset lets a contact legitimately move back and forth between
 * the same two stages over time.
 */
async function logStageChange(
  contactId: string,
  from: CrmStage | null,
  to: CrmStage | null,
): Promise<void> {
  const change = describeStageChange(from, to);
  if (!change || !isSupabaseConfigured()) return;
  try {
    const auth = await requireUser();
    if (!auth.ok) return;
    const { error } = await auth.admin.from('contact_activity').insert({
      contact_id: contactId,
      user_id: auth.userId,
      kind: 'stage_change',
      title: change.title,
      body: change.body,
      metadata: { from, to },
    });
    if (error) log.warn('stage change log failed', { contactId, error: error.message });
  } catch (err) {
    log.warn('stage change log threw', { contactId, error: errorMessage(err) });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteOwned('contacts', id);
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ success: true });
}
