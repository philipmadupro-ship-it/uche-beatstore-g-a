/**
 * The person behind a credits request (LABEL-27): an org member acts with
 * their org capabilities, an external project member with the ones their
 * strongest role gives (D2: their own line, plus `propose_own_credit` for a
 * contributor / editor). One place, so the list, the proposal and the
 * decision cannot disagree about who is asking.
 */
import type { ProjectActor } from '@/lib/auth/org-access';
import { externalActor, orgActor, strongestExternalRole, type CreditActor } from './credits';

export function creditActorOf(access: Extract<ProjectActor, { ok: true }>): CreditActor {
  if (access.kind === 'org') return orgActor(access.access.userId, access.access.capabilities);
  return externalActor(access.access.userId, strongestExternalRole(access.access.memberships) ?? 'viewer');
}
