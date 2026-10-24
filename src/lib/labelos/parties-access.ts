/**
 * Who may open the Parties directory (LABEL-54): anyone with an own-line
 * rights ability (they see their own party), a rights reader (the directory,
 * per scope and per role), and finance (`finance.read`: the payees, with their
 * tax id and payment instructions, but never the legal block — that is
 * `rights.read`). One place so the list and the single-party route agree.
 */
import { requireOrgCapability, type OrgAccessResult } from '@/lib/auth/org-access';

export async function requirePartiesReader(orgId: string): Promise<OrgAccessResult> {
  const rights = await requireOrgCapability(orgId, 'rights.read.own_line');
  if (rights.ok) return rights;
  const finance = await requireOrgCapability(orgId, 'finance.read');
  return finance.ok ? finance : rights;
}

/** Does this member read the whole directory (within their artist scope), or only their own party? */
export function readsDirectory(caps: ReadonlySet<string>): boolean {
  return caps.has('rights.read') || caps.has('finance.read');
}
