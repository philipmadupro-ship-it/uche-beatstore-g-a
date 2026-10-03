/**
 * GET  /api/org/[orgId]/releases — the org's releases the member can see.
 * POST /api/org/[orgId]/releases — create one (`release.write`).
 *
 * LABEL-16 (05 §2, 17 R1/R2). A release is org-only and always has a
 * project (R2): when the body names none, one is created for it, named after
 * the release and linked to its artist (project_contacts), so the artist's
 * scoped members see the release the moment it exists. The artist is an org
 * contact the member can see; a named project must be one too. Who reads a
 * release is who can see its project (migration 144), so a list is narrowed
 * to the member's projects (orgProjectIdsInScope) — never by user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { orgProjectIdsInScope, requireObjectAccess, requireOrgCapability } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { OrgReleaseCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { RELEASE_COLUMNS, toReleaseView, type ReleaseRow } from '@/lib/labelos/releases';
import { checkArtwork, fail, notReady, writeError } from './access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.releases');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Releases need Supabase.' }, { status: 501 });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  try {
    const projectIds = await orgProjectIdsInScope(access.admin, access);
    if (projectIds !== null && projectIds.length === 0) return NextResponse.json({ releases: [] }, { headers: NO_STORE });
    let query = access.admin.from('releases').select(RELEASE_COLUMNS).eq('org_id', access.orgId);
    if (projectIds !== null) query = query.in('project_id', projectIds);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ releases: [], schemaReady: false }, { headers: NO_STORE });
      throw new Error(error.message);
    }
    const releases = ((data ?? []) as unknown as ReleaseRow[]).map(toReleaseView);
    return NextResponse.json({ releases }, { headers: NO_STORE });
  } catch (err) {
    log.error('list failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the releases' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Releases need Supabase.' }, { status: 501 });
  const access = await requireOrgCapability(orgId, 'release.write');
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgReleaseCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { admin } = access;
  const org = access.orgId;

  // The artist and (if named) the project: this org's, in the member's scope.
  const artist = await requireObjectAccess({ table: 'contacts', id: body.contact_id, cap: 'release.write', orgId: org });
  if (!artist.ok) return artist.res;
  if (body.project_id) {
    const project = await requireObjectAccess({ table: 'projects', id: body.project_id, cap: 'release.write', orgId: org });
    if (!project.ok) return project.res;
  }

  // Probe the table before creating anything: a project made for a release
  // that then cannot be written would be left behind (PostgREST answers an
  // insert into a missing table with an empty 404 isMissingSchema misses).
  const probe = await admin.from('releases').select('id').eq('org_id', org).limit(1);
  if (probe.error) {
    if (isMissingSchema(probe.error)) return notReady().res;
    log.error('probe failed', { orgId: org, error: probe.error.message });
    return NextResponse.json({ error: 'Could not create the release' }, { status: 500 });
  }

  if (body.artwork_asset_id) {
    if (!body.project_id) {
      return fail(400, "artwork_asset_id: must be a file of the release's project", { field: 'artwork_asset_id' }).res;
    }
    const art = await checkArtwork(access, { org_id: org, project_id: body.project_id }, body.artwork_asset_id);
    if (!art.ok) return art.res;
  }

  let projectId = body.project_id ?? null;
  let createdProject = false;
  try {
    if (!projectId) {
      // Org rows have no owner (142); the project_contacts row carries the
      // acting member, as every org row of that #44 table does (141).
      const { data, error } = await admin
        .from('projects')
        .insert({ user_id: null, org_id: org, name: body.title })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'no project row returned');
      projectId = (data as { id: string }).id;
      createdProject = true;
      const link = await admin
        .from('project_contacts')
        .insert({ user_id: access.userId, project_id: projectId, contact_id: artist.object.id, role: 'artist' });
      if (link.error) throw new Error(link.error.message);
    }

    const { data, error } = await admin
      .from('releases')
      .insert({
        org_id: org,
        project_id: projectId,
        contact_id: artist.object.id,
        title: body.title,
        type: body.type ?? 'single',
        upc: body.upc ?? null,
        label_name: body.label_name ?? null,
        c_line: body.c_line ?? null,
        p_line: body.p_line ?? null,
        primary_genre: body.primary_genre ?? null,
        target_date: body.target_date ?? null,
        release_date: body.release_date ?? null,
        artwork_asset_id: body.artwork_asset_id ?? null,
        state: 'draft',
        created_by: access.userId,
      })
      .select(RELEASE_COLUMNS)
      .single();
    if (error || !data) {
      await removeProject(admin, org, createdProject ? projectId : null);
      return writeError(error ?? {}, 'Could not create the release').res;
    }
    const release = data as unknown as ReleaseRow;

    if (createdProject) {
      await recordEvent(admin, { orgId: org, userId: access.userId }, 'project.created', {
        type: 'project',
        id: projectId,
        artistId: artist.object.id,
        projectId,
      }, { for: 'release' }, { visibility: 'artist' });
    }
    await recordEvent(admin, { orgId: org, userId: access.userId }, 'release.created', {
      type: 'release',
      id: release.id,
      artistId: artist.object.id,
      projectId,
      releaseId: release.id,
    }, { type: release.type });

    return NextResponse.json({ release: toReleaseView(release) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    await removeProject(admin, org, createdProject ? projectId : null);
    log.error('create failed', { orgId: org, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not create the release' }, { status: 500 });
  }
}

/** Best effort: the project this request made for a release that was never written. */
async function removeProject(admin: AdminClient, org: string, projectId: string | null): Promise<void> {
  if (!projectId) return;
  try {
    await admin.from('project_contacts').delete().eq('project_id', projectId);
    await admin.from('projects').delete().eq('id', projectId).eq('org_id', org);
  } catch (err) {
    log.warn('release project cleanup failed', { orgId: org, projectId, error: errorMessage(err) });
  }
}
