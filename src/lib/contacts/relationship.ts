/**
 * Relationship stage — where the producer and this person are, worked out from
 * what has happened rather than typed in.
 *
 *   new → contacted → engaged → interested → working together → released
 *
 * Same convention as `deriveContactKind` and `deriveActivityTone`: pure, from
 * behaviour, so every existing contact is classified on day one with no data
 * entry, and nothing stored goes stale. The typed pipeline this replaces
 * ("new contact → contacted → beat sent") was already recorded as data;
 * maintaining it by hand was busywork.
 *
 * `crm_status` stays the MANUAL override for parking a contact: `cold` or
 * `archived` is reported alongside the derived stage rather than replacing it,
 * so un-parking someone shows where they really are.
 */

import type { Decision } from './decisions';

export const RELATIONSHIP_STAGES = ['new', 'contacted', 'engaged', 'interested', 'working_together', 'released'] as const;
export type RelationshipStage = (typeof RELATIONSHIP_STAGES)[number];

export interface RelationshipInput {
  /** Any beat send, project share or portal. */
  contacted: boolean;
  /** Any open (email or portal) or play. */
  engaged: boolean;
  /** Current decisions on this contact's beats. */
  decisions: readonly (Decision | null)[];
  /** Linked projects whose status is not archived. */
  activeLinkedProjects: number;
  crmStatus?: string | null;
}

export interface Relationship {
  stage: RelationshipStage;
  /** The producer parked this contact; the stage is still reported. */
  parked: 'cold' | 'archived' | null;
}

export function deriveRelationshipStage(input: RelationshipInput): Relationship {
  const parked = input.crmStatus === 'cold' || input.crmStatus === 'archived' ? input.crmStatus : null;
  const decisions = input.decisions.filter((d): d is Decision => d !== null);

  let stage: RelationshipStage = 'new';
  if (decisions.includes('released')) stage = 'released';
  else if (input.activeLinkedProjects > 0) stage = 'working_together';
  else if (decisions.some((d) => d === 'interested' || d === 'selected' || d === 'recording' || d === 'recorded')) stage = 'interested';
  else if (input.engaged) stage = 'engaged';
  else if (input.contacted) stage = 'contacted';

  return { stage, parked };
}

export const RELATIONSHIP_META: Record<RelationshipStage, { label: string }> = {
  new: { label: 'New' },
  contacted: { label: 'Contacted' },
  engaged: { label: 'Engaged' },
  interested: { label: 'Interested' },
  working_together: { label: 'Working together' },
  released: { label: 'Released' },
};

/**
 * Workspace mode: the contact page switches to the artist workspace when the
 * contact is linked to at least one project or has a portal. Everyone else —
 * buyers, leads, plain contacts — keeps the CRM page they have today.
 */
export function isWorkspaceMode(input: { linkedProjects: number; hasPortal: boolean }): boolean {
  return input.linkedProjects > 0 || input.hasPortal;
}
