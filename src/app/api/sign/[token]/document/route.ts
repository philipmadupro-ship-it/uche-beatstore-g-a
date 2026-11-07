/**
 * GET /api/sign/[token]/document (LABEL-60 review G14) — the EXACT frozen sent PDF, for the one party the link belongs
 * to. The page's "document fingerprint" is the SHA-256 of these bytes, so the signer can check what they signed.
 *
 * Same gate as the signing page (`resolveSignLink`): one 404 for every failure. The stored bytes are re-hashed against
 * `sent_document_sha256` before the first byte is sent; a missing or mismatching copy is also the same 404 (logged),
 * never a distinguishable answer. A contract sent before migration 178 has no frozen copy: 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { SIGN_PRIVATE_HEADERS, resolveSignLink, signNotFound } from '@/lib/labelos/sign-link-resolve';
import { SigningNotReadyError, readFrozen, readVerifiedFrozenBytes } from '@/lib/labelos/contract-signing-store';
import { ContractsNotReadyError } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.sign.document');

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Try again later' }, { status: 503, headers: SIGN_PRIVATE_HEADERS });
  try {
    const r = await resolveSignLink(req, token);
    if ('res' in r) return r.res;
    const frozen = await readFrozen(r.admin, r.ref.orgId, r.row.id);
    if (!frozen) return signNotFound();
    const checked = await readVerifiedFrozenBytes(frozen);
    if (!checked.ok) {
      log.error('frozen sent copy failed verification', { contractId: r.row.id, reason: checked.reason });
      return signNotFound();
    }
    return new NextResponse(new Uint8Array(checked.bytes), {
      status: 200,
      headers: {
        ...SIGN_PRIVATE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="contract-v${r.row.version}-sent.pdf"`,
        'Content-Length': String(checked.bytes.length),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof SigningNotReadyError || err instanceof ContractsNotReadyError) return signNotFound();
    log.error('sign document failed', { error: errorMessage(err) });
    return NextResponse.json({ error: 'Try again later' }, { status: 503, headers: SIGN_PRIVATE_HEADERS });
  }
}
