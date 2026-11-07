/**
 * After a collaborator accepts a project invitation (LABEL-69): propose the
 * credit the invitation named, for the invitee's OWN party, in the INVITER's
 * name — so the collaborator confirms it and nobody confirms for them.
 *
 * Best effort and never throws: the person is already admitted when this
 * runs, and a credit that cannot be written (migration 153 not applied, the
 * inviter lost `rights.write`, the song left the project) leaves them on the
 * project with nothing proposed. The inviter proposes by hand then.
 */
import { objectAccessFor } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
import { recordEvent } from './activity';
import { COLLABORATOR_ROLE_DEFS, parseCollaboratorIntent, planAcceptCredit } from './collaborators';
import { creditEventSubject, insertCredit, isUniqueViolation, ownDisplayName, ownPartyRow } from './credits-store';
import { PARTY_COLUMNS, ownPartyName } from './parties';
import { resolveCreditScope } from './credit-roles';

const log = createLogger('labelos.collaborator-accept');

/** How recently the invitation must have been accepted for this call to follow it. */
const FRESH_MS = 2 * 60 * 1000;

export type CollaboratorAcceptResult = { proposed: true; creditId: string } | { proposed: false; reason: string };

export async function proposeCollaboratorCredit(
  admin: AdminClient,
  a: { tokenHash: string; orgId: string; projectId: string; userId: string },
): Promise<CollaboratorAcceptResult> {
  try {
    const inv = await admin
      .from('org_invitations')
      .select('functions, invited_by, email, accepted_at')
      .eq('token_hash', a.tokenHash)
      .eq('org_id', a.orgId)
      .eq('project_id', a.projectId)
      .maybeSingle();
    if (inv.error) throw new Error(inv.error.message);
    const row = inv.data as { functions: string[] | null; invited_by: string | null; email: string | null; accepted_at: string | null } | null;
    const intent = parseCollaboratorIntent(row?.functions);
    if (!row || !intent) return { proposed: false, reason: 'no_intent' };
    // The accept function stamps `accepted_at` in the same call. A person who was already on the project also
    // answers `already_member` (their invitation is spent without changing anything), so the credit follows the
    // invitation being accepted JUST NOW, not the answer. A spent link opened again later proposes nothing, so a
    // credit the inviter withdrew stays withdrawn.
    const acceptedAt = row.accepted_at ? Date.parse(row.accepted_at) : NaN;
    if (!Number.isFinite(acceptedAt) || Math.abs(Date.now() - acceptedAt) > FRESH_MS) return { proposed: false, reason: 'not_fresh' };

    // The inviter's own access to THIS song — membership, artist scope and the org's licence, as a credit proposed
    // through the route would be judged — not just a role that once held rights.write.
    const inviter = row.invited_by ? await objectAccessFor(row.invited_by, { table: 'tracks', id: intent.songId, cap: 'rights.write', orgId: a.orgId }) : null;
    const placed = await admin.from('project_tracks').select('track_id').eq('project_id', a.projectId).eq('track_id', intent.songId).maybeSingle();
    if (placed.error) throw new Error(placed.error.message);
    const track = placed.data
      ? await admin.from('tracks').select('id').eq('id', intent.songId).eq('org_id', a.orgId).maybeSingle()
      : null;
    if (track?.error) throw new Error(track.error.message);

    const plan = planAcceptCredit({
      intent,
      inviterId: row.invited_by,
      inviterCanWriteRights: !!inviter?.ok,
      songInProject: !!track?.data,
    });
    if (!plan.ok) return { proposed: false, reason: plan.reason };

    const scope = resolveCreditScope(plan.creditRole);
    if (!scope.ok) return { proposed: false, reason: 'bad_role' };
    // The invitee's own party, linked to their account. An outside collaborator has no org profile, so the name
    // falls back to the address they were invited at (the invitation's, which they proved they own by accepting).
    let party = await ownPartyRow(admin, a.orgId, a.userId);
    if (!party) {
      const known = await ownDisplayName(admin, a.orgId, a.userId);
      const name = known && known !== 'Member' ? known : ownPartyName({ name: null, email: row.email });
      const made = await admin
        .from('parties')
        .insert({ org_id: a.orgId, kind: 'person', display_name: name, user_id: a.userId, created_by: a.userId })
        .select(PARTY_COLUMNS)
        .single();
      if (isUniqueViolation(made.error)) party = await ownPartyRow(admin, a.orgId, a.userId);
      else if (made.error) throw new Error(made.error.message);
      else party = made.data as unknown as NonNullable<typeof party>;
    }
    if (!party) throw new Error('own party missing');
    const inserted = await insertCredit(admin, {
      org: a.orgId,
      trackId: intent.songId,
      name: party.display_name,
      role: plan.creditRole,
      scope: scope.scope,
      roleDetail: plan.roleDetail,
      partyId: party.id,
      contactId: null,
      createdBy: plan.createdBy,
    });
    if ('duplicate' in inserted) return { proposed: false, reason: 'duplicate' };
    await recordEvent(
      admin,
      { orgId: a.orgId, userId: plan.createdBy },
      'credit.proposed',
      await creditEventSubject(admin, a.orgId, intent.songId, inserted.credit.id),
      { role: plan.creditRole, scope: scope.scope, collaborator: COLLABORATOR_ROLE_DEFS[intent.role].key },
    ).catch((err) => log.error('credit event failed', { error: err instanceof Error ? err.message : String(err) }));
    return { proposed: true, creditId: inserted.credit.id };
  } catch (err) {
    log.error('collaborator credit not proposed', { orgId: a.orgId, projectId: a.projectId, error: err instanceof Error ? err.message : String(err) });
    return { proposed: false, reason: 'failed' };
  }
}
