/**
 * Who may touch a release's press kit and outreach (LABEL-66), shared by the
 * `…/releases/[releaseId]/press/**` routes. Not a route itself.
 *
 *  - The RELEASE: requireObjectAccess on `releases` with `catalog.read` (its
 *    artist scope comes through the release's project): another org's release,
 *    one outside the member's artists, an external project member or a missing
 *    id is 404.
 *  - The MODULE: an org not licensed for `pr` (or whose owner switched it off)
 *    answers 404, like every module's routes.
 *  - READ: `pr.read`; WRITE: `pr.write`; never a role-`artist` member (press is
 *    the label's business side). The OUTREACH tracker also needs the whole-org
 *    view, since press contacts are directory people.
 *  - Migration 184 missing: reads answer `{ schemaReady: false }`, writes 503
 *    naming it. The probe is a READ (an insert into a missing table answers an
 *    empty 404).
 */
import { NextResponse } from 'next/server';
import { orgHasModule, type ObjectAccessResult } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { recordEvent } from '@/lib/labelos/activity';
import { mayReadPress, mayUseOutreach, mayWritePress } from '@/lib/labelos/press';
import { NEEDS_184, ensureKit, findKit, pressTablesReady, type KitRow } from '@/lib/labelos/press-store';
import { isUUID } from '@/lib/validate';

export const NO_STORE = { 'Cache-Control': 'no-store' };
export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export type Access = Extract<ObjectAccessResult, { ok: true }>;
export type ReleaseInfo = { id: string; title: string; state: string; contactId: string | null; projectId: string | null };
export type PressContext = {
  access: Access;
  admin: AdminClient;
  orgId: string;
  release: ReleaseInfo;
  /** The release's kit; made now when the route may create one (call it only once the body is valid). */
  ensure: () => Promise<KitRow | null>;
  /** Handlers call `recordEvent(ctx.admin, ctx.actor, verb, ctx.subject, …)` themselves (coverage.test reads the handler's own text). Ids and field names only. */
  actor: { orgId: string; userId: string };
  subject: { type: 'release'; id: string; releaseId: string; artistId: string | null; projectId: string | null };
};

async function readRelease(admin: AdminClient, org: string, id: string): Promise<ReleaseInfo | null> {
  const res = await admin.from('releases').select('id, title, state, contact_id, project_id').eq('org_id', org).eq('id', id).maybeSingle();
  if (res.error) throw new Error(`release read: ${res.error.message}`);
  const r = res.data as { id: string; title: string; state: string; contact_id: string | null; project_id: string | null } | null;
  return r ? { id: r.id, title: r.title, state: r.state, contactId: r.contact_id, projectId: r.project_id } : null;
}

/** Module + `pr.read`, and whether the tables exist. */
export async function pressReadAccess(access: Access): Promise<{ ok: true; access: Access; ready: boolean } | { ok: false; res: NextResponse }> {
  if (!orgHasModule(access, 'pr')) return { ok: false, res: json(404, { error: 'Not found' }) };
  if (!mayReadPress(access.capabilities, access.role)) return { ok: false, res: json(403, { error: 'Forbidden' }) };
  return { ok: true, access, ready: await pressTablesReady(access.admin) };
}

/**
 * Write access, with the kit made on first write when `create` (a PATCH or DELETE of a row that cannot exist
 * without a kit answers 404 instead). `outreach` demands the whole-org view too.
 */
export async function pressWriteContext(authorised: Access, opts: { create: boolean; outreach?: boolean }): Promise<{ ok: true; ctx: PressContext } | { ok: false; res: NextResponse }> {
  const read = await pressReadAccess(authorised);
  if (!read.ok) return read;
  const { access } = read;
  if (!mayWritePress(access.capabilities, access.role)) return { ok: false, res: json(403, { error: 'Forbidden' }) };
  if (opts.outreach && !mayUseOutreach(access.artistScope)) return { ok: false, res: json(403, { error: 'Only members who see the whole organization can track press outreach.' }) };
  if (!read.ready) return { ok: false, res: json(503, { error: NEEDS_184 }) };

  const release = await readRelease(access.admin, access.orgId, access.object.id);
  if (!release) return { ok: false, res: json(404, { error: 'Not found' }) };
  if (release.state === 'cancelled') return { ok: false, res: json(409, { error: 'A cancelled release has no press kit to change.' }) };

  const subject = { type: 'release' as const, id: release.id, releaseId: release.id, artistId: release.contactId, projectId: release.projectId };
  const actor = { orgId: access.orgId, userId: access.userId };
  // The kit is made at the first write that SUCCEEDS the body's validation, never before it: a refused request
  // must not leave a kit (and a "started a kit" event) behind. A PATCH or DELETE never makes one.
  let cached: KitRow | null = null;
  const ensure = async (): Promise<KitRow | null> => {
    if (cached) return cached;
    if (opts.create) {
      const made = await ensureKit(access.admin, access.orgId, release.id, access.userId);
      cached = made.kit;
      if (made.created) await recordEvent(access.admin, actor, 'press_kit.created', subject, {});
    } else {
      cached = await findKit(access.admin, access.orgId, release.id);
    }
    return cached;
  };
  if (!opts.create && !opts.outreach && !(await ensure())) return { ok: false, res: json(404, { error: 'Not found' }) };
  return { ok: true, ctx: { access, admin: access.admin, orgId: access.orgId, release, ensure, actor, subject } };
}

/** A path id that is not a uuid is the same 404 as a missing row. */
export const badId = (id: string) => !isUUID(id);
