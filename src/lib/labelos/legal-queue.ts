/**
 * The legal queue (LABEL-31, 09 §3.3): the songs and releases somebody has
 * asked legal to look at — the `legal` gate's latest row is a request — in the
 * order legal should take them. Pure; `legal-queue-store.ts` reads the rows.
 *
 * ORDER (09 §3.3 "readiness first, oldest first"): a subject with no legal
 * blockers goes first, because legal can decide it today; then the ones with
 * fewer blockers; then the oldest request; then the id, so the order never
 * flickers between two equal rows. Readiness here is `isReady` — the blockers
 * — never the percentage (09 §2): the score is for display and is not in this
 * file at all. The number of blockers only breaks ties between subjects that
 * are both not ready; it never decides whether one may be approved.
 */
import { GATES, gateCapability } from './approvals';
import type { SubjectKind } from './approvals';

export type LegalQueueItem = {
  kind: SubjectKind;
  id: string;
  title: string | null;
  artist: { id: string; name: string } | null;
  /** When the open request was made. */
  requestedAt: string;
  /** Who asked (a display name; never an email). */
  requestedBy: string | null;
  /** The request was addressed to the viewer. */
  askedOfMe: boolean;
  /** `isReady` for every song the request covers. */
  ready: boolean;
  blockers: number;
};

/** Ready first, then fewer blockers, then oldest, then id. */
export function compareLegalQueue(a: LegalQueueItem, b: LegalQueueItem): number {
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  if (a.blockers !== b.blockers) return a.blockers - b.blockers;
  if (a.requestedAt !== b.requestedAt) return a.requestedAt < b.requestedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortLegalQueue<T extends LegalQueueItem>(items: readonly T[]): T[] {
  return [...items].sort(compareLegalQueue);
}

/**
 * Who sees the queue at all. It lists what legal is asked to decide, so it
 * needs the catalogue, the ability to read approvals (migration 157's policy:
 * `release.write` or any gate ability), and either the legal gate or the
 * contracts it is about. A row is still shown only when the member can open
 * its subject (artist scope, D4) — that is the store's check, not this one.
 */
export function canSeeLegalQueue(caps: ReadonlySet<string>): boolean {
  if (!caps.has('catalog.read')) return false;
  const mayReadApprovals = caps.has('release.write') || GATES.some((g) => caps.has(gateCapability(g)));
  return mayReadApprovals && (caps.has('release.approve.legal') || caps.has('contracts.read'));
}

/** The pack needs the contracts and the rights data in it (D2): `contracts.read` and `rights.read`. */
export function canExportLegalPack(caps: ReadonlySet<string>): boolean {
  return caps.has('contracts.read') && caps.has('rights.read');
}
