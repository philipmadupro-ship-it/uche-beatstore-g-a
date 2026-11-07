/**
 * The external signer's gate, shared by `/api/sign/[token]` and `/api/sign/[token]/document` (LABEL-60): shape check,
 * per-address limiter, lookup by the hash of the token, live contract, licensed live org, per-link limiter, the party
 * is on the contract. EVERY failure to identify the caller is the same 404 — a caller learns nothing about which.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { hashSignToken, isWellFormedSignToken, linkReadable } from './contract-signing';
import { SigningNotReadyError, orgAllowsSigning, signerByTokenHash } from './contract-signing-store';
import { identitiesOf, linksOf, readContractRow } from './contracts-store';

export const SIGN_PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
export const signNotFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: SIGN_PRIVATE_HEADERS });
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: SIGN_PRIVATE_HEADERS });

export async function resolveSignLink(req: NextRequest, rawToken: string) {
  if (!isWellFormedSignToken(rawToken)) return { res: signNotFound() } as const;
  if (!(await rateLimitDurable(`sign-ip:${clientIp(req)}`, 300, 60 * 60 * 1000))) {
    return { res: json(429, { error: 'Too many requests. Try again later.' }) } as const;
  }
  const admin = createServiceClient();
  let ref;
  try {
    ref = await signerByTokenHash(admin, hashSignToken(rawToken));
  } catch (err) {
    if (err instanceof SigningNotReadyError) return { res: signNotFound() } as const;
    throw err;
  }
  if (!ref) return { res: signNotFound() } as const;
  const row = await readContractRow(admin, ref.orgId, ref.contractId);
  if (!row) return { res: signNotFound() } as const;
  const live = { contractStatus: row.status, tokenRevoked: false, expiresAt: ref.expiresAt };
  // A signed contract's link still opens (the receipt); signing it is refused by planSign (409), not hidden.
  if (!linkReadable(live) || !(await orgAllowsSigning(admin, ref.orgId))) return { res: signNotFound() } as const;
  if (!(await rateLimitDurable(`sign-link:${hashSignToken(rawToken).slice(0, 16)}`, 60, 60 * 60 * 1000))) {
    return { res: json(429, { error: 'Too many requests. Try again later.' }) } as const;
  }
  const links = (await linksOf(admin, ref.orgId, [row.id])).get(row.id) ?? [];
  if (!links.some((l) => l.party_id === ref.partyId)) return { res: signNotFound() } as const;
  const identities = await identitiesOf(admin, ref.orgId, links.map((l) => l.party_id));
  return { admin, ref, row, links, identities } as const;
}

