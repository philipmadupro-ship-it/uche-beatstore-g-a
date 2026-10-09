/**
 * /api/org/[orgId]/tracks/[id]/credits — the credits of an org song or
 * recording (LABEL-27, 17 R8: rows of `track_collaborators`, extended by
 * migration 153; the producer's own route, `/api/tracks/[id]/collaborators`,
 * is untouched and cannot reach an org track).
 *
 *   GET   the credits the caller may read. `rights.read`: all of them, with
 *         each party's legal name and IPI. An own line (`rights.read.own_line`
 *         — a producer / engineer function, or an external project member,
 *         D2): only the credits whose party is THEM. Everyone else: 403.
 *   POST  propose a credit `{ role, scope?, role_detail?, party_id? | name?,
 *         contact_id? }`; it is stored `proposed` and waits for a
 *         confirmation. `rights.write` proposes for anyone. Anyone with an own
 *         line, and an external contributor / editor (06 §2.6), proposes only a
 *         credit that names THEMSELVES — their own party, made on first use.
 *         Naming anyone else is 403 whatever the body holds.
 *
 * Served to org members AND to external members of a project the track sits
 * in (requireTrackActor). Authorisation answers 403 / 404 before the body is
 * read. Confirming and disputing are the `[creditId]` route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTrackActor } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgCreditProposeBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { CREDITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { CREDIT_ROLES } from '@/lib/labelos/credit-roles';
import { creditActorOf } from '@/lib/labelos/credit-actor';
import { canPropose, canWriteRights, creditReach, creditView, planPropose } from '@/lib/labelos/credits';
import {
  contactInOrg,
  creditEventSubject,
  CreditsNotReadyError,
  ensureOwnParty,
  insertCredit,
  listCredits,
  ownDisplayName,
  ownPartyRow,
  partiesByIds,
  readParty,
} from '@/lib/labelos/credits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tracks.credits');

type Params = { params: Promise<{ orgId: string; id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Credits need Supabase.' });
  const access = await requireTrackActor({ trackId: id, orgId, cap: 'rights.read.own_line' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = creditActorOf(access);
  const reach = creditReach(actor);
  if (reach === 'none') return json(403, { error: 'Forbidden' });

  try {
    const rows = await listCredits(admin, org, id);
    const parties = await partiesByIds(admin, org, rows.map((r) => r.party_id));
    const views = rows
      .map((r) => creditView(r, r.party_id ? parties.get(r.party_id) ?? null : null, actor))
      .filter((v) => reach === 'all' || v.mine);
    const own = await ownPartyRow(admin, org, actor.userId);
    return json(200, {
      schemaReady: true,
      credits: views,
      me: { reach, canPropose: canPropose(actor), canWrite: canWriteRights(actor), ownPartyId: own?.id ?? null },
      roles: CREDIT_ROLES.map((r) => ({ key: r.key, label: r.label, scope: r.scope, detail: r.detail ?? null })),
    });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(200, { schemaReady: false, credits: [], me: { reach, canPropose: false, canWrite: false, ownPartyId: null }, roles: [] });
    log.error('credit list failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not load the credits' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, id } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Credits need Supabase.' });
  const access = await requireTrackActor({ trackId: id, orgId, cap: 'rights.read.own_line' });
  if (!access.ok) return access.res;
  const { admin, orgId: org } = access.access;
  const actor = creditActorOf(access);
  if (!canPropose(actor)) return json(403, { error: 'You cannot propose credits here' });

  const parsed = await readBody(req, OrgCreditProposeBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const writer = canWriteRights(actor);
    const own = await ownPartyRow(admin, org, actor.userId);
    // The party the body names, if any: needed to tell "mine" from "someone else's".
    const named = body.party_id ? await readParty(admin, org, body.party_id) : null;
    if (writer && body.party_id && !named) return json(404, { error: 'Party not found' });

    const plan = planPropose(
      actor,
      { role: body.role, scope: body.scope, partyId: body.party_id, name: body.name, contactId: body.contact_id },
      { ownPartyId: own?.id ?? null, ownName: own?.display_name ?? (writer ? '' : await ownDisplayName(admin, org, actor.userId)), partyUserId: named?.user_id ?? null },
    );
    if (!plan.ok) return json(plan.status, { error: plan.error });

    let party = null as Awaited<ReturnType<typeof readParty>>;
    let name: string;
    if (plan.target.kind === 'own') {
      party = await ensureOwnParty(admin, org, actor.userId);
      name = party.display_name;
    } else if (plan.target.kind === 'party') {
      party = named;
      name = party!.display_name;
    } else {
      name = plan.target.name;
    }

    if (plan.contactId && !(await contactInOrg(admin, org, plan.contactId))) return json(404, { error: 'Contact not found' });
    const contactId = plan.contactId ?? party?.contact_id ?? null;

    const inserted = await insertCredit(admin, {
      org,
      trackId: id,
      name,
      role: body.role,
      scope: plan.scope,
      roleDetail: body.role_detail?.trim() ? body.role_detail.trim() : null,
      partyId: party?.id ?? null,
      contactId,
      createdBy: actor.userId,
    });
    if ('duplicate' in inserted) return json(409, { error: `${name} is already credited with that role on this track` });

    // Everyday event, best effort: the proposal is saved either way. Role and scope only — no legal data.
    await recordEvent(
      admin,
      { orgId: org, userId: actor.userId },
      'credit.proposed',
      await creditEventSubject(admin, org, id, inserted.credit.id),
      { role: body.role, scope: plan.scope },
    );

    const parties = await partiesByIds(admin, org, [inserted.credit.party_id]);
    return json(201, { credit: creditView(inserted.credit, inserted.credit.party_id ? parties.get(inserted.credit.party_id) ?? null : null, actor) });
  } catch (err) {
    if (err instanceof CreditsNotReadyError) return json(503, { error: CREDITS_NOT_READY });
    log.error('credit propose failed', { orgId: org, trackId: id, error: errorMessage(err) });
    return json(500, { error: 'Could not propose the credit' });
  }
}
