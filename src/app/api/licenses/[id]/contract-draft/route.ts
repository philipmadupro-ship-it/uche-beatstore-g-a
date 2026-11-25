import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { LicenseContractDraftBodySchema } from '@/lib/contracts';
import { DRAFT_BANNER, buildTierDraft, parseTierRef, type TierDraftView } from '@/lib/contracts/license-draft';
import { renderContractPdf } from '@/lib/contracts/pdf';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

const log = createLogger('api.licenses.contract-draft');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The contract for one license tier, as a draft the producer can review
 * (LICENSE-05). Read-only: nothing is written, whatever wording is sent. The
 * tier is read with the caller's own user id, so another producer's tier is a
 * 404, never a 403 and never their terms. Purchase details are the sample set.
 */
async function draftFor(
  id: string,
  override: { template: string | null } | null,
): Promise<{ view: TierDraftView } | { res: NextResponse }> {
  const auth = await requireUser();
  if (!auth.ok) return { res: auth.res };
  const ref = parseTierRef(id);
  if (!ref) return { res: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
  if (!(await rateLimitDurable(`contract-draft:${auth.userId}`, 30))) {
    return { res: NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } }) };
  }
  const admin = auth.admin;

  let tierRow: Record<string, unknown> | null = null;
  if (ref.kind === 'uuid') {
    const { data, error } = await admin.from('licenses').select('*').eq('id', ref.id).eq('user_id', auth.userId).maybeSingle();
    if (error) throw error;
    if (!data) return { res: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) };
    tierRow = data as Record<string, unknown>;
  }
  const { data: prof, error: profErr } = await admin
    .from('creator_profiles')
    .select('display_name, contact_email, license_template_md')
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (profErr) throw profErr;
  const p = (prof ?? {}) as { display_name?: string | null; contact_email?: string | null; license_template_md?: string | null };
  const view = buildTierDraft({
    tierRow,
    legacyId: ref.kind === 'legacy' ? ref.id : undefined,
    template: override ? override.template : p.license_template_md,
    producerName: p.display_name,
    producerEmail: p.contact_email,
  });
  return { view };
}

/** GET: the draft from the SAVED wording; `?format=pdf` downloads it as a PDF marked DRAFT. */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const out = await draftFor(id, null);
    if ('res' in out) return out.res;
    if (new URL(req.url).searchParams.get('format') !== 'pdf') {
      return NextResponse.json({ draft: out.view }, { headers: NO_STORE });
    }
    const pdf = await renderContractPdf(`${DRAFT_BANNER}\n\n${out.view.markdown}`);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="license-contract-draft.pdf"',
      },
    });
  } catch (err) {
    log.error('draft failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500, headers: NO_STORE });
  }
}

/** POST: the draft from wording sent in the body (an unsaved edit). Never saved. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parsed = await readBody(req, LicenseContractDraftBodySchema);
    if (!parsed.ok) return parsed.res;
    const out = await draftFor(id, parsed.data.template === undefined ? null : { template: parsed.data.template ?? null });
    if ('res' in out) return out.res;
    return NextResponse.json({ draft: out.view }, { headers: NO_STORE });
  } catch (err) {
    log.error('draft failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500, headers: NO_STORE });
  }
}
