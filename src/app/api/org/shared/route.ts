/**
 * GET /api/org/shared — "Shared with me" (LABEL-21): the projects the caller
 * is a live external member of, each with the org's name, the caller's role
 * and where it opens (`/shared/<project>`). Nothing else about those orgs.
 *
 * The caller's OWN memberships (identity, not tenancy), read through
 * org-access, so an expired membership, a removed one or a deleted org is
 * simply absent on the next request. The proxy admits a signed-in user with
 * any org or project membership (gate `member`); a person with none is 403
 * there and an empty list here.
 */
import { NextResponse } from 'next/server';
import { myExternalProjects } from '@/lib/auth/org-access';

export const dynamic = 'force-dynamic';

export async function GET() {
  const mine = await myExternalProjects();
  if (!mine.ok) return mine.res;
  return NextResponse.json(
    { projects: mine.projects.map((p) => ({ id: p.id, name: p.name, orgName: p.orgName, role: p.role, href: p.href })) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
