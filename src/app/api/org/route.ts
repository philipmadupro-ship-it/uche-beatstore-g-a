/**
 * GET /api/org — the caller's organizations, for the org switcher in the
 * top bar (LABEL-09, 07 §1). Each org carries `home`: the dashboard for the
 * producer's own producer org, `/o/<slug>` for every other one. `shared` is
 * "Shared with me" (external project memberships, LABEL-21); empty until
 * that table exists.
 *
 * The proxy admits only signed-in users with some membership (gate
 * `member`); the list is the caller's own memberships, read through
 * org-access (`myOrganizations`), never a `user_id` filter here.
 */
import { NextResponse } from 'next/server';
import { myOrganizations } from '@/lib/auth/org-access';
import { orgHome, type MyOrgsResponse } from '@/lib/labelos/switcher';

export async function GET() {
  const mine = await myOrganizations();
  if (!mine.ok) return mine.res;
  const body: MyOrgsResponse = {
    orgs: mine.orgs.map((o) => ({ ...o, home: orgHome(o, mine.isProducer) })),
    shared: [],
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
