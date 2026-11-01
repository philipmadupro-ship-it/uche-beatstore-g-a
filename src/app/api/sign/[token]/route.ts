/**
 * /api/sign/[token] (LABEL-60) — an external signer's entrance. No account, no
 * session: the signing link is the only credential, for ONE party of ONE
 * contract. Modelled on the artist portal and the release-calendar feed:
 *
 *  - Every failure to identify the caller is the same `404 {error:"Not found"}`
 *    — malformed or unknown token, revoked, expired, a contract that is void or
 *    still a draft, a deleted or unlicensed org, a database without migration
 *    178 — so a caller learns nothing about which. (A database fault is 503.)
 *  - The token is checked for SHAPE first, then looked up by the hash of it;
 *    only the hash is stored, so a database leak yields no usable link.
 *  - A coarse per-address limiter counts everything; a per-link one is spent
 *    only after the token resolved, so guesses cannot lock the real signer out.
 *  - It serves the contract's own text (which names its parties) and THIS
 *    party's state. Never another contract, other parties' links or emails,
 *    the internal note, or any address or hash of anyone's address.
 *  - Signing records the address only as a salted hash; the typed name and the
 *    drawn image (private bucket) belong to the signature row.
 *
 * GET reads; POST `{ version, name, drawing? }` signs through the same flow as
 * a member (lib/labelos/contract-signing-flow), `via: 'link'`.
 * A signed contract's link stays readable for the receipt until it expires.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { PublicContractSignBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { clientIp, rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';
import { auditRpc } from '@/lib/labelos/audit-rpc';
import { cleanSignerName, hashSignToken, isWellFormedSignToken, linkReadable, parseDrawnSignature } from '@/lib/labelos/contract-signing';
import { finishSign, prepareSign, snapshotOf } from '@/lib/labelos/contract-signing-flow';
import { SigningNotReadyError, ipHashOf, orgAllowsSigning, readProviderUrl, signerByTokenHash } from '@/lib/labelos/contract-signing-store';
import { CERTIFICATE_STATEMENT } from '@/lib/labelos/contract-signing-view';
import { partyName } from '@/lib/labelos/contracts/context';
import { PARTY_ROLE_LABELS, TEMPLATE_TYPE_LABELS } from '@/lib/labelos/contracts/types';
import { documentOf } from '@/lib/labelos/contracts-route';
import { ContractsNotReadyError, identitiesOf, linksOf, readContractRow } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.sign');
const PRIVATE = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE });
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: PRIVATE });

type Params = { params: Promise<{ token: string }> };

async function resolve(req: NextRequest, rawToken: string) {
  if (!isWellFormedSignToken(rawToken)) return { res: notFound() } as const;
  if (!(await rateLimitDurable(`sign-ip:${clientIp(req)}`, 300, 60 * 60 * 1000))) {
    return { res: json(429, { error: 'Too many requests. Try again later.' }) } as const;
  }
  const admin = createServiceClient();
  let ref;
  try {
    ref = await signerByTokenHash(admin, hashSignToken(rawToken));
  } catch (err) {
    if (err instanceof SigningNotReadyError) return { res: notFound() } as const;
    throw err;
  }
  if (!ref) return { res: notFound() } as const;
  const row = await readContractRow(admin, ref.orgId, ref.contractId);
  if (!row) return { res: notFound() } as const;
  const live = { contractStatus: row.status, tokenRevoked: false, expiresAt: ref.expiresAt };
  // A signed contract's link still opens (the receipt); signing it is refused by planSign (409), not hidden.
  if (!linkReadable(live) || !(await orgAllowsSigning(admin, ref.orgId))) return { res: notFound() } as const;
  if (!(await rateLimitDurable(`sign-link:${hashSignToken(rawToken).slice(0, 16)}`, 60, 60 * 60 * 1000))) {
    return { res: json(429, { error: 'Too many requests. Try again later.' }) } as const;
  }
  const links = (await linksOf(admin, ref.orgId, [row.id])).get(row.id) ?? [];
  if (!links.some((l) => l.party_id === ref.partyId)) return { res: notFound() } as const;
  const identities = await identitiesOf(admin, ref.orgId, links.map((l) => l.party_id));
  return { admin, ref, row, links, identities } as const;
}

const failed = (err: unknown, what: string) => {
  if (err instanceof SigningNotReadyError || err instanceof ContractsNotReadyError) return notFound();
  log.error(what, { error: errorMessage(err) });
  return json(503, { error: 'Try again later' });
};

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return json(503, { error: 'Try again later' });
  try {
    const r = await resolve(req, token);
    if ('res' in r) return r.res;
    const { admin, ref, row, links, identities } = r;
    const snap = await snapshotOf(admin, ref.orgId, row, links, identities);
    const mine = snap.states.find((s) => s.partyId === ref.partyId);
    const document = await documentOf(admin, ref.orgId, row, links, identities);
    const sorted = [...links].sort((a, b) => a.position - b.position);
    return json(200, {
      contract: { title: row.title, typeLabel: TEMPLATE_TYPE_LABELS[row.type], version: row.version, status: row.status },
      you: { role: mine?.role ?? 'artist', roleLabel: PARTY_ROLE_LABELS[mine?.role ?? 'artist'], name: partyName(identities.get(ref.partyId)!) },
      parties: sorted.map((l) => ({ roleLabel: PARTY_ROLE_LABELS[l.role], name: identities.get(l.party_id) ? partyName(identities.get(l.party_id)!) : 'Unknown party' })),
      clauses: document.clauses.map((c) => ({ id: c.id, heading: c.heading, body: c.body })),
      documentSha256: snap.sha,
      state: mine?.status ?? 'pending',
      receipt: mine && mine.status !== 'pending' ? { signedAt: mine.signature.signedAt, signerName: snap.signatures.find((s) => s.id === mine.signature.id)?.signerName ?? null, documentSha256: mine.signature.documentSha256 } : null,
      canSign: row.status === 'sent' && mine?.status !== 'signed',
      completed: row.status === 'signed',
      expiresAt: ref.expiresAt,
      providerUrl: await readProviderUrl(admin, ref.orgId, row.id),
      statement: CERTIFICATE_STATEMENT,
    });
  } catch (err) {
    return failed(err, 'sign page read failed');
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return json(503, { error: 'Try again later' });
  try {
    const r = await resolve(req, token);
    if ('res' in r) return r.res;
    const parsed = await readBody(req, PublicContractSignBodySchema);
    if (!parsed.ok) return parsed.res;
    const name = cleanSignerName(parsed.data.name);
    if (!name) return json(400, { error: 'Type your full name to sign.' });
    let drawn: Buffer | null = null;
    if (parsed.data.drawing) {
      const png = parseDrawnSignature(parsed.data.drawing);
      if (!png.ok) return json(400, { error: png.reason === 'size' ? 'That drawn signature is too large. Clear it and draw it again.' : 'The drawn signature must be a PNG image.' });
      drawn = png.bytes;
    }
    const { admin, ref, row, links, identities } = r;
    const prepared = await prepareSign({
      admin,
      orgId: ref.orgId,
      row,
      links,
      identities,
      partyId: ref.partyId,
      seenVersion: parsed.data.version,
      seenSha: parsed.data.document_sha256,
      linkHash: hashSignToken(token),
      name,
      drawn,
      via: 'link',
      actorId: null,
      countersign: false,
      ipHash: ipHashOf(req),
    });
    if (!prepared.ok) return json(prepared.status, { error: prepared.error, ...(prepared.code ? { code: prepared.code } : {}) });
    const result = await finishSign(prepared, await auditRpc(admin, 'contractSign', prepared.args));
    if (!result.ok) return json(result.status, { error: result.error, ...(result.code ? { code: result.code } : {}) });
    return json(200, { ok: true, completed: result.completed });
  } catch (err) {
    return failed(err, 'sign failed');
  }
}
