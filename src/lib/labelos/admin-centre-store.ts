/**
 * Reads behind the admin centre (doc 25, phase 3). Counts only, plus the last
 * few team changes; nothing here writes. The caller has already passed
 * `requireOrgCapability(orgId, 'members.manage')`.
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { VERB_PHRASES } from './digest';
import type { Verb } from './activity';
import { RECENT_TEAM_LIMIT, TEAM_VERBS, summarizeTeam, type TeamSummary } from './admin-centre';
import { orgEntitlements } from './entitlements';
import { seatsInUse } from './entitlements-store';
import { memberIdentities, memberLabel, type IdentityAdmin } from './member-identity';
import { orgContactRoles } from './org-contacts';
import { hasArtistRole } from './roster';
import { isMissingTeamAccounts } from './team-accounts';

export type TeamChange = { id: string; verb: Verb; phrase: string; actor: string; subject: string | null; at: string };

export type AdminSummary = {
  team: TeamSummary;
  seats: { used: number; max: number | null };
  artists: { count: number; max: number | null };
  /** The licence: `licensed` false = the default (everything the face allows). */
  licence: { licensed: boolean; modules: string[] };
  /** Null when this viewer may not read the org's internal events. */
  recent: TeamChange[] | null;
};

async function managedRows(access: OrgAccessOk) {
  const { data, error } = await access.admin
    .from('org_managed_accounts')
    .select('must_change_password, disabled_at')
    .eq('org_id', access.orgId);
  if (error) {
    // Before 190 there are no team accounts to count.
    if (isMissingTeamAccounts(error)) return [];
    throw new Error(`team accounts: ${error.message}`);
  }
  return (data ?? []) as { must_change_password: boolean; disabled_at: string | null }[];
}

async function pendingInvitations(access: OrgAccessOk): Promise<number> {
  const { count, error } = await access.admin
    .from('org_invitations')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', access.orgId)
    .is('project_id', null)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());
  if (error) throw new Error(`invitations: ${error.message}`);
  return count ?? 0;
}

/**
 * The team verbs are all `internal` and name no artist, so (activity-feed's
 * rule) only a whole-org member with `business.read.internal` reads them.
 */
function seesTeamChanges(access: OrgAccessOk): boolean {
  return access.scope === 'org' && access.capabilities.has('business.read.internal');
}

async function recentTeamChanges(access: OrgAccessOk): Promise<TeamChange[] | null> {
  if (!seesTeamChanges(access)) return null;
  const { data, error } = await access.admin
    .from('activity_events')
    .select('id, verb, actor_id, subject_type, subject_id, created_at')
    .eq('org_id', access.orgId)
    .in('verb', TEAM_VERBS as string[])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_TEAM_LIMIT);
  if (error) throw new Error(`team changes: ${error.message}`);
  const rows = (data ?? []) as { id: string; verb: Verb; actor_id: string | null; subject_type: string | null; subject_id: string | null; created_at: string }[];
  const people = new Set<string>();
  for (const r of rows) {
    if (r.actor_id) people.add(r.actor_id);
    if (r.subject_type === 'member' && r.subject_id) people.add(r.subject_id);
  }
  const names = await memberIdentities(access.admin as unknown as IdentityAdmin, access.orgId, [...people]);
  return rows.map((r) => ({
    id: r.id,
    verb: r.verb,
    phrase: VERB_PHRASES[r.verb]?.one ?? r.verb,
    actor: r.actor_id ? memberLabel(names.get(r.actor_id)) : 'Someone',
    // A member event names who it was about; an invitation's subject is the invitation, not a person.
    subject: r.subject_type === 'member' && r.subject_id && r.subject_id !== r.actor_id ? memberLabel(names.get(r.subject_id)) : null,
    at: r.created_at,
  }));
}

export async function loadAdminSummary(access: OrgAccessOk): Promise<AdminSummary> {
  const { data: members, error } = await access.admin.from('org_members').select('role').eq('org_id', access.orgId);
  if (error) throw new Error(`members: ${error.message}`);
  const entitlements = access.entitlements ?? orgEntitlements({ kind: access.orgKind }, null);
  const [managed, pending, seats, contacts, recent] = await Promise.all([
    managedRows(access),
    pendingInvitations(access),
    seatsInUse(access.admin, access.orgId),
    orgContactRoles(access.admin, access),
    recentTeamChanges(access),
  ]);
  return {
    team: summarizeTeam((members ?? []) as { role: string }[], managed, pending),
    seats: { used: seats, max: entitlements.maxSeats },
    artists: { count: contacts.filter(hasArtistRole).length, max: entitlements.maxArtists },
    licence: { licensed: entitlements.licensed, modules: [...entitlements.modules].sort() },
    recent,
  };
}
