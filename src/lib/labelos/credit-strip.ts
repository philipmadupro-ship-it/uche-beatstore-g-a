/**
 * The credits strip in an org (LABEL-27): the producer's `groupCredits` (one
 * pill per person, roles joined) read over org credit views, plus what the
 * org context adds — a status per pill and the rights-holder party behind it.
 * Pure, so the rules (worst status wins, a pill is "linked" only when every
 * credit of the person names a party, which actions a pill offers) are
 * Vitest-covered instead of living in the component.
 */
import { groupCredits, type CreditGroup, type TrackCollaborator } from '@/lib/tracks/collaborators';
import { CREDIT_ROLES, type CreditRoleDef, type CreditScope, type CreditStatus } from './credit-roles';
import { worstStatus, type CreditView } from './credits';

/** A credit view in the shape `groupCredits` reads (the producer's row), carrying its view along. */
export type StripCredit = TrackCollaborator & { view: CreditView };

export function toStripCredit(view: CreditView): StripCredit {
  return {
    id: view.id,
    track_id: view.trackId,
    name: view.name,
    role: view.role,
    source: view.source,
    created_at: view.createdAt,
    contact_id: view.contactId,
    view,
  };
}

export type StripPerson = {
  key: string;
  name: string;
  roles: string[];
  credits: CreditView[];
  /** The worst status among the person's credits. */
  status: CreditStatus;
  /** Every credit of the person names a rights-holder party. */
  hasParty: boolean;
  /** Any credit here is the viewer's own. */
  mine: boolean;
  /** Something the viewer can confirm or dispute here. */
  actionable: boolean;
};

/** Credits grouped by person, in `groupCredits` order, each with its org-context summary. */
export function stripPeople(views: readonly CreditView[]): StripPerson[] {
  const groups: CreditGroup<StripCredit>[] = groupCredits(views.map(toStripCredit));
  return groups.map((g) => {
    const credits = g.credits.map((c) => c.view);
    return {
      key: g.key,
      name: g.name,
      roles: g.roles,
      credits,
      status: worstStatus(credits.map((c) => c.status)),
      hasParty: credits.every((c) => c.partyId !== null),
      mine: credits.some((c) => c.mine),
      actionable: credits.some((c) => c.can.confirm || c.can.dispute),
    };
  });
}

/** The words under a pill: who, in what, in what state. */
export function personSummary(p: StripPerson, roleLabel: (key: string) => string): string {
  const roles = p.roles.map(roleLabel).join(', ');
  const state = p.status === 'confirmed' ? 'confirmed' : p.status;
  return `${p.name} · ${roles} · ${state}${p.hasParty ? '' : ' · no rights-holder party'}`;
}

export type RoleGroup = { scope: CreditScope; label: string; roles: CreditRoleDef[] };

/** The roles to offer when adding a credit, by scope. The legacy `collaborator` stays out of the picker (it says nothing). */
export function roleGroups(roles: readonly { key: string; label: string; scope: CreditScope; detail?: string | null }[] = CREDIT_ROLES): RoleGroup[] {
  const defs = roles.filter((r) => r.key !== 'collaborator').map((r) => ({ key: r.key, label: r.label, scope: r.scope, detail: r.detail ?? undefined }));
  return [
    { scope: 'composition', label: 'The song', roles: defs.filter((r) => r.scope === 'composition') },
    { scope: 'recording', label: 'The recording', roles: defs.filter((r) => r.scope === 'recording') },
  ];
}
