/**
 * "My sessions" (LABEL-69): a collaborator who is on projects in several
 * organizations sees them grouped by org, each with the asks waiting on THEM
 * — a credit to confirm, a split line to acknowledge, a contract to sign.
 *
 * Pure. This is a read-only aggregation of what the person can already reach
 * one by one, never a wider view:
 *  - the projects are the caller's own live external memberships
 *    (`myExternalProjects`), and `assembleSessions` drops any ask whose
 *    project is not among them;
 *  - every ask is judged here from rows scoped to the caller's OWN party
 *    (`user_id` = them), so another person's credit, line or contract is never
 *    a candidate;
 *  - an ask carries a label and a link, never a legal name, IPI, share of
 *    anyone else, or a contract's body (D2).
 */

export type AskKind = 'credit' | 'split' | 'contract';

export type SessionAsk = {
  /** Stable key: `<kind>:<row id>`. */
  key: string;
  kind: AskKind;
  projectId: string;
  trackId: string | null;
  trackTitle: string | null;
  /** What to do, in words ("Confirm your credit: Producer"). */
  label: string;
  /** Credit / line / contract id, for the action. */
  refId: string;
  /** The split sheet a line sits on (acknowledging posts to it). */
  sheetId: string | null;
};

export type SessionProject = {
  id: string;
  orgId: string;
  name: string;
  orgName: string;
  role: string;
  href: string;
};

export type SessionProjectWithAsks = SessionProject & { asks: SessionAsk[] };
export type OrgSession = { orgId: string; orgName: string; projects: SessionProjectWithAsks[]; askCount: number };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function assembleSessions(projects: readonly SessionProject[], asks: readonly SessionAsk[]): OrgSession[] {
  const reachable = new Map(projects.map((p) => [p.id, p]));
  const askMap = new Map<string, SessionAsk[]>();
  const seen = new Set<string>();
  for (const a of asks) {
    if (!reachable.has(a.projectId) || seen.has(a.key)) continue; // never an ask outside a project they can open
    seen.add(a.key);
    const list = askMap.get(a.projectId) ?? [];
    list.push(a);
    askMap.set(a.projectId, list);
  }
  const orgs = new Map<string, OrgSession>();
  for (const p of projects) {
    const org = orgs.get(p.orgId) ?? { orgId: p.orgId, orgName: p.orgName, projects: [], askCount: 0 };
    const mine = askMap.get(p.id) ?? [];
    org.projects.push({ ...p, asks: mine });
    org.askCount += mine.length;
    orgs.set(p.orgId, org);
  }
  const out = [...orgs.values()];
  for (const o of out) o.projects.sort((a, b) => byName(a.name, b.name));
  // Orgs with something waiting first, then by name.
  out.sort((a, b) => (b.askCount > 0 ? 1 : 0) - (a.askCount > 0 ? 1 : 0) || byName(a.orgName, b.orgName));
  return out;
}

// ── Which rows are asks ─────────────────────────────────────────────────

export type CreditFact = { id: string; track_id: string; role: string; status: string; created_by: string | null; party_user_id: string | null };

/** A credit waits on the caller when it is theirs, still proposed, and someone else proposed it. */
export function creditNeedsConfirming(c: CreditFact, userId: string): boolean {
  return c.status === 'proposed' && c.party_user_id === userId && c.created_by !== userId;
}

export type SplitLineFact = {
  id: string;
  sheet_id: string;
  track_id: string;
  sheet_status: string;
  signed_at: string | null;
  party_user_id: string | null;
};

/** A line waits on the caller when it is theirs, unsigned, on a sheet that has been circulated. */
export function splitLineNeedsAcknowledging(l: SplitLineFact, userId: string): boolean {
  return l.sheet_status === 'circulated' && !l.signed_at && l.party_user_id === userId;
}

export type ContractFact = {
  id: string;
  title: string;
  status: string;
  track_id: string | null;
  party_user_id: string | null;
  /** The party already holds a signature on the contract's frozen document. */
  signedCurrent: boolean;
};

/** A contract waits on the caller when it is out for signature, they are a party, and have not signed this document. */
export function contractNeedsSigning(c: ContractFact, userId: string): boolean {
  return c.status === 'sent' && c.party_user_id === userId && !c.signedCurrent;
}

export function creditAskLabel(roleLabel: string): string {
  return `Confirm your credit: ${roleLabel}`;
}
export const SPLIT_ASK_LABEL = 'Acknowledge your split';
export function contractAskLabel(title: string): string {
  return `Sign: ${title}`;
}
