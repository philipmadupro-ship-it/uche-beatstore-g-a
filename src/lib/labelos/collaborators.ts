/**
 * Collaborators on a song or project (LABEL-69): a beatmaker, producer,
 * rapper, feature or engineer invited from OUTSIDE the org. Pure; the routes
 * and stores read and write.
 *
 * An invitation with a collaborator role is an ordinary project invitation
 * (LABEL-21, `project_members`, never `org_members`) that also says which
 * credit to PROPOSE for the invitee on a song of that project once they
 * accept. The credit is proposed by the inviter and confirmed by the
 * collaborator — nobody confirms for them (LABEL-27 `planDecision`).
 *
 * No migration (phase 2 note): the intent rides on `org_invitations.functions`
 * (text[], no CHECK on its values, unused by a project invitation) as two
 * tags, `collab:<role>` and `song:<uuid>`. `labelos_accept_invitation` copies
 * `functions` only for an org-member invitation, so the tags cannot grant
 * anything; they are read back by the join route after the SQL function has
 * admitted the person. A real column is a follow-up.
 */
import { isUUID } from '@/lib/validate';

export const COLLABORATOR_ROLES = ['beatmaker', 'producer', 'rapper', 'feature', 'engineer'] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

export type CollaboratorRoleDef = {
  key: CollaboratorRole;
  label: string;
  /** The credit role (lib/labelos/credit-roles) proposed for this collaborator. */
  creditRole: string;
  roleDetail: string | null;
  /** The project role the invite form starts from; the inviter may change it. */
  suggestedProjectRole: 'commenter' | 'contributor';
};

export const COLLABORATOR_ROLE_DEFS: Readonly<Record<CollaboratorRole, CollaboratorRoleDef>> = {
  beatmaker: { key: 'beatmaker', label: 'Beatmaker', creditRole: 'producer', roleDetail: 'Beat', suggestedProjectRole: 'contributor' },
  producer: { key: 'producer', label: 'Producer', creditRole: 'producer', roleDetail: null, suggestedProjectRole: 'contributor' },
  rapper: { key: 'rapper', label: 'Rapper', creditRole: 'vocalist', roleDetail: 'Rap', suggestedProjectRole: 'contributor' },
  feature: { key: 'feature', label: 'Feature', creditRole: 'feature', roleDetail: null, suggestedProjectRole: 'commenter' },
  engineer: { key: 'engineer', label: 'Engineer', creditRole: 'recording_engineer', roleDetail: null, suggestedProjectRole: 'contributor' },
};

export function isCollaboratorRole(v: unknown): v is CollaboratorRole {
  return typeof v === 'string' && (COLLABORATOR_ROLES as readonly string[]).includes(v);
}

const ROLE_PREFIX = 'collab:';
const SONG_PREFIX = 'song:';

/** The two tags stored on the invitation. */
export function encodeCollaboratorIntent(role: CollaboratorRole, songId: string): string[] {
  return [`${ROLE_PREFIX}${role}`, `${SONG_PREFIX}${songId.toLowerCase()}`];
}

export type CollaboratorIntent = { role: CollaboratorRole; songId: string };

/** Read the intent back. Anything malformed or incomplete is no intent (never a guess). */
export function parseCollaboratorIntent(functions: readonly string[] | null | undefined): CollaboratorIntent | null {
  if (!functions) return null;
  let role: CollaboratorRole | null = null;
  let songId: string | null = null;
  for (const tag of functions) {
    if (tag.startsWith(ROLE_PREFIX)) {
      const r = tag.slice(ROLE_PREFIX.length);
      if (!isCollaboratorRole(r)) return null;
      role = r;
    } else if (tag.startsWith(SONG_PREFIX)) {
      const s = tag.slice(SONG_PREFIX.length).toLowerCase();
      if (!isUUID(s)) return null;
      songId = s;
    }
  }
  return role && songId ? { role, songId } : null;
}

export type CollaboratorInviteCheck =
  | { ok: true; intent: CollaboratorIntent | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * May this invitation carry a collaborator role? Both fields or neither;
 * proposing a credit is `rights.write`, a separate act from sharing the
 * project (`share.external`), so the inviter needs both.
 */
export function checkCollaboratorInvite(input: {
  collaboratorRole: string | null | undefined;
  songId: string | null | undefined;
  inviterCanWriteRights: boolean;
}): CollaboratorInviteCheck {
  const { collaboratorRole, songId } = input;
  if (!collaboratorRole && !songId) return { ok: true, intent: null };
  if (!collaboratorRole || !songId) return { ok: false, status: 400, error: 'Name both the collaborator role and the song' };
  if (!isCollaboratorRole(collaboratorRole)) return { ok: false, status: 400, error: `Unknown collaborator role "${collaboratorRole}"` };
  if (!isUUID(songId)) return { ok: false, status: 400, error: 'song_id must be a uuid' };
  if (!input.inviterCanWriteRights) return { ok: false, status: 403, error: 'Proposing a credit needs rights access' };
  return { ok: true, intent: { role: collaboratorRole, songId: songId.toLowerCase() } };
}

export type AcceptCreditPlan =
  | { ok: true; creditRole: string; roleDetail: string | null; createdBy: string }
  | { ok: false; reason: 'no_intent' | 'inviter_gone' | 'song_not_in_project' };

/**
 * What to propose when the invitee accepts. The credit is created in the
 * INVITER's name (so the collaborator can confirm it), and only if the
 * inviter still holds `rights.write` and the song is still in the project.
 */
export function planAcceptCredit(input: {
  intent: CollaboratorIntent | null;
  inviterId: string | null;
  inviterCanWriteRights: boolean;
  songInProject: boolean;
}): AcceptCreditPlan {
  if (!input.intent) return { ok: false, reason: 'no_intent' };
  if (!input.inviterId || !input.inviterCanWriteRights) return { ok: false, reason: 'inviter_gone' };
  if (!input.songInProject) return { ok: false, reason: 'song_not_in_project' };
  const def = COLLABORATOR_ROLE_DEFS[input.intent.role];
  return { ok: true, creditRole: def.creditRole, roleDetail: def.roleDetail, createdBy: input.inviterId };
}
