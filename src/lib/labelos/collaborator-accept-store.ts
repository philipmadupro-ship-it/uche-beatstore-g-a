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
import { liveMembership } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
import { recordEvent } from './activity';
import { COLLABORATOR_ROLE_DEFS, parseCollaboratorIntent, planAcceptCredit } from './collaborators';
import { creditEventSubject, ensureOwnParty, insertCredit } from './credits-store';
import { resolveCreditScope } from './credit-roles';

const log = createLogger('labelos.collaborator-accept');

export type CollaboratorAcceptResult = { proposed: true; creditId: string } | { proposed: false; reason: string };

export async function proposeCollaboratorCredit(
  admin: AdminClient,
  a: { tokenHash: string; orgId: string; projectId: string; userId: string },
): Promise<CollaboratorAcceptResult> {
  try {
    const inv = await admin
      .from('org_invitations')
      .select('functions, invited_by')
      .eq('token_hash', a.tokenHash)
      .eq('org_id', a.orgId)
      .eq('project_id', a.projectId)
      .maybeSingle();
    if (inv.error) throw new Error(inv.error.message);
    const row = inv.data as { functions: string[] | null; invited_by: string | null } | null;
    const intent = parseCollaboratorIntent(row?.functions);
    if (!row || !intent) return { proposed: false, reason: 'no_intent' };

    const inviter = row.invited_by ? await liveMembership(admin, a.orgId, row.invited_by) : null;
    const placed = await admin.from('project_tracks').select('track_id').eq('project_id', a.projectId).eq('track_id', intent.songId).maybeSingle();
    if (placed.error) throw new Error(placed.error.message);
    const track = placed.data
      ? await admin.from('tracks').select('id').eq('id', intent.songId).eq('org_id', a.orgId).maybeSingle()
      : null;
    if (track?.error) throw new Error(track.error.message);

    const plan = planAcceptCredit({
      intent,
      inviterId: row.invited_by,
      inviterCanWriteRights: !!inviter?.capabilities.has('rights.write'),
      songInProject: !!track?.data,
    });
    if (!plan.ok) return { proposed: false, reason: plan.reason };

    const scope = resolveCreditScope(plan.creditRole);
    if (!scope.ok) return { proposed: false, reason: 'bad_role' };
    const party = await ensureOwnParty(admin, a.orgId, a.userId);
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
