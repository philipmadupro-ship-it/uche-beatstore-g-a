import type { CrmStage } from '@/lib/contracts';

/**
 * Human-readable description of a CRM pipeline transition.
 *
 * `contact_activity` supported `kind: 'stage_change'` from the day it was
 * created (mig 094) and the POST route's Zod enum accepted it — but nothing
 * ever wrote one. Only manual notes and the Stripe webhook touched the table,
 * so the timeline had a hole exactly where pipeline history belonged: you
 * could see that a contact was "negotiating" but never when they got there,
 * what they were before, or how long the move took.
 *
 * Pure so the phrasing is unit-tested rather than asserted inside a route —
 * the same reason filterAndSortTracks and scoreLead live in lib/.
 */

const STAGE_LABELS: Record<CrmStage, string> = {
  prospect: 'Prospect',
  active: 'Active',
  engaged: 'Engaged',
  customer: 'Customer',
  cold: 'Cold',
  archived: 'Archived',
};

/** Display label for a stage, or "Unset" for a null/cleared stage. */
export function stageLabel(stage: CrmStage | null | undefined): string {
  return stage ? STAGE_LABELS[stage] ?? stage : 'Unset';
}

export interface StageChange {
  title: string;
  body: string | null;
}

/**
 * Describe a transition, or return null when nothing actually moved — callers
 * use the null to skip writing a no-op row (a PATCH that resends the current
 * stage, or a bulk edit that includes contacts already on the target stage).
 */
export function describeStageChange(
  from: CrmStage | null | undefined,
  to: CrmStage | null | undefined,
): StageChange | null {
  const before = from ?? null;
  const after = to ?? null;
  if (before === after) return null;

  if (after === null) return { title: `Stage cleared (was ${stageLabel(before)})`, body: null };
  if (before === null) return { title: `Stage set to ${stageLabel(after)}`, body: null };
  return { title: `Stage: ${stageLabel(before)} → ${stageLabel(after)}`, body: null };
}
