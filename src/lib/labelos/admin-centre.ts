/**
 * The admin centre (doc 25, phase 3): one page where the people who run a
 * label or artist org see the state of the team, the roster and the licence,
 * and reach every management page from one place. It manages nothing itself:
 * each section links to the page that already owns the change (members, org
 * settings, connections, digest, export and deletion), so no rule exists twice.
 *
 * Pure: which sections a viewer gets, the team summary and the seat wording.
 * The route (`/api/org/[orgId]/admin`) does the reads.
 */
import type { Verb } from './activity';

/** Opening the centre needs this capability (admin and owner hold it). */
export const ADMIN_CENTRE_CAPABILITY = 'members.manage';

/** Team-management verbs listed under "Recent team changes" (all internal). */
export const TEAM_VERBS: readonly Verb[] = [
  'member.joined',
  'member.removed',
  'member.role_changed',
  'member.scope_changed',
  'member.capabilities_changed',
  'member.artists_changed',
  'member.account_created',
  'member.password_reset',
  'member.account_disabled',
  'member.account_enabled',
  'member.password_changed',
  'invitation.created',
  'invitation.revoked',
];

/** How many recent team changes the centre lists. */
export const RECENT_TEAM_LIMIT = 8;

export type AdminViewer = {
  role: string;
  orgKind: string;
  capabilities: readonly string[] | ReadonlySet<string>;
  /** Licensed modules; absent = the default licence (every module). */
  modules?: readonly string[];
};

function has(v: AdminViewer, cap: string): boolean {
  return Array.isArray(v.capabilities) ? v.capabilities.includes(cap) : (v.capabilities as ReadonlySet<string>).has(cap);
}

function licensed(v: AdminViewer, module: string): boolean {
  return !v.modules || v.modules.includes(module);
}

/**
 * Label and artist orgs only (a producer org is the studio's own, run from
 * the dashboard), and only for someone who manages members.
 */
export function mayOpenAdminCentre(v: AdminViewer): boolean {
  return (v.orgKind === 'label' || v.orgKind === 'artist') && has(v, ADMIN_CENTRE_CAPABILITY);
}

export type AdminSectionKey = 'team' | 'roster' | 'connections' | 'settings' | 'digest' | 'data';

export type AdminSection = {
  key: AdminSectionKey;
  label: string;
  description: string;
  href: string;
};

/**
 * The sections, in page order, that this viewer can act on. A section is
 * drawn only where its page would let them do something — the owner-only
 * pages (settings, export and deletion) are left out for an admin rather
 * than shown and refused.
 */
export function adminSections(v: AdminViewer, slug: string): AdminSection[] {
  if (!mayOpenAdminCentre(v)) return [];
  const base = `/o/${slug}`;
  const owner = v.role === 'owner';
  const out: AdminSection[] = [
    {
      key: 'team',
      label: 'Team and roster',
      description: 'Add artists, people and collaborators; create team accounts, set roles, functions and artist scope, reset passwords.',
      href: `${base}/settings/members`,
    },
  ];
  if (has(v, 'catalog.read')) {
    out.push({
      key: 'roster',
      label: v.orgKind === 'artist' ? 'Your collaborators' : 'Roster',
      description: v.orgKind === 'artist' ? 'The people you make music with.' : 'The artists signed to the label.',
      href: `${base}/artists`,
    });
  }
  if (has(v, 'org.manage')) {
    out.push({
      key: 'connections',
      label: 'Connections',
      description: v.orgKind === 'artist' ? 'Labels you share music with.' : 'Artists who share their catalogue with you.',
      href: `${base}/settings/connections`,
    });
  }
  if (owner) {
    out.push({
      key: 'settings',
      label: 'Organization settings',
      description: 'Approvals, reminders and which departments are on.',
      href: `${base}/settings/organization`,
    });
  }
  if (licensed(v, 'digest') && has(v, 'catalog.read')) {
    out.push({ key: 'digest', label: 'Weekly digest', description: 'The Monday email and the Slack channel.', href: `${base}/settings/digest` });
  }
  if (owner) {
    out.push({ key: 'data', label: 'Export & deletion', description: 'Take a copy of the organization, or close it down.', href: `${base}/settings/data` });
  }
  return out;
}

export type TeamSummary = {
  /** Everyone with a membership. */
  members: number;
  owners: number;
  admins: number;
  /** Role `member` — the departments. */
  staff: number;
  /** Role `artist` — roster logins. */
  artistLogins: number;
  /** Logins this org created (doc 25 phase 1). */
  teamAccounts: number;
  mustSetPassword: number;
  switchedOff: number;
  pendingInvitations: number;
};

export function summarizeTeam(
  members: readonly { role: string }[],
  managed: readonly { must_change_password: boolean; disabled_at: string | null }[],
  pendingInvitations: number,
): TeamSummary {
  const count = (role: string) => members.filter((m) => m.role === role).length;
  return {
    members: members.length,
    owners: count('owner'),
    admins: count('admin'),
    staff: count('member'),
    artistLogins: count('artist'),
    teamAccounts: managed.length,
    // A switched-off account cannot sign in, so it is not waiting on a password.
    mustSetPassword: managed.filter((m) => m.must_change_password && m.disabled_at === null).length,
    switchedOff: managed.filter((m) => m.disabled_at !== null).length,
    pendingInvitations,
  };
}

/** "3 of 5 seats used" / "3 seats used · no limit". */
export function usageLine(used: number, max: number | null, noun: { one: string; many: string }): string {
  if (max === null) return `${used} ${used === 1 ? noun.one : noun.many} · no limit`;
  return `${used} of ${max} ${max === 1 ? noun.one : noun.many}`;
}

/** At or past the cap: the page says so next to the number. */
export function atLimit(used: number, max: number | null): boolean {
  return max !== null && used >= max;
}
